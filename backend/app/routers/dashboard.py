"""
routers/dashboard.py
Dashboard API — returns aggregated student data in a single call.

GET  /api/dashboard/me              → full dashboard payload
POST /api/dashboard/question/refresh → skip current question, generate new one
"""

import asyncio
import logging
import json
from datetime import datetime, timezone, timedelta
from collections import Counter
from fastapi import APIRouter, Depends

from ..middleware.auth import get_current_user_full, AuthUser
from ..services.database import get_db
from ..config import get_settings

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/dashboard", tags=["dashboard"])


# ── Daily question recommendation (Gemini-powered + persistent) ───

DAILY_Q_PROMPT = """You are a DSA tutor. Based on the student's profile, recommend ONE LeetCode problem they should practice today.

Student Profile:
- Weak patterns: {weak_patterns}
- Strong patterns: {strong_patterns}
- Per-pattern mastery: {mastery}
- Recent problems: {recent}
- Already solved problem IDs (DO NOT recommend these): {solved_ids}

Rules:
1. Prioritize patterns the student is WEAK at or hasn't practiced in 7+ days.
2. Pick a problem that's slightly above their current mastery level for that pattern.
3. If they have no weak patterns, pick a pattern they haven't seen recently.
4. NEVER recommend a problem that's in the "already solved" list.
5. Pick well-known LeetCode problems (top 500 by frequency).

Respond with ONLY valid JSON (no markdown fences):
{{
  "id": <leetcode_number>,
  "title": "<problem title>",
  "difficulty": "<Easy|Medium|Hard>",
  "pattern": "<primary_pattern>",
  "reason": "<one sentence explaining why this problem>"
}}"""


async def _generate_question_with_ai(profile: dict, solved_ids: list) -> dict:
    """Use Gemini to recommend a daily question based on student profile."""
    try:
        from ..services.gemini import get_gemini_model

        model = get_gemini_model()
        prompt = DAILY_Q_PROMPT.format(
            weak_patterns=profile.get("weak_patterns", []),
            strong_patterns=profile.get("strength_fingerprint", []),
            mastery=json.dumps(profile.get("per_pattern_mastery", {}), default=str)[:500],
            recent=json.dumps(profile.get("recent_strategies", []), default=str)[:300],
            solved_ids=solved_ids[:100],
        )

        response = await model.generate_content_async(
            prompt,
            generation_config={"temperature": 0.7, "max_output_tokens": 200},
        )

        text = response.text.strip()
        # Strip markdown fences if present
        if text.startswith("```"):
            text = text.split("\n", 1)[1].rsplit("```", 1)[0].strip()

        return json.loads(text)

    except Exception as exc:
        logger.warning("Daily question generation failed: %s", exc)
        # Fallback — a good default problem
        return {
            "id": 121,
            "title": "Best Time to Buy and Sell Stock",
            "difficulty": "Easy",
            "pattern": "sliding_window",
            "reason": "A great warm-up problem to practice array traversal",
        }


async def _get_or_create_daily_question(student_id: str, profile: dict) -> dict:
    """
    Get the active daily question for this student.
    If none exists, generate one with AI and persist it.
    """
    db = get_db()

    # 1. Check for existing active recommendation
    if db:
        try:
            res = await asyncio.to_thread(
                lambda: db.table("daily_recommendations")
                    .select("*")
                    .eq("student_id", student_id)
                    .eq("status", "active")
                    .order("recommended_at", desc=True)
                    .limit(1)
                    .execute()
            )
            if res.data:
                row = res.data[0]
                return {
                    "id": row["problem_id"],
                    "title": row["problem_title"],
                    "difficulty": row.get("difficulty"),
                    "pattern": row.get("pattern"),
                    "reason": row.get("reason"),
                    "recommended_at": row.get("recommended_at"),
                    "persisted": True,
                }
        except Exception as exc:
            logger.warning("Failed to check daily recommendation: %s", exc)

    # 2. No active recommendation — get solved IDs to avoid duplicates
    solved_ids = []
    if db:
        try:
            res = await asyncio.to_thread(
                lambda: db.table("solved_problems")
                    .select("problem_id")
                    .eq("student_id", student_id)
                    .execute()
            )
            solved_ids = [r["problem_id"] for r in (res.data or []) if r.get("problem_id")]
        except Exception:
            pass

    # Also exclude previously recommended problems (solved + skipped)
    if db:
        try:
            res = await asyncio.to_thread(
                lambda: db.table("daily_recommendations")
                    .select("problem_id")
                    .eq("student_id", student_id)
                    .execute()
            )
            prev_ids = [r["problem_id"] for r in (res.data or []) if r.get("problem_id")]
            solved_ids = list(set(solved_ids + prev_ids))
        except Exception:
            pass

    # 3. Generate new question with AI
    question = await _generate_question_with_ai(profile, solved_ids)

    # 4. Persist it
    if db:
        try:
            row = {
                "student_id": student_id,
                "problem_id": question.get("id", 0),
                "problem_title": question.get("title", ""),
                "difficulty": question.get("difficulty"),
                "pattern": question.get("pattern"),
                "reason": question.get("reason"),
                "status": "active",
            }
            await asyncio.to_thread(
                lambda: db.table("daily_recommendations").insert(row).execute()
            )
            logger.info("Persisted daily recommendation for %s: #%s %s",
                         student_id, question.get("id"), question.get("title"))
        except Exception as exc:
            logger.warning("Failed to persist daily recommendation: %s", exc)

    question["persisted"] = True
    return question


async def _skip_and_regenerate(student_id: str, profile: dict) -> dict:
    """Mark current active question as skipped, generate a new one."""
    db = get_db()

    # Mark current as skipped
    if db:
        try:
            await asyncio.to_thread(
                lambda: db.table("daily_recommendations")
                    .update({"status": "skipped"})
                    .eq("student_id", student_id)
                    .eq("status", "active")
                    .execute()
            )
        except Exception as exc:
            logger.warning("Failed to skip daily recommendation: %s", exc)

    # Generate fresh one
    return await _get_or_create_daily_question(student_id, profile)


# ── Streak + heatmap computation ──────────────────────────────────

def _compute_streak_and_heatmap(solved_rows: list) -> tuple[dict, list]:
    """
    Compute current/max streak and daily activity heatmap
    from solved_problems rows.
    """
    if not solved_rows:
        return {"current": 0, "max": 0, "total_active_days": 0}, []

    # Group by date
    date_counts = Counter()
    for row in solved_rows:
        solved_at = row.get("solved_at")
        if solved_at:
            try:
                if isinstance(solved_at, str):
                    dt = datetime.fromisoformat(solved_at.replace("Z", "+00:00"))
                else:
                    dt = solved_at
                date_counts[dt.date().isoformat()] += 1
            except (ValueError, AttributeError):
                continue

    if not date_counts:
        return {"current": 0, "max": 0, "total_active_days": 0}, []

    # Build heatmap (last 365 days)
    today = datetime.now(timezone.utc).date()
    heatmap = []
    for i in range(364, -1, -1):
        d = (today - timedelta(days=i)).isoformat()
        heatmap.append({"date": d, "count": date_counts.get(d, 0)})

    # Compute streaks
    sorted_dates = sorted(set(date_counts.keys()))
    current_streak = 0
    max_streak = 0
    streak = 0
    prev = None

    for d_str in sorted_dates:
        d = datetime.fromisoformat(d_str).date()
        if prev and (d - prev).days == 1:
            streak += 1
        else:
            streak = 1
        max_streak = max(max_streak, streak)
        prev = d

    # Current streak (must include today or yesterday)
    current_streak = 0
    check_date = today
    for i in range(len(sorted_dates)):
        d_str = sorted_dates[-(i + 1)]
        d = datetime.fromisoformat(d_str).date()
        if d == check_date:
            current_streak += 1
            check_date = check_date - timedelta(days=1)
        elif d == check_date - timedelta(days=1):
            # Allow gap for today (haven't solved yet today)
            check_date = d
            current_streak += 1
            check_date = check_date - timedelta(days=1)
        else:
            break

    return {
        "current": current_streak,
        "max": max_streak,
        "total_active_days": len(date_counts),
    }, heatmap


# ── Main dashboard endpoint ───────────────────────────────────────

@router.get("/me")
async def get_dashboard(auth: AuthUser = Depends(get_current_user_full)):
    """
    Return full dashboard data for the authenticated student.
    Single endpoint — frontend fetches once on dashboard mount.
    """
    student_id = auth.id
    db = get_db()

    # Default empty response
    profile = {
        "display_name": auth.display_name or auth.email or "Student",
        "email": auth.email or "",
        "total_sessions": 0,
        "total_problems_solved": 0,
        "total_hints_used": 0,
        "per_pattern_mastery": {},
        "weakness_fingerprint": [],
        "strength_fingerprint": [],
        "weak_patterns": [],
        "learning_velocity": {},
        "recent_strategies": [],
        "patterns_seen": [],
    }
    solved_rows = []
    recent_sessions = []
    misconceptions = []

    if db:
        # 1. Student profile
        try:
            res = db.table("student_profiles") \
                .select("*") \
                .eq("student_id", student_id) \
                .execute()
            if res.data:
                row = res.data[0]
                profile.update({
                    "display_name": row.get("display_name") or profile["display_name"],
                    "email": row.get("email") or profile["email"],
                    "total_sessions": row.get("total_sessions", 0),
                    "total_problems_solved": row.get("total_problems_solved", 0),
                    "total_hints_used": row.get("total_hints_used", 0),
                    "per_pattern_mastery": row.get("per_pattern_mastery") or {},
                    "weakness_fingerprint": row.get("weakness_fingerprint") or [],
                    "strength_fingerprint": row.get("strength_fingerprint") or [],
                    "weak_patterns": row.get("weak_patterns") or [],
                    "learning_velocity": row.get("learning_velocity") or {},
                    "recent_strategies": row.get("recent_strategies") or [],
                    "patterns_seen": row.get("patterns_seen") or [],
                })
        except Exception as exc:
            logger.warning("Failed to load student profile: %s", exc)

        # 2. Solved problems (for heatmap + streak)
        try:
            res = db.table("solved_problems") \
                .select("problem_id, problem_title, pattern, difficulty, solved, hints_used, elapsed_seconds, mastery_level, solved_at") \
                .eq("student_id", student_id) \
                .order("solved_at", desc=True) \
                .execute()
            solved_rows = res.data or []
        except Exception as exc:
            logger.warning("Failed to load solved problems: %s", exc)

        # 3. Recent sessions
        try:
            res = db.table("sessions") \
                .select("id, problem_id, problem_title, phase, hints_used, elapsed_seconds, started_at, solved_at") \
                .eq("student_id", student_id) \
                .order("started_at", desc=True) \
                .limit(8) \
                .execute()
            recent_sessions = res.data or []
        except Exception as exc:
            logger.warning("Failed to load recent sessions: %s", exc)

        # 4. Active misconceptions
        try:
            res = db.table("misconceptions") \
                .select("description, pattern, detected_at") \
                .eq("student_id", student_id) \
                .eq("resolved", False) \
                .order("detected_at", desc=True) \
                .limit(5) \
                .execute()
            misconceptions = res.data or []
        except Exception as exc:
            logger.warning("Failed to load misconceptions: %s", exc)

    # 5. Compute streak + heatmap
    streak, heatmap = _compute_streak_and_heatmap(solved_rows)

    # 6. Daily question — persistent AI recommendation
    daily_question = await _get_or_create_daily_question(student_id, profile)

    return {
        "profile": profile,
        "activity_heatmap": heatmap,
        "streak": streak,
        "recent_sessions": recent_sessions,
        "solved_problems": solved_rows[:10],
        "daily_question": daily_question,
        "misconceptions_active": misconceptions,
    }


# ── Skip / Refresh endpoint ──────────────────────────────────────

@router.post("/question/refresh")
async def refresh_daily_question(auth: AuthUser = Depends(get_current_user_full)):
    """Skip current daily question, generate a new AI recommendation."""
    student_id = auth.id
    db = get_db()

    # Load profile for AI context
    profile = {}
    if db:
        try:
            res = db.table("student_profiles") \
                .select("*") \
                .eq("student_id", student_id) \
                .execute()
            if res.data:
                profile = res.data[0]
        except Exception:
            pass

    new_question = await _skip_and_regenerate(student_id, profile)
    return {"daily_question": new_question}

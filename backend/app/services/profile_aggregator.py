"""
services/profile_aggregator.py
Background job that rebuilds the student's cognitive profile after each session.

Called as a background task after reflection is saved (same pattern as note_generator).
Two entry points:
  - log_solved_problem(): records a solved problem with strategy/mistake extraction
  - rebuild_student_profile(): aggregates all data into the student_profiles row
"""

import asyncio
import json
import logging
import re as _re
from string import Template as _Template
from datetime import datetime, timezone
from typing import Optional

from ..services.database import get_db
from ..services.gemini import get_gemini_model

logger = logging.getLogger(__name__)


# ── Strategy/Mistake Extraction Prompt ────────────────────────────

_EXTRACT_PROMPT = _Template("""\
Analyse this tutoring conversation and extract two things:
1. strategy: The key algorithmic strategy the student used to solve the problem (1 sentence, max 15 words)
2. mistake: The main mistake or misconception the student had during the session (1 sentence, max 15 words). If no significant mistake, use "none".

Conversation (last 10 messages):
$conversation

Respond with ONLY valid JSON. No markdown, no backticks.
{"strategy": "...", "mistake": "..."}
""")


def _build_conversation_snippet(messages: list[dict], max_messages: int = 10) -> str:
    """Extract last N messages as readable text for extraction."""
    recent = messages[-max_messages:] if len(messages) > max_messages else messages
    lines = []
    for m in recent:
        role = "Student" if m.get("role") == "student" else "Tutor"
        content = m.get("content", "").strip()
        if content:
            lines.append(f"{role}: {content[:200]}")
    return "\n".join(lines)


async def log_solved_problem(
    student_id: str,
    session_id: str,
    problem_id: Optional[int],
    problem_title: Optional[str],
    pattern: str,
    difficulty: str,
    hints_used: int,
    elapsed_seconds: int,
    messages: list[dict],
) -> Optional[dict]:
    """
    Record a solved problem entry with AI-extracted strategy and mistake.
    Called when [PROBLEM_SOLVED] fires or during reflection.
    """
    db = get_db()
    if not db:
        logger.warning("log_solved_problem skipped — no DB")
        return None

    # Determine mastery level heuristically
    if hints_used == 0 and elapsed_seconds < 600:
        mastery_level = "generalisation"
    elif hints_used <= 1:
        mastery_level = "application"
    else:
        mastery_level = "recognition"

    # Extract strategy and mistake via Gemini
    strategy_used = None
    key_mistake = None
    try:
        model = get_gemini_model()
        conversation = _build_conversation_snippet(messages)
        if conversation:
            response = await asyncio.to_thread(
                lambda: model.generate_content(
                    _EXTRACT_PROMPT.safe_substitute(conversation=conversation),
                    generation_config={
                        "temperature": 0.2,
                        "response_mime_type": "application/json",
                        "max_output_tokens": 256,
                    },
                )
            )
            raw = response.text.strip() if response.text else ""
            # Robust parse: strip markdown fences, extract JSON object
            raw = _re.sub(r'^```\w*\s*\n?', '', raw, flags=_re.MULTILINE)
            raw = _re.sub(r'\n?```\s*$', '', raw, flags=_re.MULTILINE)
            raw = raw.strip()
            # Find outermost { ... }
            start = raw.find("{")
            end = raw.rfind("}")
            if start != -1 and end > start:
                raw = raw[start : end + 1]
            try:
                data = json.loads(raw)
            except json.JSONDecodeError:
                # Fallback: regex extract
                import re
                s_match = re.search(r'"strategy"\s*:\s*"([^"]*)"', raw)
                m_match = re.search(r'"mistake"\s*:\s*"([^"]*)"', raw)
                data = {
                    "strategy": s_match.group(1) if s_match else "",
                    "mistake": m_match.group(1) if m_match else "none",
                }
            strategy_used = str(data.get("strategy", ""))[:500]
            key_mistake = str(data.get("mistake", ""))[:500]
            if key_mistake and key_mistake.lower() == "none":
                key_mistake = None
    except Exception as exc:
        logger.warning("Strategy extraction failed: %s", exc)

    # Insert into solved_problems
    row = {
        "student_id": student_id,
        "session_id": session_id,
        "problem_id": problem_id,
        "problem_title": problem_title,
        "pattern": pattern,
        "difficulty": difficulty,
        "solved": True,
        "hints_used": hints_used,
        "elapsed_seconds": elapsed_seconds,
        "strategy_used": strategy_used,
        "key_mistake": key_mistake,
        "mastery_level": mastery_level,
        "solved_at": datetime.now(timezone.utc).isoformat(),
    }

    try:
        result = await asyncio.to_thread(
            lambda: db.table("solved_problems").insert(row).execute()
        )
        if result.data:
            logger.info(
                "Logged solved problem: %s (pattern=%s, mastery=%s)",
                problem_title, pattern, mastery_level,
            )

            # ── Auto-mark daily recommendation as solved ──────────
            try:
                await asyncio.to_thread(
                    lambda: db.table("daily_recommendations")
                        .update({
                            "status": "solved",
                            "solved_at": datetime.now(timezone.utc).isoformat(),
                        })
                        .eq("student_id", student_id)
                        .eq("problem_id", problem_id)
                        .eq("status", "active")
                        .execute()
                )
            except Exception as exc:
                logger.debug("Daily recommendation mark-solved (non-critical): %s", exc)

            return result.data[0]
    except Exception as exc:
        logger.warning("Failed to log solved problem: %s", exc)

    return None


async def rebuild_student_profile(student_id: str) -> None:
    """
    Rebuild the student's cognitive profile from all historical data.
    Called as a background task after session reflection.
    """
    db = get_db()
    if not db:
        return

    try:
        # 1. Query all solved problems for this student
        solved_result = await asyncio.to_thread(
            lambda: db.table("solved_problems")
                .select("*")
                .eq("student_id", student_id)
                .order("solved_at", desc=True)
                .execute()
        )
        solved = solved_result.data or []

        # 2. Build pattern mastery map
        pattern_mastery = {}
        mastery_rank = {"recognition": 1, "application": 2, "generalisation": 3}
        rank_to_name = {1: "recognition", 2: "application", 3: "generalisation"}

        for sp in solved:
            pat = sp.get("pattern")
            if not pat:
                continue
            if pat not in pattern_mastery:
                pattern_mastery[pat] = {
                    "level": sp.get("mastery_level", "recognition"),
                    "attempts": 0,
                    "last_seen": sp.get("solved_at", ""),
                }
            entry = pattern_mastery[pat]
            entry["attempts"] += 1

            # Keep the highest mastery level
            current_rank = mastery_rank.get(entry["level"], 0)
            new_rank = mastery_rank.get(sp.get("mastery_level", ""), 0)
            if new_rank > current_rank:
                entry["level"] = rank_to_name[new_rank]

            # Keep the most recent date
            if sp.get("solved_at", "") > entry["last_seen"]:
                entry["last_seen"] = sp["solved_at"]

        # 3. Build weakness fingerprint from unresolved misconceptions
        weakness_fingerprint = []
        try:
            misconceptions_result = await asyncio.to_thread(
                lambda: db.table("misconceptions")
                    .select("description")
                    .eq("student_id", student_id)
                    .eq("resolved", False)
                    .order("detected_at", desc=True)
                    .limit(10)
                    .execute()
            )
            weakness_fingerprint = [
                m["description"]
                for m in (misconceptions_result.data or [])
                if m.get("description")
            ]
        except Exception as exc:
            logger.warning("Weakness query failed: %s", exc)

        # Also add key_mistakes from solved problems (recurring ones)
        mistake_counts: dict[str, int] = {}
        for sp in solved:
            mistake = sp.get("key_mistake")
            if mistake:
                mistake_counts[mistake] = mistake_counts.get(mistake, 0) + 1
        # Add mistakes that appeared 2+ times
        for mistake, count in sorted(mistake_counts.items(), key=lambda x: -x[1]):
            if count >= 2 and mistake not in weakness_fingerprint:
                weakness_fingerprint.append(f"{mistake} (appeared {count}x)")
                if len(weakness_fingerprint) >= 10:
                    break

        # 4. Build strength fingerprint from notes
        strength_fingerprint = []
        try:
            notes_result = await asyncio.to_thread(
                lambda: db.table("notes")
                    .select("title, category")
                    .eq("student_id", student_id)
                    .in_("category", ["technique", "pattern"])
                    .order("created_at", desc=True)
                    .limit(10)
                    .execute()
            )
            strength_fingerprint = [
                n["title"]
                for n in (notes_result.data or [])
                if n.get("title")
            ]
        except Exception as exc:
            logger.warning("Strength query failed: %s", exc)

        # 5. Compute learning velocity per pattern
        learning_velocity = {}
        for pat, info in pattern_mastery.items():
            rank = mastery_rank.get(info["level"], 0)
            if rank >= 2:  # at least application
                learning_velocity[pat] = info["attempts"]

        # 6. Build recent strategies from last 5 solved problems
        recent_strategies = []
        for sp in solved[:5]:
            recent_strategies.append({
                "problem": sp.get("problem_title", "Unknown"),
                "pattern": sp.get("pattern", "unknown"),
                "strategy": sp.get("strategy_used", ""),
                "difficulty": sp.get("difficulty", "Medium"),
                "solved_at": sp.get("solved_at", ""),
            })

        # 7. Upsert into student_profiles
        update_data = {
            "per_pattern_mastery": pattern_mastery,
            "weakness_fingerprint": weakness_fingerprint[:10],
            "strength_fingerprint": strength_fingerprint[:10],
            "learning_velocity": learning_velocity,
            "recent_strategies": recent_strategies,
            "last_active_at": datetime.now(timezone.utc).isoformat(),
        }

        await asyncio.to_thread(
            lambda: db.table("student_profiles")
                .update(update_data)
                .eq("student_id", student_id)
                .execute()
        )

        logger.info(
            "Rebuilt profile for %s: %d patterns, %d weaknesses, %d strengths",
            student_id, len(pattern_mastery),
            len(weakness_fingerprint), len(strength_fingerprint),
        )

    except Exception as exc:
        logger.warning("Profile rebuild failed for %s: %s", student_id, exc)

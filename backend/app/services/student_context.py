"""
services/student_context.py
Builds the per-student context block injected into every tutor prompt.

Reads the student's cognitive profile, recent solved problems, and active
misconceptions, then formats them as a markdown block that the tutor uses
for cross-problem references, weakness probing, and spaced repetition.
"""

import asyncio
import logging
from datetime import datetime, timezone, timedelta
from typing import Optional

from ..services.database import get_db

logger = logging.getLogger(__name__)


async def build_student_context(student_id: str) -> str:
    """
    Build a formatted context block from the student's cognitive profile.
    Returns empty string if no profile exists or DB is unavailable.
    """
    db = get_db()
    if not db:
        return ""

    try:
        # 1. Fetch student profile
        profile_result = await asyncio.to_thread(
            lambda: db.table("student_profiles")
                .select("*")
                .eq("student_id", student_id)
                .limit(1)
                .execute()
        )
        profiles = profile_result.data or []
        if not profiles:
            return ""
        profile = profiles[0]

        # 2. Fetch recent solved problems (last 5)
        solved_result = await asyncio.to_thread(
            lambda: db.table("solved_problems")
                .select("problem_title, pattern, strategy_used, difficulty, mastery_level, solved_at")
                .eq("student_id", student_id)
                .eq("solved", True)
                .order("solved_at", desc=True)
                .limit(5)
                .execute()
        )
        recent_solved = solved_result.data or []

        # 3. Fetch active misconceptions
        misconceptions_result = await asyncio.to_thread(
            lambda: db.table("misconceptions")
                .select("description")
                .eq("student_id", student_id)
                .eq("resolved", False)
                .order("detected_at", desc=True)
                .limit(5)
                .execute()
        )
        active_misconceptions = [
            m["description"]
            for m in (misconceptions_result.data or [])
            if m.get("description")
        ]

    except Exception as exc:
        logger.warning("Failed to load student context for %s: %s", student_id, exc)
        return ""

    # 4. Build the context block
    sections = []
    has_content = False

    # --- Recent Wins ---
    if recent_solved:
        now = datetime.now(timezone.utc)
        seven_days_ago = now - timedelta(days=7)
        recent_wins = []
        for sp in recent_solved:
            solved_at = sp.get("solved_at", "")
            try:
                solved_dt = datetime.fromisoformat(solved_at.replace("Z", "+00:00"))
                if solved_dt >= seven_days_ago:
                    title = sp.get("problem_title", "Unknown")
                    pattern = sp.get("pattern", "")
                    strategy = sp.get("strategy_used", "")
                    line = f'- Solved "{title}"'
                    if pattern:
                        line += f" using {pattern}"
                    if strategy:
                        line += f' — "{strategy}"'
                    recent_wins.append(line)
            except (ValueError, TypeError):
                continue

        if recent_wins:
            sections.append("### Recent Wins (last 7 days)")
            sections.extend(recent_wins)
            sections.append("")
            has_content = True

    # --- Strengths ---
    strengths = profile.get("strength_fingerprint") or []
    if strengths:
        sections.append("### Known Strengths")
        for s in strengths[:5]:
            sections.append(f"- {s}")
        sections.append("")
        has_content = True

    # --- Weaknesses ---
    weaknesses = profile.get("weakness_fingerprint") or []
    all_weaknesses = list(weaknesses)
    for m in active_misconceptions:
        if m not in all_weaknesses:
            all_weaknesses.append(m)
    if all_weaknesses:
        sections.append("### Known Weaknesses (PROBE THESE)")
        for w in all_weaknesses[:5]:
            sections.append(f"- {w}")
        sections.append("")
        has_content = True

    # --- Pattern Mastery ---
    per_pattern = profile.get("per_pattern_mastery") or {}
    if per_pattern:
        sections.append("### Pattern Mastery")
        for pattern, info in sorted(per_pattern.items()):
            if isinstance(info, dict):
                level = info.get("level", "unknown")
                attempts = info.get("attempts", 0)
                sections.append(f"- {pattern}: {level} ({attempts} problem{'s' if attempts != 1 else ''})")
            else:
                sections.append(f"- {pattern}: {info}")
        sections.append("")
        has_content = True

    # --- Spaced Repetition Alerts ---
    spaced_alerts = _build_spaced_repetition_alerts(per_pattern)
    if spaced_alerts:
        sections.append("### Spaced Repetition Alert")
        sections.extend(spaced_alerts)
        sections.append("")
        has_content = True

    # --- Last Session Reference ---
    if recent_solved:
        last = recent_solved[0]
        title = last.get("problem_title", "Unknown")
        pattern = last.get("pattern", "")
        strategy = last.get("strategy_used", "")
        solved_at = last.get("solved_at", "")

        days_ago = _days_since(solved_at)
        if days_ago is not None:
            sections.append("### Last Session")
            time_str = "today" if days_ago == 0 else f"{days_ago} day{'s' if days_ago != 1 else ''} ago"
            line = f'- Problem: "{title}" ({time_str})'
            sections.append(line)
            if pattern:
                sections.append(f"- Pattern: {pattern}")
            if strategy:
                sections.append(f'- Strategy: "{strategy}"')
            sections.append("")
            has_content = True

    if not has_content:
        return ""

    return "## Student Profile\n\n" + "\n".join(sections)


def _build_spaced_repetition_alerts(per_pattern: dict) -> list[str]:
    """Check for patterns that need revisiting (>7 days, low mastery)."""
    alerts = []
    now = datetime.now(timezone.utc)

    for pattern, info in per_pattern.items():
        if not isinstance(info, dict):
            continue

        level = info.get("level", "")
        last_seen = info.get("last_seen", "")
        if level not in ("recognition", "application"):
            continue

        days = _days_since(last_seen)
        if days is not None and days >= 7:
            alerts.append(
                f"- {pattern}: last seen {days} days ago, only {level} level — consider revisiting"
            )

    return alerts


def _days_since(iso_timestamp: str) -> Optional[int]:
    """Return number of days since the given ISO timestamp, or None."""
    if not iso_timestamp:
        return None
    try:
        dt = datetime.fromisoformat(iso_timestamp.replace("Z", "+00:00"))
        delta = datetime.now(timezone.utc) - dt
        return max(0, delta.days)
    except (ValueError, TypeError):
        return None

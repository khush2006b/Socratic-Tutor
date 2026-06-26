"""
services/session_manager.py
Session CRUD operations — persists to Supabase if configured,
falls back to in-memory dict otherwise.

All public functions are async and safe to call regardless of
whether a database is connected.
"""

import asyncio
import logging
import uuid
from datetime import datetime, timezone
from typing import Optional

from .database import get_db
from .tag_parser import ParsedTags

logger = logging.getLogger(__name__)

# ── In-memory fallback store ───────────────────────────────────────
_sessions: dict[str, dict] = {}
_messages: list[dict] = []
_misconceptions: list[dict] = []
_mastery_events: list[dict] = []


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


# ── Session operations ─────────────────────────────────────────────

async def create_session(
    student_id: str,
    problem_id: Optional[int],
    problem_title: Optional[str],
    language: str = "python",
) -> str:
    """
    Create a new session record. Returns the session_id (UUID string).
    """
    session_id = str(uuid.uuid4())
    row = {
        "id": session_id,
        "student_id": student_id,
        "problem_id": problem_id,
        "problem_title": problem_title,
        "language": language,
        "phase": "solving",
        "hints_used": 0,
        "code_edits": 0,
        "elapsed_seconds": 0,
        "started_at": _now(),
    }

    db = get_db()
    if db:
        try:
            result = await asyncio.to_thread(
                lambda: db.table("sessions").insert(row).execute()
            )
            # Use the DB-generated id if available
            if result.data:
                session_id = result.data[0].get("id", session_id)
        except Exception as exc:
            logger.warning("DB session create failed, using in-memory: %s", exc)
            _sessions[session_id] = row
    else:
        _sessions[session_id] = row

    logger.debug("Session created: %s (problem=%s)", session_id, problem_id)
    return session_id


async def update_session(session_id: str, **fields) -> None:
    """Update specific session fields."""
    db = get_db()
    if db:
        try:
            await asyncio.to_thread(
                lambda: db.table("sessions")
                    .update(fields)
                    .eq("id", session_id)
                    .execute()
            )
            return
        except Exception as exc:
            logger.warning("DB session update failed: %s", exc)

    if session_id in _sessions:
        _sessions[session_id].update(fields)


async def end_session(session_id: str, elapsed_seconds: int, phase: str = "complete") -> None:
    """Mark a session as ended."""
    await update_session(
        session_id,
        phase=phase,
        elapsed_seconds=elapsed_seconds,
        ended_at=_now(),
    )


async def mark_problem_solved(session_id: str, student_id: str) -> None:
    """
    Called mid-session when AI emits [PROBLEM_SOLVED].
    Updates session phase to 'solved' and increments student stats immediately.
    """
    logger.info("Problem solved — session=%s, student=%s", session_id, student_id[:8] + "…")
    db = get_db()

    # Mark session as solved
    await update_session(session_id, phase="solved", solved_at=_now())

    if not db:
        return

    # Increment problems solved on profile (non-blocking, best-effort)
    try:
        existing = await asyncio.to_thread(
            lambda: db.table("student_profiles")
                .select("total_problems_solved")
                .eq("student_id", student_id)
                .single()
                .execute()
        )
        current = (existing.data or {}).get("total_problems_solved", 0) or 0
        await asyncio.to_thread(
            lambda: db.table("student_profiles").update({
                "total_problems_solved": current + 1,
                "last_active_at":        _now(),
            }).eq("student_id", student_id).execute()
        )
        logger.info("Profile updated — problems_solved=%d for student=%s", current + 1, student_id[:8] + "…")
    except Exception as exc:
        logger.warning("mark_problem_solved profile update failed: %s", exc)


# ── Grounding operations ──────────────────────────────────────────

async def save_grounding(session_id: str, grounding_json: dict) -> None:
    """Persist the extracted problem grounding JSON to the session."""
    import json as _json
    db = get_db()
    if db:
        try:
            await asyncio.to_thread(
                lambda: db.table("sessions")
                    .update({"grounding_json": grounding_json})
                    .eq("id", session_id)
                    .execute()
            )
            logger.debug("Grounding saved for session %s", session_id)
            return
        except Exception as exc:
            logger.warning("DB grounding save failed: %s", exc)

    if session_id in _sessions:
        _sessions[session_id]["grounding_json"] = grounding_json


async def load_grounding(session_id: str) -> dict | None:
    """Load the problem grounding JSON from the session."""
    db = get_db()
    if db:
        try:
            result = await asyncio.to_thread(
                lambda: db.table("sessions")
                    .select("grounding_json")
                    .eq("id", session_id)
                    .single()
                    .execute()
            )
            return (result.data or {}).get("grounding_json")
        except Exception as exc:
            logger.warning("DB grounding load failed: %s", exc)

    session = _sessions.get(session_id, {})
    return session.get("grounding_json")


async def update_student_grounding(session_id: str, student_grounding: dict) -> None:
    """Update the dynamic student-specific grounding state for a session."""
    db = get_db()
    if db:
        try:
            await asyncio.to_thread(
                lambda: db.table("sessions")
                    .update({"student_grounding": student_grounding})
                    .eq("id", session_id)
                    .execute()
            )
            return
        except Exception as exc:
            logger.warning("DB student_grounding update failed: %s", exc)

    if session_id in _sessions:
        _sessions[session_id]["student_grounding"] = student_grounding


async def load_student_grounding(session_id: str) -> dict:
    """Load the student-specific grounding state from the session."""
    db = get_db()
    if db:
        try:
            result = await asyncio.to_thread(
                lambda: db.table("sessions")
                    .select("student_grounding")
                    .eq("id", session_id)
                    .single()
                    .execute()
            )
            return (result.data or {}).get("student_grounding") or {}
        except Exception as exc:
            logger.warning("DB student_grounding load failed: %s", exc)

    session = _sessions.get(session_id, {})
    return session.get("student_grounding", {})


# ── Message operations ─────────────────────────────────────────────

async def save_message(session_id: str, role: str, content: str) -> None:
    """
    Persist a single conversation turn.
    Role must be 'tutor' or 'student'.
    """
    row = {
        "session_id": session_id,
        "role": role,
        "content": content,
        "created_at": _now(),
    }

    db = get_db()
    if db:
        try:
            await asyncio.to_thread(
                lambda: db.table("messages").insert(row).execute()
            )
            return
        except Exception as exc:
            logger.warning("DB message save failed: %s", exc)

    _messages.append(row)


# ── Reflection operations ──────────────────────────────────────────

async def save_reflection(
    session_id: str,
    student_id: str,
    problem_id: Optional[int],
    problem_title: Optional[str],
    answers: dict[str, str],
    hints_used: int,
    elapsed_seconds: int,
) -> None:
    """Persist the post-session reflection answers."""
    row = {
        "session_id": session_id,
        "student_id": student_id,
        "problem_id": problem_id,
        "problem_title": problem_title,
        "pattern_answer":  answers.get("pattern"),
        "insight_answer":  answers.get("insight"),
        "stuck_answer":    answers.get("stuck"),
        "transfer_answer": answers.get("transfer"),
        "hints_used": hints_used,
        "elapsed_seconds": elapsed_seconds,
        "created_at": _now(),
    }

    db = get_db()
    if db:
        try:
            await asyncio.to_thread(
                lambda: db.table("reflections").insert(row).execute()
            )
        except Exception as exc:
            logger.warning("DB reflection save failed: %s", exc)


# ── Tag persistence ────────────────────────────────────────────────

async def persist_tags(
    session_id: str,
    student_id: str,
    problem_id: Optional[int],
    pattern: Optional[str],
    tags: ParsedTags,
) -> None:
    """
    Persist validated tags extracted from a Gemini response.
    Runs as a background fire-and-forget task — never blocks the stream.
    """
    db = get_db()

    # Misconceptions
    for desc in tags.misconceptions:
        row = {
            "session_id": session_id,
            "student_id": student_id,
            "problem_id": problem_id,
            "pattern":    pattern,
            "description": desc,
            "resolved":   False,
            "detected_at": _now(),
        }
        if db:
            try:
                await asyncio.to_thread(
                    lambda r=row: db.table("misconceptions").insert(r).execute()
                )
            except Exception as exc:
                logger.warning("DB misconception insert failed: %s", exc)
        else:
            _misconceptions.append(row)

    # Mastery events
    for event in tags.mastery_events:
        row = {
            "session_id": session_id,
            "student_id": student_id,
            "pattern":    event["pattern"],
            "level":      event["level"],
            "problem_id": problem_id,
            "recorded_at": _now(),
        }
        if db:
            try:
                await asyncio.to_thread(
                    lambda r=row: db.table("mastery_events").insert(r).execute()
                )
            except Exception as exc:
                logger.warning("DB mastery event insert failed: %s", exc)
        else:
            _mastery_events.append(row)


# ── Student profile ────────────────────────────────────────────────

async def upsert_student_profile(
    student_id:    str,
    email:         str  = "",
    display_name:  str  = "",
    problem_id:    Optional[int] = None,
    problem_title: Optional[str] = None,
) -> None:
    """
    Create or update the student profile at session START.
    Updates contact info, last active time, and last problem.
    Does NOT increment counters — that happens at session completion.
    """
    db = get_db()
    if not db:
        return

    row: dict = {
        "student_id":         student_id,
        "email":              email,
        "display_name":       display_name,
        "last_active_at":     _now(),
    }
    if problem_title:
        row["last_problem_title"] = problem_title
    if problem_id is not None:
        row["last_problem_id"] = problem_id

    try:
        await asyncio.to_thread(
            lambda: db.table("student_profiles").upsert(
                row, on_conflict="student_id",
            ).execute()
        )
    except Exception as exc:
        logger.warning("DB student profile upsert failed: %s", exc)


async def complete_student_profile(
    student_id:    str,
    email:         str  = "",
    display_name:  str  = "",
    problem_id:    Optional[int]  = None,
    problem_title: Optional[str]  = None,
    problem:       Optional[dict] = None,
    hints_used:    int  = 0,
) -> None:
    """
    Called when a session COMPLETES (reflection submitted).
    Increments total_sessions, total_problems_solved, total_hints_used.
    Appends to problems_attempted and patterns_seen arrays.
    Uses real column names from the Supabase schema.
    """
    db = get_db()
    if not db:
        return

    # Extract patterns from problem dict
    patterns: list[str] = []
    if problem and isinstance(problem, dict):
        patterns = problem.get("patterns") or []

    try:
        # Read current profile so we can safely append to arrays
        existing = await asyncio.to_thread(
            lambda: db.table("student_profiles")
                .select(
                    "total_sessions, total_problems_solved, total_hints_used, "
                    "problems_attempted, patterns_seen"
                )
                .eq("student_id", student_id)
                .single()
                .execute()
        )
        d = existing.data or {}

        # Build updated arrays (append new values, deduplicate)
        attempted: list = list(d.get("problems_attempted") or [])
        if problem_id and problem_id not in attempted:
            attempted.append(problem_id)

        seen_patterns: list = list(d.get("patterns_seen") or [])
        for p in patterns:
            if p and p not in seen_patterns:
                seen_patterns.append(p)

        update_row = {
            "student_id":           student_id,
            "email":                email,
            "display_name":         display_name,
            "last_active_at":       _now(),
            "total_sessions":       (d.get("total_sessions",       0) or 0) + 1,
            # NOTE: total_problems_solved is NOT incremented here —
            #       mark_problem_solved() already handles it mid-session
            "total_hints_used":     (d.get("total_hints_used",      0) or 0) + hints_used,
            "problems_attempted":   attempted,
            "patterns_seen":        seen_patterns,
        }
        if problem_title:
            update_row["last_problem_title"] = problem_title
        if problem_id is not None:
            update_row["last_problem_id"] = problem_id

        await asyncio.to_thread(
            lambda: db.table("student_profiles")
                .upsert(update_row, on_conflict="student_id")
                .execute()
        )
        logger.info(
            "Profile updated on completion — student=%s, problem=%s, patterns=%s",
            student_id[:8] + "…", problem_title, patterns,
        )

    except Exception as exc:
        logger.warning("DB profile completion update failed: %s", exc)


# ── Calibration state persistence ──────────────────────────────────

async def load_calibration_state(session_id: str) -> dict | None:
    """
    Load calibration state for a session (returns None on first message).
    Stored as JSONB on the sessions table.
    """
    db = get_db()
    if not db:
        return None

    try:
        result = await asyncio.to_thread(
            lambda: db.table("sessions")
                .select("calibration_state")
                .eq("id", session_id)
                .single()
                .execute()
        )
        data = (result.data or {}).get("calibration_state")
        return data if data else None
    except Exception as exc:
        logger.warning("Failed to load calibration state: %s", exc)
        return None


async def save_calibration_state(session_id: str, state: dict) -> None:
    """
    Persist calibration state to the sessions table (JSONB column).
    Called after each turn by the persist_data graph node.
    """
    db = get_db()
    if not db:
        return

    try:
        await asyncio.to_thread(
            lambda: db.table("sessions")
                .update({"calibration_state": state})
                .eq("id", session_id)
                .execute()
        )
    except Exception as exc:
        logger.warning("Failed to save calibration state: %s", exc)


# ── Read operations (for dashboard — Stage 3) ─────────────────────

async def get_student_sessions(student_id: str, limit: int = 20) -> list[dict]:
    """Return recent sessions for a student."""
    db = get_db()
    if db:
        try:
            result = await asyncio.to_thread(
                lambda: db.table("sessions")
                    .select("id, problem_title, phase, hints_used, elapsed_seconds, started_at")
                    .eq("student_id", student_id)
                    .order("started_at", desc=True)
                    .limit(limit)
                    .execute()
            )
            return result.data or []
        except Exception as exc:
            logger.warning("DB get sessions failed: %s", exc)

    return [s for s in _sessions.values() if s.get("student_id") == student_id]


async def get_student_misconceptions(student_id: str, resolved: bool = False) -> list[dict]:
    """Return active (unresolved) misconceptions for a student."""
    db = get_db()
    if db:
        try:
            result = await asyncio.to_thread(
                lambda: db.table("misconceptions")
                    .select("*")
                    .eq("student_id", student_id)
                    .eq("resolved", resolved)
                    .order("detected_at", desc=True)
                    .execute()
            )
            return result.data or []
        except Exception as exc:
            logger.warning("DB get misconceptions failed: %s", exc)

    return [m for m in _misconceptions if m.get("student_id") == student_id]

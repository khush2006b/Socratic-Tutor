"""
routers/sessions.py
Session management endpoints — all protected by JWT auth.

POST /api/sessions/{session_id}/reflect   → save reflection + end session
GET  /api/sessions/student/me             → list authenticated student's sessions
GET  /api/sessions/student/me/misconceptions → active misconceptions
"""

import logging
from datetime import datetime, timezone
from fastapi import APIRouter, BackgroundTasks, Depends

from ..middleware.auth import get_current_user_full, AuthUser
from ..models.session import ReflectionSubmission, SessionSummary
from ..services.session_manager import (
    save_reflection,
    end_session,
    get_student_sessions,
    get_student_misconceptions,
    upsert_student_profile,
    complete_student_profile,
)
from ..services.note_generator import generate_session_notes
from ..services.profile_aggregator import rebuild_student_profile, log_solved_problem

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/sessions", tags=["sessions"])


@router.post("/{session_id}/reflect", response_model=SessionSummary)
async def save_session_reflection(
    session_id: str,
    reflection: ReflectionSubmission,
    background_tasks: BackgroundTasks,
    auth: AuthUser = Depends(get_current_user_full),
):
    """
    Save reflection and mark session complete.
    student_id is taken from the verified JWT — never from the request body.
    """
    student_id = auth.id   # Always use the real authenticated user, never the body field

    logger.info(
        "Reflection: session=%s, student=%s (%s), problem=%s",
        session_id,
        student_id[:8] + "…",
        auth.email,
        reflection.problem_title,
    )

    saved_at = datetime.now(timezone.utc).isoformat()

    # Persist reflection
    background_tasks.add_task(
        save_reflection,
        session_id=session_id,
        student_id=student_id,         # ← real user ID from JWT, never "anonymous"
        problem_id=reflection.problem_id,
        problem_title=reflection.problem_title,
        answers=reflection.answers,
        hints_used=reflection.hints_used,
        elapsed_seconds=reflection.elapsed_seconds,
    )

    # End session
    background_tasks.add_task(
        end_session,
        session_id=session_id,
        elapsed_seconds=reflection.elapsed_seconds,
        phase="complete",
    )

    # Update profile stats on session completion (increments counters + arrays)
    background_tasks.add_task(
        complete_student_profile,
        student_id    = student_id,
        email         = auth.email,
        display_name  = auth.display_name,
        problem_id    = reflection.problem_id,
        problem_title = reflection.problem_title,
        problem       = reflection.problem_data,
        hints_used    = reflection.hints_used,
    )

    # Generate AI notes in the background — non-blocking
    background_tasks.add_task(
        generate_session_notes,
        session_id     = session_id,
        student_id     = student_id,
        problem_title  = reflection.problem_title,
        problem        = reflection.problem_data,
        messages       = reflection.messages or [],
        reflection     = reflection.answers or {},
        hints_used     = reflection.hints_used,
        elapsed_seconds= reflection.elapsed_seconds,
    )

    # Log solved problem + rebuild cognitive profile
    problem_data = reflection.problem_data or {}
    pattern = (problem_data.get("patterns") or ["general"])[0] if problem_data else "general"
    difficulty = problem_data.get("difficulty", "Medium") if problem_data else "Medium"

    background_tasks.add_task(
        log_solved_problem,
        student_id      = student_id,
        session_id      = session_id,
        problem_id      = reflection.problem_id,
        problem_title   = reflection.problem_title,
        pattern         = pattern,
        difficulty      = difficulty,
        hints_used      = reflection.hints_used,
        elapsed_seconds = reflection.elapsed_seconds,
        messages        = reflection.messages or [],
    )

    background_tasks.add_task(
        rebuild_student_profile,
        student_id = student_id,
    )

    return SessionSummary(
        session_id=session_id,
        problem_id=reflection.problem_id,
        reflection=reflection,
        saved_at=saved_at,
    )


@router.get("/student/me")
async def list_my_sessions(
    limit: int = 20,
    auth: AuthUser = Depends(get_current_user_full),
):
    """Return the authenticated student's recent sessions."""
    sessions = await get_student_sessions(auth.id, limit=limit)
    return {
        "student_id":   auth.id,
        "display_name": auth.display_name,
        "sessions":     sessions,
    }


@router.get("/student/me/misconceptions")
async def list_my_misconceptions(
    auth: AuthUser = Depends(get_current_user_full),
):
    """Return active (unresolved) misconceptions for the authenticated student."""
    misconceptions = await get_student_misconceptions(auth.id, resolved=False)
    return {
        "student_id":     auth.id,
        "misconceptions": misconceptions,
    }

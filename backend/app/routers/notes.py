"""
routers/notes.py
Notes endpoints — all protected by JWT auth.

GET  /api/notes/me              → all notes for authenticated student
GET  /api/notes/me?category=X   → filtered by category
GET  /api/notes/session/{id}    → notes for a specific session
"""

import asyncio
import logging
from typing import Optional
from fastapi import APIRouter, Depends, Query

from ..middleware.auth import get_current_user_full, AuthUser
from ..models.note     import NotesResponse, NoteOut
from ..services.database import get_db

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/notes", tags=["notes"])


async def _fetch_notes(
    student_id: str,
    category:   Optional[str] = None,
    session_id: Optional[str] = None,
    limit:      int = 200,
) -> list[dict]:
    db = get_db()
    if not db:
        return []
    try:
        q = db.table("notes").select("*").eq("student_id", student_id)
        if category:
            q = q.eq("category", category)
        if session_id:
            q = q.eq("session_id", session_id)
        result = await asyncio.to_thread(
            lambda: q.order("created_at", desc=True).limit(limit).execute()
        )
        return result.data or []
    except Exception as exc:
        logger.warning("DB notes fetch failed: %s", exc)
        return []


@router.get("/me", response_model=NotesResponse)
async def get_my_notes(
    category: Optional[str] = Query(default=None, description="Filter: mistake|technique|insight|pattern"),
    auth:     AuthUser = Depends(get_current_user_full),
):
    """Return all notes for the authenticated student, optionally filtered by category."""
    if category and category not in ("mistake", "technique", "insight", "pattern"):
        category = None
    notes = await _fetch_notes(auth.id, category=category)
    return NotesResponse(
        student_id=auth.id,
        notes=[NoteOut(**n) for n in notes],
        total=len(notes),
    )


@router.get("/session/{session_id}", response_model=NotesResponse)
async def get_session_notes(
    session_id: str,
    auth:       AuthUser = Depends(get_current_user_full),
):
    """Return notes for a specific session (must belong to authenticated student)."""
    notes = await _fetch_notes(auth.id, session_id=session_id)
    return NotesResponse(
        student_id=auth.id,
        notes=[NoteOut(**n) for n in notes],
        total=len(notes),
    )

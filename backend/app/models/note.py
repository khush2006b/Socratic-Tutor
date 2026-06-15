"""
models/note.py
Pydantic models for the Notes feature.
"""

from typing import Optional, List
from pydantic import BaseModel


class NoteOut(BaseModel):
    id:            str
    student_id:    str
    session_id:    Optional[str]
    problem_id:    Optional[int]
    problem_title: Optional[str]
    category:      str   # 'mistake' | 'technique' | 'insight' | 'pattern' | 'process'
    title:         str
    content:       str
    tags:          List[str] = []
    created_at:    Optional[str]

    model_config = {"from_attributes": True}


class NotesResponse(BaseModel):
    student_id: str
    notes:      List[NoteOut]
    total:      int

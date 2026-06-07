"""
models/tutor.py
Request/response models for the tutor streaming endpoint.
Uses Annotated for Pydantic v2-compatible field aliases.
"""

from typing import Annotated, Optional
from pydantic import BaseModel, Field
from .problem import Problem
from .session import ObservableSignals


class ChatMessage(BaseModel):
    role: str   # "tutor" | "student"
    content: str
    timestamp: Optional[str] = None


class TutorStreamRequest(BaseModel):
    """
    Payload sent from the frontend to /api/tutor/stream.
    Uses Annotated aliases for Pydantic v2 compatibility.
    """
    student_id: str = Field(default="anonymous")
    session_id: Annotated[Optional[str], Field(alias="sessionId")] = None
    problem: Optional[Problem] = None
    code: str = ""
    language: str = "python"
    messages: list[ChatMessage] = []
    hint_level_index: Annotated[int, Field(alias="hintLevelIndex")] = -1
    signals: ObservableSignals = Field(default_factory=ObservableSignals)
    voice_mode: Annotated[bool, Field(alias="voiceMode")] = False

    model_config = {"populate_by_name": True}


class HintRequest(BaseModel):
    next_hint_index: Annotated[int, Field(alias="nextHintIndex", ge=0, le=3)]
    problem: Optional[Problem] = None
    code: str = ""

    model_config = {"populate_by_name": True}


class HintResponse(BaseModel):
    level: str
    label: str
    content: str

"""
models/session.py
Session and signal tracking models.
"""

from pydantic import BaseModel, Field
from typing import Optional



class ObservableSignals(BaseModel):
    """
    Probabilistic signals inferred from student behaviour.
    NOT authoritative state — used to inform tutoring decisions.
    Accepts both camelCase (frontend) and snake_case via aliases.
    """
    struggle_intensity: int = Field(default=0, alias="struggleIntensity", ge=0, le=10)
    hints_requested: int = Field(default=0, alias="hintsRequested")
    code_edits: int = Field(default=0, alias="codeEdits")
    voice_reasoning_given: bool = Field(default=False, alias="voiceReasoningGiven")
    message_count: int = Field(default=0, alias="messageCount")
    avg_message_length: int = Field(default=0, alias="avgMessageLength")
    short_replies_streak: int = Field(default=0, alias="shortRepliesStreak")

    model_config = {"populate_by_name": True}


class ReflectionSubmission(BaseModel):
    student_id:      Optional[str]       = None
    problem_id:      Optional[int]       = None
    problem_title:   Optional[str]       = None
    problem_data:    Optional[dict]      = None    # full problem object for note generation
    messages:        Optional[list]      = None    # full conversation for note generation
    answers:         dict[str, str]      = {}
    hints_used:      int                 = 0
    elapsed_seconds: int                 = 0
    timestamp:       str                 = ""


class SessionSummary(BaseModel):
    session_id: str
    problem_id: Optional[int]
    reflection: Optional[ReflectionSubmission]
    saved_at: str

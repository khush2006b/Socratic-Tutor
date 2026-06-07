"""
graph/state.py
Typed state shared across all LangGraph tutor nodes.
"""

from typing import TypedDict, Optional


class TutorState(TypedDict):
    # ── Input from the frontend / router ──────────────────────────
    student_id: str
    session_id: Optional[str]       # None on first message → created in ensure_session
    problem: Optional[dict]         # serialised Problem model
    code: str
    language: str
    messages: list[dict]            # [{ role, content, timestamp }]
    hint_level_index: int
    signals: dict                   # { struggleIntensity, hintsRequested, ... }
    voice_mode: bool                # True when student is in voice conversation mode

    # ── Built during graph execution ───────────────────────────────
    context_prompt: str             # assembled by build_context
    lc_messages: list               # LangChain message objects
    full_response: str              # complete Gemini response text
    parsed_tags: dict               # { misconceptions, mastery_events, visualizations }
    calibration_state: dict         # CalibrationState serialized as dict
    error: Optional[str]


class HintState(TypedDict):
    # ── Input ───────────────────────────────────────────────────
    hint_index: int
    problem: Optional[dict]
    code: str

    # ── Built ───────────────────────────────────────────────────
    prompt: str
    hint_content: str

"""
graph/nodes.py
All LangGraph node functions for the SocraticDS tutoring pipeline.

Node execution order:
  build_context → generate_response → parse_tags → persist_data

Session creation happens in the router (before the graph) so the
session_id is available for the X-Session-Id response header.
"""

import logging

from langchain_core.messages import SystemMessage, HumanMessage, AIMessage

from ..config import get_settings
from ..services.socratic_prompt import SYSTEM_PROMPT, build_context_prompt
from ..services.tag_parser import parse_tags, ParsedTags, strip_voice_tags
from ..services.session_manager import save_message, persist_tags, load_calibration_state, save_calibration_state
from ..services.student_context import build_student_context
from ..services.calibration import CalibrationState
from .state import TutorState, HintState

logger = logging.getLogger(__name__)


# ── LLM singletons ────────────────────────────────────────────────

_primary_llm = None
_fallback_llm = None


def get_llm(use_fallback: bool = False):
    """
    Return a ChatGoogleGenerativeAI instance.
    Primary  : gemini-2.5-flash (from config / .env)
    Fallback : gemini-1.5-flash (higher free-tier quota — 1500 req/day)

    max_retries=0 disables LangChain's built-in tenacity retry loop so
    our own fallback logic fires immediately on a 429, instead of waiting
    8–16 seconds per retry before we see the error.
    """
    global _primary_llm, _fallback_llm

    from langchain_google_genai import ChatGoogleGenerativeAI
    settings = get_settings()

    if use_fallback:
        if _fallback_llm is None:
            _fallback_llm = ChatGoogleGenerativeAI(
                model="gemini-1.5-flash",
                google_api_key=settings.gemini_api_key,
                temperature=0.7,
                top_p=0.9,
                max_output_tokens=1536,
                streaming=True,
                max_retries=0,          # no tenacity retry — we handle fallback ourselves
            )
            logger.info("Fallback LLM initialised: gemini-1.5-flash")
        return _fallback_llm

    if _primary_llm is None:
        _primary_llm = ChatGoogleGenerativeAI(
            model=settings.gemini_model,
            google_api_key=settings.gemini_api_key,
            temperature=0.7,
            top_p=0.9,
            max_output_tokens=2048,
            streaming=True,
            max_retries=0,              # no tenacity retry — we handle fallback ourselves
        )
        logger.info("Primary LLM initialised: %s", settings.gemini_model)
    return _primary_llm


# ── Loop detection ────────────────────────────────────────────────

def _is_looping(messages: list[dict], threshold: int = 3) -> bool:
    """
    Check if the last N tutor messages are semantically repeating.
    Compares first 50 chars of each — if all identical starts, it's looping.
    """
    logger.info("Roles in last 8 messages: %s", [m.get("role") for m in messages[-8:]])
    tutor_msgs = [
        m["content"] for m in messages[-8:]
        if m.get("role") in ("tutor", "assistant") and m.get("content")
    ]
    if len(tutor_msgs) < threshold:
        return False
    last_n = tutor_msgs[-threshold:]
    first_words = [m[:50].strip().lower() for m in last_n]
    return len(set(first_words)) == 1  # all identical starts


# ── Helper: parse frontend message list into LangChain messages ───

def _build_lc_messages(
    messages: list[dict],
    context_prompt: str,
    force_direct_answer: bool = False,
) -> list:
    """
    Convert frontend message dicts to LangChain message objects.
    Context is merged into SystemMessage so it stays at highest priority
    regardless of conversation length.
    """
    override = ""
    if force_direct_answer:
        override = (
            "\n\n**⚠️ OVERRIDE — LOOP DETECTED:**\n"
            "The student has been stuck on this exact point for 3+ turns. "
            "You MUST directly state the answer in ONE sentence, "
            "then move to the NEXT concept. Do NOT rephrase the same question.\n"
        )

    # System message = base prompt + current context + override
    # This ensures context is always at highest priority position
    full_system = f"{SYSTEM_PROMPT}\n\n---\n\n{context_prompt}{override}"
    lc = [SystemMessage(content=full_system)]

    for msg in messages:
        role    = msg.get("role", "")
        content = msg.get("content", "")
        if not content:
            continue
        if role == "student":
            lc.append(HumanMessage(content=content))
        elif role in ("tutor", "assistant"):
            lc.append(AIMessage(content=content))

    # If last message isn't from student, add a nudge
    if not lc or not isinstance(lc[-1], HumanMessage):
        lc.append(HumanMessage(content="Please continue."))

    return lc


# ── Node 1: build_context ─────────────────────────────────────────

async def build_context(state: TutorState) -> dict:
    """
    Assemble the per-turn Socratic context prompt and build the
    LangChain message list that will be sent to Gemini.
    """
    from ..models.problem import Problem
    from ..models.session import ObservableSignals
    from ..models.tutor import ChatMessage

    # Deserialise problem (tolerant — map id → leetcodeId if needed)
    problem = None
    if state.get("problem"):
        try:
            prob_data = dict(state["problem"])
            if "leetcodeId" not in prob_data and "id" in prob_data:
                prob_data["leetcodeId"] = prob_data["id"]
            problem = Problem(**prob_data)
        except Exception as exc:
            logger.warning("Could not parse problem: %s", exc)

    # Deserialise signals (accept camelCase from frontend)
    sig = state.get("signals", {})
    signals = ObservableSignals(
        **{
            "struggleIntensity": sig.get("struggleIntensity", sig.get("struggle_intensity", 0)),
            "hintsRequested":    sig.get("hintsRequested",    sig.get("hints_requested", 0)),
            "codeEdits":         sig.get("codeEdits",         sig.get("code_edits", 0)),
            "voiceReasoningGiven": sig.get("voiceReasoningGiven", sig.get("voice_reasoning_given", False)),
        }
    )

    messages = [ChatMessage(**m) for m in state.get("messages", [])]

    # Load or create calibration state
    cal_dict = state.get("calibration_state") or {}
    if not cal_dict and state.get("session_id"):
        # Try loading from DB (persisted from previous turn)
        try:
            cal_dict = await load_calibration_state(state["session_id"]) or {}
        except Exception:
            cal_dict = {}
    calibration = CalibrationState.from_dict(cal_dict)

    # Update calibration from frontend signals
    calibration.update_from_frontend_signals(sig)

    # Load cross-session student profile context
    student_ctx = state.get("student_context", "")
    if not student_ctx and state.get("student_id"):
        try:
            student_ctx = await build_student_context(state["student_id"])
        except Exception as exc:
            logger.warning("Failed to build student context: %s", exc)
            student_ctx = ""

    context = build_context_prompt(
        problem=problem,
        code=state.get("code", ""),
        language=state.get("language", "python"),
        messages=messages,
        hint_level_index=state.get("hint_level_index", -1),
        signals=signals,
        voice_mode=state.get("voice_mode", False),
        calibration_state=calibration,
        student_context=student_ctx,
    )

    # Detect if tutor is looping (same question 3+ times)
    raw_messages = state.get("messages", [])
    looping = _is_looping(raw_messages)
    if looping:
        logger.warning("Loop detected — injecting direct-answer override")

    lc_messages = _build_lc_messages(raw_messages, context, force_direct_answer=looping)

    logger.info(
        "build_context: %d messages, %d LangChain msgs, looping=%s",
        len(raw_messages), len(lc_messages), looping,
    )

    return {
        "student_context": student_ctx,
        "context_prompt": context,
        "lc_messages": lc_messages,
        "calibration_state": calibration.to_dict(),
    }


# ── Node 2: generate_response ─────────────────────────────────────

async def generate_response(state: TutorState) -> dict:
    """
    Call Gemini via ChatGoogleGenerativeAI.
    On 429 rate-limit, automatically falls back to gemini-1.5-flash
    (1500 req/day free tier) without failing the request.
    """
    lc_messages = state.get("lc_messages", [])

    for use_fallback in (False, True):
        llm = get_llm(use_fallback=use_fallback)
        model_label = "gemini-1.5-flash (fallback)" if use_fallback else "primary"
        try:
            response = await llm.ainvoke(lc_messages)
            if use_fallback:
                logger.info("Used fallback model successfully")

            # Guard against empty / truncated responses
            response_text = response.content.strip() if response.content else ""
            if not response_text:
                logger.warning("Empty response from %s — using fallback message", model_label)
                response_text = (
                    "Let me think about that differently. [PAUSE:1] "
                    "Can you walk me through your reasoning step by step? [WAIT]"
                )

            return {"full_response": response_text, "error": None}
        except Exception as exc:
            err_str = str(exc)
            is_rate_limit = "429" in err_str or "RESOURCE_EXHAUSTED" in err_str or "quota" in err_str.lower()
            if is_rate_limit and not use_fallback:
                logger.warning("Primary model rate-limited — switching to gemini-1.5-flash fallback")
                continue   # retry with fallback
            logger.exception("Gemini call failed (%s): %s", model_label, exc)
            friendly = (
                "Rate limit reached for both models. Please wait a minute and try again."
                if is_rate_limit
                else err_str
            )
            return {"full_response": "", "error": friendly}

    return {"full_response": "", "error": "All models exhausted"}



# ── Node 3: parse_tags ────────────────────────────────────────────

async def parse_tags_node(state: TutorState) -> dict:
    """
    Extract structured tags from the Gemini response.
    Tags inform the frontend and are persisted to the DB.
    """
    full_response = state.get("full_response", "")
    if not full_response:
        return {"parsed_tags": {}}

    tags = parse_tags(full_response)

    # Update calibration state from LLM calibration tags
    cal_dict = dict(state.get("calibration_state") or {})
    calibration = CalibrationState.from_dict(cal_dict)
    for cal_signal in tags.calibration_signals:
        calibration.update_from_calibration_tag(cal_signal)
    if tags.calibration_signals:
        logger.info(
            "Calibration updated — mode=%s, reasoning=%.1f, frustration=%.1f, confusion=%.1f",
            calibration.dialogue_mode, calibration.reasoning_quality,
            calibration.frustration, calibration.confusion,
        )

    return {
        "parsed_tags": {
            "misconceptions":  tags.misconceptions,
            "mastery_events":  tags.mastery_events,
            "visualizations":  tags.visualizations,
            "calibration_signals": tags.calibration_signals,
            "wait_seconds":    tags.wait_seconds,
            "clean_text":      tags.clean_text,
            "problem_solved":  tags.problem_solved,
        },
        "calibration_state": calibration.to_dict(),
    }


# ── Node 4: persist_data ──────────────────────────────────────────

async def persist_data(state: TutorState) -> dict:
    """
    Persist tutor message and any extracted tags to Supabase.
    Always returns {} — failures are logged but never crash the graph.
    """
    session_id    = state.get("session_id")
    full_response = state.get("full_response", "")
    tags_data     = state.get("parsed_tags", {})
    problem_data  = state.get("problem")

    if not session_id or not full_response:
        return {}

    try:
        # Strip voice dialogue tags before saving — keeps text chat clean
        db_text = strip_voice_tags(full_response) if state.get("voice_mode") else full_response
        await save_message(session_id, "tutor", db_text)
    except Exception as exc:
        logger.warning("Failed to save tutor message: %s", exc)

    try:
        tags = ParsedTags(
            misconceptions=tags_data.get("misconceptions", []),
            mastery_events=tags_data.get("mastery_events", []),
            visualizations=tags_data.get("visualizations", []),
        )
        if tags.misconceptions or tags.mastery_events:
            await persist_tags(
                session_id=session_id,
                student_id=state["student_id"],
                problem_id=problem_data.get("id") if problem_data else None,
                pattern=(problem_data.get("patterns") or [None])[0] if problem_data else None,
                tags=tags,
            )
    except Exception as exc:
        logger.warning("Failed to persist tags: %s", exc)

    # Save calibration state to session for next turn
    cal_dict = state.get("calibration_state")
    if cal_dict and session_id:
        try:
            await save_calibration_state(session_id, cal_dict)
        except Exception as exc:
            logger.warning("Failed to save calibration state: %s", exc)

    return {}


# ── Hint nodes ────────────────────────────────────────────────────

HINT_LEVEL_NAMES = ["conceptual", "directional", "structural", "code-level"]


async def build_hint_prompt(state: HintState) -> dict:
    """Build the prompt for hint generation."""
    idx          = state["hint_index"]
    level_name   = HINT_LEVEL_NAMES[min(idx, 3)]
    problem_data = state.get("problem")
    code         = state.get("code", "").strip()

    problem_title = problem_data.get("title", "the problem") if problem_data else "the problem"
    pattern       = (problem_data.get("patterns") or ["general"])[0] if problem_data else "general"

    code_section = ""
    if code:
        code_section = f"\nStudent's current code:\n```\n{code[:600]}\n```"

    prompt = (
        f"You are a Socratic DSA tutor. The student is working on **{problem_title}** "
        f"(pattern: {pattern}).{code_section}\n\n"
        f"Generate a **{level_name} hint** (level {idx + 1} of 4).\n\n"
        "Levels:\n"
        "- 1 Conceptual: a question about the underlying concept, NO code\n"
        "- 2 Directional: suggest an approach direction, NO implementation\n"
        "- 3 Structural: describe the data structure / algorithm shape\n"
        "- 4 Code-level: concrete pseudocode or a key snippet\n\n"
        "Rules: specific to this problem, NOT the full solution, max 5 sentences, use markdown.\n"
        "Respond with ONLY the hint content."
    )
    return {"prompt": prompt}


async def generate_hint_response(state: HintState) -> dict:
    """Call Gemini to generate the hint. Falls back to gemini-1.5-flash on 429."""
    for use_fallback in (False, True):
        llm = get_llm(use_fallback=use_fallback)
        try:
            response = await llm.ainvoke([HumanMessage(content=state["prompt"])])
            return {"hint_content": response.content.strip()}
        except Exception as exc:
            err_str = str(exc)
            is_rate_limit = "429" in err_str or "RESOURCE_EXHAUSTED" in err_str
            if is_rate_limit and not use_fallback:
                logger.warning("Hint: primary rate-limited, trying fallback")
                continue
            logger.exception("Hint generation failed: %s", exc)
            raise
    raise RuntimeError("All models exhausted for hint generation")

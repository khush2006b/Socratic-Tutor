"""
services/gemini.py
Gemini API client — model singleton with automatic API key rotation.

Rotates through up to 3 API keys when rate-limited (HTTP 429 / quota errors).
Each key is used until it hits the limit, then the next key takes over.

The streaming tutor flow is handled by the LangGraph pipeline
(graph/tutor_graph.py). This module provides:
  - get_current_api_key() → current active key (for LangGraph / langchain)
  - get_gemini_model()    → shared Gemini model instance (auto-rotates on 429)
  - generate_hint()       → non-streaming hint at requested level
"""

import asyncio
import logging
import threading
from typing import Optional

import google.generativeai as genai
from google.api_core.exceptions import ResourceExhausted, TooManyRequests

from ..config import get_settings
from ..models.problem import Problem
from .socratic_prompt import SYSTEM_PROMPT

logger = logging.getLogger(__name__)

# ── Key Rotation State ─────────────────────────────────────────────

_lock = threading.Lock()
_key_index = 0          # current active key index
_model = None           # cached model for current key
_all_keys: list = []    # populated on first call


def _get_keys() -> list[str]:
    """Load API keys from settings (lazy, cached)."""
    global _all_keys
    if not _all_keys:
        _all_keys = get_settings().gemini_api_keys
        if not _all_keys:
            raise RuntimeError("No Gemini API keys configured. Set GEMINI_API_KEY_1 in .env")
        logger.info("Loaded %d Gemini API key(s) for rotation", len(_all_keys))
    return _all_keys


def _rotate_key() -> str:
    """Rotate to the next API key. Returns the new key."""
    global _key_index, _model
    keys = _get_keys()
    with _lock:
        old_idx = _key_index
        _key_index = (_key_index + 1) % len(keys)
        _model = None  # force model rebuild with new key
        new_key = keys[_key_index]
        logger.warning(
            "🔄 Rotating Gemini API key: key_%d → key_%d (%d keys total)",
            old_idx + 1, _key_index + 1, len(keys),
        )
        return new_key


def get_current_api_key() -> str:
    """Return the currently active API key (for LangGraph / langchain-google)."""
    keys = _get_keys()
    return keys[_key_index]


def get_gemini_model() -> genai.GenerativeModel:
    """Return a Gemini model configured with the current API key."""
    global _model
    if _model is None:
        settings = get_settings()
        key = get_current_api_key()
        genai.configure(api_key=key)
        _model = genai.GenerativeModel(
            model_name=settings.gemini_model,
            system_instruction=SYSTEM_PROMPT,
            generation_config=genai.GenerationConfig(
                temperature=0.7,
                top_p=0.9,
                max_output_tokens=1024,
            ),
        )
        logger.info("Gemini model initialised: %s (key_%d)", settings.gemini_model, _key_index + 1)
    return _model


async def _call_with_rotation(call_fn, max_retries=None):
    """
    Execute a Gemini API call, automatically rotating keys on rate-limit errors.
    Tries each key once before giving up.
    """
    keys = _get_keys()
    retries = max_retries or len(keys)
    last_exc = None

    for attempt in range(retries):
        try:
            return await call_fn()
        except (ResourceExhausted, TooManyRequests) as exc:
            last_exc = exc
            logger.warning(
                "⚠️ Key_%d rate-limited (attempt %d/%d): %s",
                _key_index + 1, attempt + 1, retries, str(exc)[:100],
            )
            if attempt < retries - 1:
                _rotate_key()
                # Rebuild model with new key for genai calls
                get_gemini_model()
            else:
                break
        except Exception as exc:
            # Check if the error message contains rate limit indicators
            err_msg = str(exc).lower()
            if "429" in err_msg or "quota" in err_msg or "rate" in err_msg:
                last_exc = exc
                logger.warning(
                    "⚠️ Key_%d likely rate-limited (attempt %d/%d): %s",
                    _key_index + 1, attempt + 1, retries, str(exc)[:100],
                )
                if attempt < retries - 1:
                    _rotate_key()
                    get_gemini_model()
                else:
                    break
            else:
                raise  # Non-rate-limit error, don't retry

    raise last_exc  # All keys exhausted


# ── Non-streaming hint generation ─────────────────────────────────

async def generate_hint(
    hint_index: int,
    problem: Optional[Problem],
    code: str,
) -> str:
    """
    Generate a contextual hint at the requested level (non-streaming).
    Hint levels: 0=conceptual, 1=directional, 2=structural, 3=code-level
    Automatically rotates API keys on rate-limit.
    """
    hint_level_names = ["conceptual", "directional", "structural", "code-level"]
    level_name = hint_level_names[min(hint_index, 3)]
    pattern = problem.patterns[0] if problem and problem.patterns else "general"
    problem_title = problem.title if problem else "the current problem"

    code_section = ""
    if code and code.strip():
        trimmed = code.strip()[:600]
        code_section = f"\nStudent's current code:\n```\n{trimmed}\n```"

    prompt = f"""\
You are a Socratic DSA tutor. The student is working on **{problem_title}** (pattern: {pattern}).
{code_section}

Generate a **{level_name} hint** (level {hint_index + 1} of 4).

Levels:
- 1 Conceptual: question or observation about the underlying concept, NO code
- 2 Directional: suggest an approach direction, NO implementation
- 3 Structural: describe the data structure / algorithm shape needed
- 4 Code-level: concrete pseudocode or a key code snippet

Rules: specific to this problem, NOT the full solution, max 5 sentences, use markdown.
Respond with ONLY the hint content.
"""

    async def _call():
        model = get_gemini_model()
        response = await asyncio.to_thread(model.generate_content, prompt)
        return response.text.strip()

    try:
        return await _call_with_rotation(_call)
    except Exception as exc:
        logger.exception("Gemini hint generation error (all keys exhausted): %s", exc)
        raise

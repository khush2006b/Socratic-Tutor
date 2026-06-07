"""
services/gemini.py
Gemini API client — model singleton and hint generation.

The streaming tutor flow is handled by the LangGraph pipeline
(graph/tutor_graph.py). This module provides:
  - get_gemini_model()  → shared Gemini model instance
  - generate_hint()     → non-streaming hint at requested level
"""

import asyncio
import logging
from typing import Optional

import google.generativeai as genai

from ..config import get_settings
from ..models.problem import Problem
from .socratic_prompt import SYSTEM_PROMPT

logger = logging.getLogger(__name__)

# ── Gemini model singleton ─────────────────────────────────────────

_model: genai.GenerativeModel | None = None


def get_gemini_model() -> genai.GenerativeModel:
    global _model
    if _model is None:
        settings = get_settings()
        genai.configure(api_key=settings.gemini_api_key)
        _model = genai.GenerativeModel(
            model_name=settings.gemini_model,
            system_instruction=SYSTEM_PROMPT,
            generation_config=genai.GenerationConfig(
                temperature=0.7,
                top_p=0.9,
                max_output_tokens=1024,
            ),
        )
        logger.info("Gemini model initialised: %s", settings.gemini_model)
    return _model


# ── Non-streaming hint generation ─────────────────────────────────

async def generate_hint(
    hint_index: int,
    problem: Optional[Problem],
    code: str,
) -> str:
    """
    Generate a contextual hint at the requested level (non-streaming).
    Hint levels: 0=conceptual, 1=directional, 2=structural, 3=code-level
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

    try:
        model = get_gemini_model()
        response = await asyncio.to_thread(model.generate_content, prompt)
        return response.text.strip()
    except Exception as exc:
        logger.exception("Gemini hint generation error: %s", exc)
        raise

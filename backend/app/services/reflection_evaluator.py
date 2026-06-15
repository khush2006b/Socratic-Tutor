"""
services/reflection_evaluator.py
AI-powered evaluation of student reflection quality.

Scores each reflection answer as:
  - surface:       restates what happened without deeper understanding
  - structural:    identifies underlying structure/pattern reasoning
  - transferable:  connects to general principles applicable elsewhere

Called as a background task after reflection is saved.
Persists the quality score back to the reflections table.
"""

import asyncio
import json
import logging
import re
from typing import Optional

from .gemini import get_gemini_model
from .database import get_db

logger = logging.getLogger(__name__)


_EVAL_PROMPT = """You are evaluating a student's post-session reflection on a DSA problem.

## Problem Context
- Problem: {problem_title} ({difficulty})
- Pattern: {pattern}
- Hints used: {hints_used}
- Time: {elapsed_min} minutes

## Student's Reflection Answers
**What pattern did you use?**
{pattern_answer}

**What was the key insight?**
{insight_answer}

**Where did you get stuck?**
{stuck_answer}

**Name similar problems:**
{transfer_answer}

## Your Task
Rate the OVERALL reflection quality as exactly one of:

- "surface" — Student restates what happened factually (e.g. "I used a hash map") without explaining WHY it works or connecting to deeper principles. Vague or one-line answers.

- "structural" — Student explains WHY the pattern works for this problem structure (e.g. "Hash map because we need O(1) complement lookup, and the problem guarantees exactly one solution so we can return immediately"). Shows understanding of the structural match between pattern and problem.

- "transferable" — Student connects to general principles that apply beyond this problem (e.g. "Any problem where you search for a pair with a target property can use hash map for the complement. Similar to 3Sum where you fix one element and two-sum the rest"). Names specific, correct similar problems.

Respond with ONLY valid JSON. No markdown, no backticks, no explanation.
{{"quality_level": "surface|structural|transferable", "reasoning": "one sentence explaining your rating", "feedback": "one sentence of constructive feedback to help the student reflect more deeply"}}
"""


async def evaluate_reflection_quality(
    session_id:      str,
    student_id:      str,
    problem_title:   Optional[str],
    problem_data:    Optional[dict],
    answers:         dict,
    hints_used:      int,
    elapsed_seconds: int,
) -> Optional[dict]:
    """
    Evaluate reflection quality using Gemini.
    Returns {"quality_level": str, "reasoning": str, "feedback": str} or None on failure.
    Persists the quality_level to the reflections table.
    """
    # Skip if no meaningful answers
    pattern_answer = (answers.get("pattern") or "").strip()
    insight_answer = (answers.get("insight") or "").strip()
    if not pattern_answer and not insight_answer:
        logger.info("Reflection eval skipped — no substantive answers for session %s", session_id)
        return None

    try:
        model = get_gemini_model()
    except Exception as exc:
        logger.warning("Reflection eval skipped — Gemini unavailable: %s", exc)
        return None

    difficulty = (problem_data or {}).get("difficulty", "Medium")
    patterns = (problem_data or {}).get("patterns", [])
    pattern = patterns[0] if patterns else "unknown"
    elapsed_min = max(1, elapsed_seconds // 60)

    prompt = _EVAL_PROMPT.format(
        problem_title  = problem_title or "Unknown",
        difficulty     = difficulty,
        pattern        = pattern,
        hints_used     = hints_used,
        elapsed_min    = elapsed_min,
        pattern_answer = pattern_answer or "—",
        insight_answer = insight_answer or "—",
        stuck_answer   = (answers.get("stuck") or "").strip() or "—",
        transfer_answer= (answers.get("transfer") or "").strip() or "—",
    )

    try:
        response = await asyncio.to_thread(
            lambda: model.generate_content(
                prompt,
                generation_config={
                    "temperature": 0.2,
                    "response_mime_type": "application/json",
                    "max_output_tokens": 512,
                },
            )
        )
        raw = response.text.strip()
        result = json.loads(raw)

        quality = result.get("quality_level", "surface")
        if quality not in ("surface", "structural", "transferable"):
            quality = "surface"
            result["quality_level"] = quality

        logger.info(
            "Reflection quality: %s for session %s — %s",
            quality, session_id, result.get("reasoning", ""),
        )

        # Persist to DB
        await _save_quality(session_id, quality, result.get("feedback", ""))

        return result

    except json.JSONDecodeError as exc:
        logger.warning("Reflection eval JSON parse failed for session %s: %s", session_id, exc)
        # Try regex extraction
        try:
            m = re.search(r'"quality_level"\s*:\s*"(surface|structural|transferable)"', raw)
            if m:
                quality = m.group(1)
                await _save_quality(session_id, quality, "")
                return {"quality_level": quality, "reasoning": "parsed via fallback", "feedback": ""}
        except Exception:
            pass
        return None
    except Exception as exc:
        logger.warning("Reflection eval failed for session %s: %s", session_id, exc)
        return None


async def _save_quality(session_id: str, quality_level: str, feedback: str) -> None:
    """Persist reflection quality score to the reflections table."""
    db = get_db()
    if not db:
        return
    try:
        await asyncio.to_thread(
            lambda: db.table("reflections")
                .update({"quality_level": quality_level, "quality_feedback": feedback})
                .eq("session_id", session_id)
                .execute()
        )
    except Exception as exc:
        logger.warning("Failed to save reflection quality: %s", exc)

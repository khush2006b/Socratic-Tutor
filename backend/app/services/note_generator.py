"""
services/note_generator.py
Uses Gemini to analyse a completed tutoring session and generate structured notes.

Called as a background task after reflection is saved.
Generates 3-6 notes per session across 4 categories:
  - mistake:   A specific error in thinking or approach the student made
  - technique: A new algorithmic technique or approach they learned
  - insight:   A key realisation or aha moment
  - pattern:   Understanding of an algorithmic pattern and when to apply it
"""

import asyncio
import json
import logging
import re as _re
from typing import Optional

from ..services.database import get_db
from ..services.gemini   import get_gemini_model

logger = logging.getLogger(__name__)


# ── Prompt ────────────────────────────────────────────────────────

_SYSTEM = """You are an expert CS educator analysing a completed tutoring session.
Your job is to extract concise, actionable notes for the student to review later.
Always respond with ONLY valid JSON — no markdown, no explanation."""

_PROMPT_TEMPLATE = """
## Session Summary
Problem: {problem_title}
Difficulty: {difficulty}
Patterns involved: {patterns}
Time spent: {elapsed_min} minutes
Hints used: {hints_used}

## Conversation (student ↔ tutor)
{conversation}

## Student's Reflection
- Pattern used: {reflection_pattern}
- Key insight: {reflection_insight}
- Where stuck: {reflection_stuck}
- Similar problems: {reflection_transfer}

---

Analyse this session and extract 3–6 meaningful notes for the student.

For each note choose ONE category:
- "mistake"   — a specific wrong assumption, edge-case miss, or logical error the student made
- "technique" — a new algorithmic technique, coding trick, or problem-solving approach they learned
- "insight"   — a key "aha" realisation that changed how they thought about the problem
- "pattern"   — understanding of a named algorithmic pattern and when it applies

Rules:
1. Be SPECIFIC — reference the actual problem, variable names, or code logic
2. Write the content from the student's perspective ("You learned...", "You confused...", "You realised...")
3. Keep titles under 10 words
4. Keep content 2-4 sentences
5. Only generate notes for things that actually happened — no hallucinations
6. Include 1-3 relevant tags per note (e.g. ["two pointers", "array", "edge case"])

Respond with ONLY this JSON (no markdown):
{{
  "notes": [
    {{
      "category": "mistake|technique|insight|pattern",
      "title": "...",
      "content": "...",
      "tags": ["tag1", "tag2"]
    }}
  ]
}}
"""


def _build_conversation_text(messages: list[dict], max_chars: int = 8000) -> str:
    """Convert message list to readable text, truncated to fit context."""
    lines = []
    for m in messages:
        role    = "Student" if m.get("role") == "student" else "Tutor"
        content = m.get("content", "").strip()
        if content:
            lines.append(f"{role}: {content}")
    full = "\n\n".join(lines)
    if len(full) > max_chars:
        # Keep first third and last two-thirds (most important parts)
        keep = max_chars // 3
        full = full[:keep] + "\n\n[...session middle truncated...]\n\n" + full[-(max_chars - keep):]
    return full




def _robust_json_parse(raw: str) -> dict:
    """
    Parse Gemini JSON output tolerantly.
    Handles: markdown fences, smart quotes, control chars, JS comments,
    trailing commas, leading/trailing prose, unescaped newlines in strings,
    single-quoted strings, unquoted keys, unescaped quotes inside values.
    """
    text = raw.strip()

    # 1. Strip ALL markdown fences — handle ```json, ```JSON, ``` etc.
    text = _re.sub(r'^```\w*\s*\n?', '', text, flags=_re.MULTILINE)
    text = _re.sub(r'\n?```\s*$', '', text, flags=_re.MULTILINE)
    text = text.strip()

    # 2. Extract outermost { ... } block (skip any leading prose)
    start = text.find("{")
    end   = text.rfind("}")
    if start != -1 and end != -1 and end > start:
        text = text[start : end + 1]

    # 3. Try direct parse first (fastest path)
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        pass

    # 4. Aggressive cleaning
    cleaned = text

    # 4a. Replace smart/curly quotes with straight quotes
    cleaned = cleaned.replace('\u201c', '"').replace('\u201d', '"')  # "" → ""
    cleaned = cleaned.replace('\u2018', "'").replace('\u2019', "'")  # '' → ''

    # 4b. Strip JS-style comments  // ...  and  /* ... */
    cleaned = _re.sub(r'//[^\n]*', '', cleaned)
    cleaned = _re.sub(r'/\*.*?\*/', '', cleaned, flags=_re.DOTALL)

    # 4c. Remove trailing commas before } or ]
    cleaned = _re.sub(r',(\s*[}\]])', r'\1', cleaned)

    # 4d. Remove control characters (except \n \r \t)
    cleaned = _re.sub(r'[\x00-\x08\x0b\x0c\x0e-\x1f]', '', cleaned)

    try:
        return json.loads(cleaned)
    except json.JSONDecodeError:
        pass

    # 5. Fix unescaped newlines inside string values
    def _fix_string_newlines(m):
        return m.group(0).replace('\n', '\\n').replace('\r', '\\r')

    fixed = _re.sub(r'"(?:[^"\\]|\\.)*"', _fix_string_newlines, cleaned, flags=_re.DOTALL)

    try:
        return json.loads(fixed)
    except json.JSONDecodeError:
        pass

    # 6. Replace single-quoted strings with double-quoted
    #    Handles: {'key': 'value'} → {"key": "value"}
    def _single_to_double(m):
        inner = m.group(1).replace('"', '\\"')  # escape any existing double quotes
        return f'"{inner}"'

    sq_fixed = _re.sub(r"'([^']*)'", _single_to_double, fixed)

    try:
        return json.loads(sq_fixed)
    except json.JSONDecodeError:
        pass

    # 7. Fix unquoted keys: { key: "value" } → { "key": "value" }
    key_fixed = _re.sub(
        r'(?<=[\{,])\s*([a-zA-Z_]\w*)\s*:',
        r' "\1":',
        sq_fixed,
    )

    try:
        return json.loads(key_fixed)
    except json.JSONDecodeError:
        pass

    # 8. Nuclear option: try to extract individual note objects with regex
    #    and reconstruct the JSON manually
    try:
        note_pattern = _re.compile(
            r'\{\s*"category"\s*:\s*"([^"]+)"\s*,\s*'
            r'"title"\s*:\s*"([^"]+)"\s*,\s*'
            r'"content"\s*:\s*"((?:[^"\\]|\\.)*)"\s*,\s*'
            r'"tags"\s*:\s*\[(.*?)\]\s*\}',
            _re.DOTALL,
        )
        notes = []
        for m in note_pattern.finditer(key_fixed):
            tags_raw = m.group(4).strip()
            tags = [t.strip().strip('"').strip("'") for t in tags_raw.split(",") if t.strip()]
            notes.append({
                "category": m.group(1),
                "title": m.group(2),
                "content": m.group(3).replace('\\n', '\n').replace('\\"', '"'),
                "tags": tags,
            })
        if notes:
            logger.info("JSON repair: extracted %d notes via regex fallback", len(notes))
            return {"notes": notes}
    except Exception:
        pass

    raise ValueError(
        f"JSON parse failed after cleaning.\n"
        f"Error: all repair strategies exhausted\n"
        f"Raw (first 500 chars):\n{raw[:500]}"
    )


async def generate_session_notes(
    session_id:    str,
    student_id:    str,
    problem_title: Optional[str],
    problem:       Optional[dict],
    messages:      list[dict],
    reflection:    Optional[dict],
    hints_used:    int,
    elapsed_seconds: int,
) -> list[dict]:
    """
    Call Gemini to generate notes, then persist them to the DB.
    Returns the list of generated note dicts (or [] on failure).
    """
    if not messages:
        logger.info("Note generation skipped — no messages for session %s", session_id)
        return []

    try:
        model = get_gemini_model()
    except Exception as exc:
        logger.warning("Note generation skipped — Gemini unavailable: %s", exc)
        return []

    reflection = reflection or {}
    difficulty = problem.get("difficulty", "Medium") if problem else "Medium"
    patterns   = ", ".join(problem.get("patterns", [])) if problem else "unknown"
    elapsed_min = max(1, elapsed_seconds // 60)

    conversation = _build_conversation_text(messages)

    prompt = _PROMPT_TEMPLATE.format(
        problem_title      = problem_title or "Unknown Problem",
        difficulty         = difficulty,
        patterns           = patterns,
        elapsed_min        = elapsed_min,
        hints_used         = hints_used,
        conversation       = conversation,
        reflection_pattern = reflection.get("pattern", "—"),
        reflection_insight = reflection.get("insight", "—"),
        reflection_stuck   = reflection.get("stuck",   "—"),
        reflection_transfer= reflection.get("transfer","—"),
    )

    try:
        # Use asyncio.to_thread so we don't block the event loop
        response = await asyncio.to_thread(
            lambda: model.generate_content(
                _SYSTEM + "\n\n" + prompt,
                generation_config={
                    "temperature": 0.3,
                    "response_mime_type": "application/json",  # forces clean JSON
                },
            )
        )
        raw_json = response.text.strip()
        logger.debug("Note gen raw response (first 300 chars): %s", raw_json[:300])

        data  = _robust_json_parse(raw_json)
        notes = data.get("notes", [])

        if not isinstance(notes, list):
            raise ValueError("Expected notes to be a list")

        logger.info(
            "Generated %d note(s) for session %s (problem=%s)",
            len(notes), session_id, problem_title,
        )

    except Exception as exc:
        logger.warning("Note generation failed for session %s: %s", session_id, exc)
        return []

    # Persist to DB
    saved = []
    db = get_db()
    if db and notes:
        problem_id = problem.get("id") if problem else None
        from ..services.session_manager import _now
        for note in notes:
            category = note.get("category", "insight")
            if category not in ("mistake", "technique", "insight", "pattern"):
                category = "insight"
            row = {
                "session_id":    session_id,
                "student_id":    student_id,
                "problem_id":    problem_id,
                "problem_title": problem_title,
                "category":      category,
                "title":         str(note.get("title", ""))[:200],
                "content":       str(note.get("content", "")),
                "tags":          note.get("tags", []),
                "created_at":    _now(),
            }
            try:
                result = await asyncio.to_thread(
                    lambda r=row: db.table("notes").insert(r).execute()
                )
                if result.data:
                    saved.append(result.data[0])
            except Exception as exc:
                logger.warning("Failed to save note to DB: %s", exc)

    return saved

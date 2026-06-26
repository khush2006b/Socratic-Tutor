"""
services/grounding.py
Problem Grounding Engine — extracts structured knowledge from problems
and checks tutor responses for drift against grounded facts.

The grounding object is the single source of truth for all problem facts.
The tutor never "remembers" the problem from chat history — it always
references this grounded representation.
"""

import json
import re
import logging
import asyncio
from typing import Optional

from ..models.problem import Problem
from ..config import get_settings

logger = logging.getLogger(__name__)


# ── Extraction prompt ──────────────────────────────────────────────

GROUNDING_EXTRACTION_PROMPT = """\
You are a DSA problem analysis engine. Extract structured knowledge from the programming problem below.

Do NOT explain. Do NOT tutor. Return ONLY valid JSON (no markdown fences, no commentary).

Required JSON schema:
{
  "objective": "One-sentence description of what the problem asks",
  "input_schema": { "param_name": "type description", ... },
  "output_schema": "What the output represents",
  "constraints": ["constraint 1", "constraint 2", ...],
  "core_concepts": ["Sliding Window", "Hash Map", ...],
  "key_invariants": [
    "Invariant that must hold during the algorithm"
  ],
  "common_misconceptions": [
    "Specific mistake students commonly make on this problem"
  ],
  "hidden_tricks": [
    "Non-obvious insight needed to solve efficiently"
  ],
  "edge_cases": [
    "Important boundary condition to test"
  ],
  "prerequisite_concepts": [
    "What the student needs to know before attempting this"
  ],
  "optimal_complexity": {
    "time": "O(n)",
    "space": "O(k)"
  }
}

Rules:
- core_concepts: use standard DSA pattern names (Sliding Window, Two Pointers, Hash Map, Binary Search, Dynamic Programming, BFS, DFS, Stack, Heap, Greedy, Prefix Sum, Trie, Linked List, Tree, Graph, Union Find, Bit Manipulation, Math, Sorting, Monotonic Stack, Monotonic Queue)
- common_misconceptions: be SPECIFIC to this problem, not generic ("students forget edge cases" is bad; "Exactly K cannot be solved with a single sliding window — need AtMost(K) - AtMost(K-1)" is good)
- hidden_tricks: the key insight that separates O(n²) from O(n), or makes the problem solvable at all
- key_invariants: what must be true at every step of the correct algorithm
- edge_cases: specific inputs that break naive solutions
- Return ONLY the JSON object.

Problem:
"""


# ── Drift detection prompt ─────────────────────────────────────────

DRIFT_CHECK_PROMPT = """\
You are a factual consistency checker. Compare the tutor's response against the authoritative problem grounding.

Grounding (AUTHORITATIVE):
{grounding}

Tutor's response:
{response}

List ONLY factual contradictions between the tutor's response and the grounding.
A contradiction means the tutor stated something that directly conflicts with the grounding facts.
Subjective phrasing differences are NOT contradictions.

If there are no contradictions, respond with exactly: []
Otherwise, respond with a JSON array of contradiction descriptions:
["The tutor said X but the grounding states Y", ...]

Return ONLY the JSON array. No other text.
"""


# ── Public API ─────────────────────────────────────────────────────

async def extract_grounding(problem: Problem) -> dict:
    """
    Extract structured problem knowledge from a Problem object.
    Uses Gemini as an information extraction model (NOT a tutor).
    Returns the grounding JSON dict.
    """
    import google.generativeai as genai

    settings = get_settings()
    genai.configure(api_key=settings.gemini_api_key)
    model = genai.GenerativeModel(
        model_name=settings.gemini_model,
        generation_config=genai.GenerationConfig(
            temperature=0,       # deterministic extraction
            max_output_tokens=2048,
        ),
    )

    # Build problem text for extraction
    problem_text = _build_problem_text(problem)
    prompt = GROUNDING_EXTRACTION_PROMPT + "\n\n" + problem_text

    try:
        response = await asyncio.to_thread(model.generate_content, prompt)
        grounding = _parse_json_response(response.text)

        # Validate required fields exist
        grounding = _validate_grounding(grounding, problem)

        logger.info(
            "Grounding extracted for '%s': %d concepts, %d misconceptions, %d tricks",
            problem.title,
            len(grounding.get("core_concepts", [])),
            len(grounding.get("common_misconceptions", [])),
            len(grounding.get("hidden_tricks", [])),
        )
        return grounding

    except Exception as exc:
        logger.warning("Grounding extraction failed for '%s': %s", problem.title, exc)
        # Return a minimal fallback grounding from the Problem object itself
        return _fallback_grounding(problem)


async def check_drift(tutor_response: str, grounding: dict) -> list[str]:
    """
    Check if a tutor response contradicts the grounded problem facts.
    Returns a list of conflict descriptions (empty = no drift).

    This is a lightweight post-generation check. In v1 it only logs;
    future versions can use this to trigger regeneration.
    """
    if not grounding or not tutor_response:
        return []

    import google.generativeai as genai

    settings = get_settings()
    genai.configure(api_key=settings.gemini_api_key)
    model = genai.GenerativeModel(
        model_name="gemini-1.5-flash",   # use cheaper model for checking
        generation_config=genai.GenerationConfig(
            temperature=0,
            max_output_tokens=512,
        ),
    )

    # Only include the most relevant grounding fields for drift check
    compact_grounding = {
        k: grounding[k] for k in [
            "objective", "core_concepts", "key_invariants",
            "common_misconceptions", "hidden_tricks", "optimal_complexity",
        ] if k in grounding
    }

    prompt = DRIFT_CHECK_PROMPT.format(
        grounding=json.dumps(compact_grounding, indent=2),
        response=tutor_response[:1500],  # cap to avoid token waste
    )

    try:
        response = await asyncio.to_thread(model.generate_content, prompt)
        conflicts = _parse_json_response(response.text)
        if isinstance(conflicts, list):
            if conflicts:
                logger.warning("Grounding drift detected: %s", conflicts)
            return conflicts
        return []
    except Exception as exc:
        logger.debug("Drift check failed (non-critical): %s", exc)
        return []


def build_student_grounding(
    existing: dict,
    misconceptions_triggered: list[str],
    mastery_events: list[dict],
) -> dict:
    """
    Update the dynamic student-specific grounding state.
    Called after each tutor turn to track what the student has encountered.
    """
    result = dict(existing) if existing else {}

    # Track triggered misconceptions
    triggered = result.get("misconceptions_triggered", [])
    for m in misconceptions_triggered:
        if m not in triggered:
            triggered.append(m)
    result["misconceptions_triggered"] = triggered

    # Track mastered concepts
    mastered = result.get("mastered", [])
    for event in mastery_events:
        pattern = event.get("pattern", "")
        level = event.get("level", "")
        entry = f"{pattern} ({level})"
        if entry not in mastered:
            mastered.append(entry)
    result["mastered"] = mastered

    return result


# ── Internal helpers ───────────────────────────────────────────────

def _build_problem_text(problem: Problem) -> str:
    """Build a comprehensive text representation of the problem for extraction."""
    parts = [f"Title: {problem.title}"]
    parts.append(f"Difficulty: {problem.difficulty}")

    if problem.statement:
        parts.append(f"\nStatement:\n{problem.statement}")

    if problem.examples:
        parts.append("\nExamples:")
        for i, ex in enumerate(problem.examples[:3], 1):
            parts.append(f"  {i}. Input: {ex.input}")
            parts.append(f"     Output: {ex.output}")
            if ex.explanation:
                parts.append(f"     Explanation: {ex.explanation}")

    if problem.constraints:
        parts.append(f"\nConstraints: {', '.join(problem.constraints)}")

    if problem.patterns:
        parts.append(f"\nKnown patterns: {', '.join(problem.patterns)}")

    return "\n".join(parts)


def _parse_json_response(raw: str) -> dict | list:
    """Parse Gemini's JSON response, stripping markdown fences if present."""
    text = raw.strip()
    text = re.sub(r"^```(?:json)?\s*", "", text)
    text = re.sub(r"\s*```$", "", text)
    text = text.strip()

    try:
        return json.loads(text)
    except json.JSONDecodeError:
        # Try to find JSON within the response
        m = re.search(r"[\[{].*[\]}]", text, re.DOTALL)
        if m:
            return json.loads(m.group(0))
        raise ValueError(f"Could not parse JSON from Gemini response: {text[:200]}")


def _validate_grounding(grounding: dict, problem: Problem) -> dict:
    """Ensure all required fields exist with sensible defaults."""
    defaults = {
        "objective": f"Solve: {problem.title}",
        "input_schema": {},
        "output_schema": "",
        "constraints": problem.constraints or [],
        "core_concepts": problem.patterns or [],
        "key_invariants": [],
        "common_misconceptions": [],
        "hidden_tricks": [],
        "edge_cases": [],
        "prerequisite_concepts": [],
        "optimal_complexity": {
            "time": problem.time_complexity or "",
            "space": problem.space_complexity or "",
        },
    }

    for key, default in defaults.items():
        if key not in grounding or not grounding[key]:
            grounding[key] = default

    return grounding


def _fallback_grounding(problem: Problem) -> dict:
    """
    Minimal grounding when Gemini extraction fails.
    Built directly from the Problem model's existing fields.
    """
    return {
        "objective": f"Solve: {problem.title}",
        "input_schema": {},
        "output_schema": "",
        "constraints": problem.constraints or [],
        "core_concepts": problem.patterns or [],
        "key_invariants": [],
        "common_misconceptions": [],
        "hidden_tricks": [],
        "edge_cases": [],
        "prerequisite_concepts": problem.tags or [],
        "optimal_complexity": {
            "time": problem.time_complexity or "",
            "space": problem.space_complexity or "",
        },
    }

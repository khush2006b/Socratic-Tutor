"""
services/problem_ai_parser.py
Parse a DSA problem from free-form text or an image using Gemini.

Supports:
  - Pasted problem statement (any format — LeetCode, HackerRank, custom)
  - Screenshot / photo of a problem (base64-encoded image)

Returns a fully-structured Problem object by asking Gemini to extract
the fields in JSON format.
"""

import json
import re
import logging
import base64
from typing import Optional

from ..models.problem import Problem
from ..config import get_settings

logger = logging.getLogger(__name__)


PARSE_PROMPT = """\
You are a DSA problem parser. Extract the following fields from the problem below and return ONLY valid JSON (no markdown, no code fences).

Required JSON schema:
{
  "title": "Short problem title",
  "difficulty": "Easy" | "Medium" | "Hard",
  "tags": ["Array", "String", ...],           // LeetCode-style topic tags
  "patterns": ["Sliding Window", "Two Pointers", ...],  // DSA pattern names
  "statement": "Problem statement in clean markdown, no examples, no constraints",
  "examples": [
    { "input": "...", "output": "...", "explanation": "..." }
  ],
  "constraints": ["0 <= n <= 10^5", ...],
  "timeComplexity": "O(n)",    // optimal, or "" if unknown
  "spaceComplexity": "O(1)"   // optimal, or "" if unknown
}

Rules:
- statement should be clean markdown (use **bold**, `code`, lists). Remove example and constraint sections from the statement.
- Include up to 4 examples. If explanation is missing use "".
- patterns should be standard DSA pattern names (Sliding Window, Two Pointers, Hash Map, Binary Search, Dynamic Programming, BFS, DFS / Backtrack, Stack, Heap, Greedy, Prefix Sum, Trie, Linked List, Tree, Graph, Union Find, Bit Manipulation, Math, Sorting).
- Return ONLY the JSON object. No other text.

Problem to parse:
"""


async def parse_problem_from_text(problem_text: str) -> Problem:
    """
    Parse a pasted problem statement into a structured Problem object.
    Uses Gemini to extract fields in JSON format.
    """
    from langchain_google_genai import ChatGoogleGenerativeAI
    from langchain_core.messages import HumanMessage

    settings = get_settings()
    from .gemini import get_current_api_key
    llm = ChatGoogleGenerativeAI(
        model=settings.gemini_model,
        google_api_key=get_current_api_key(),
        temperature=0,
        max_retries=0,
    )

    prompt = PARSE_PROMPT + "\n\n" + problem_text.strip()
    response = await llm.ainvoke([HumanMessage(content=prompt)])
    return _parse_gemini_json(response.content)


async def parse_problem_from_image(image_data: str, mime_type: str = "image/png") -> Problem:
    """
    Parse a problem from a base64-encoded image using Gemini vision.
    image_data: base64 string (without data:... prefix)
    """
    import google.generativeai as genai
    from langchain_core.messages import HumanMessage

    settings = get_settings()

    # Use google-generativeai directly for multimodal (image) input
    from .gemini import get_current_api_key
    genai.configure(api_key=get_current_api_key())
    model = genai.GenerativeModel(model_name=settings.gemini_model)

    image_bytes = base64.b64decode(image_data)

    prompt_parts = [
        PARSE_PROMPT + "\n\n[The problem is shown in the attached image. Read it carefully and extract all fields.]",
        {"mime_type": mime_type, "data": image_bytes},
    ]

    response = model.generate_content(prompt_parts)
    return _parse_gemini_json(response.text)


def _parse_gemini_json(raw: str) -> Problem:
    """Parse Gemini's JSON response into a Problem object."""
    # Strip any markdown code fences Gemini might add despite instructions
    text = raw.strip()
    text = re.sub(r"^```(?:json)?\s*", "", text)
    text = re.sub(r"\s*```$", "", text)
    text = text.strip()

    try:
        data = json.loads(text)
    except json.JSONDecodeError as exc:
        # Try to extract JSON from within the response
        m = re.search(r"\{.*\}", text, re.DOTALL)
        if m:
            data = json.loads(m.group(0))
        else:
            raise ValueError(f"Gemini returned invalid JSON: {exc}\n\nRaw: {text[:300]}")

    # Normalise + build Problem
    return Problem(
        id=0,
        leetcodeId=0,
        title=data.get("title", "Custom Problem"),
        difficulty=data.get("difficulty", "Medium"),
        tags=data.get("tags", ["Algorithm"]),
        patterns=data.get("patterns", ["General"]),
        statement=data.get("statement", ""),
        examples=[
            {
                "input":       ex.get("input", ""),
                "output":      ex.get("output", ""),
                "explanation": ex.get("explanation", ""),
            }
            for ex in data.get("examples", [])
        ],
        constraints=data.get("constraints", []),
        timeComplexity=data.get("timeComplexity", ""),
        spaceComplexity=data.get("spaceComplexity", ""),
        starterCode={},
    )

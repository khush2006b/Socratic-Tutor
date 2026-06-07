"""
routers/problems.py
Problem ingestion endpoints — three modes:

  POST /api/problems/from-number   { number: int }         → Problem (via LeetCode GraphQL)
  POST /api/problems/from-text     { text: str }           → Problem (via Gemini parsing)
  POST /api/problems/from-image    { image: str, mime: str } → Problem (via Gemini vision)
  POST /api/problems/parse         { input: str }          → Problem (legacy, tries number → LeetCode)
  GET  /api/problems               → summary list (hardcoded set)
  GET  /api/problems/{id}          → Problem by id (hardcoded set)
"""

import logging
import re
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from ..models.problem import Problem
from ..data.problems import get_problem_by_id, list_all_problems
from ..services.problem_fetcher import (
    fetch_problem_by_number,
    fetch_problem_by_slug,
)
from ..services.problem_ai_parser import (
    parse_problem_from_text,
    parse_problem_from_image,
)

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/problems", tags=["problems"])


# ── Request models ────────────────────────────────────────────────

class FromNumberRequest(BaseModel):
    number: int

class FromTextRequest(BaseModel):
    text: str

class FromImageRequest(BaseModel):
    image: str          # base64, no data:... prefix
    mime: str = "image/png"

class ParseRequest(BaseModel):
    input: str


# ── Endpoints ─────────────────────────────────────────────────────

@router.post("/from-number", response_model=Problem)
async def problem_from_number(req: FromNumberRequest):
    """
    Fetch any LeetCode problem by its number using the LeetCode GraphQL API.
    Works for all ~3000 free problems.
    """
    try:
        return await fetch_problem_by_number(req.number)
    except Exception as exc:
        logger.warning("LeetCode fetch failed for #%d: %s", req.number, exc)
        # Fallback to local database
        p = get_problem_by_id(req.number)
        if p:
            return p
        raise HTTPException(
            status_code=404,
            detail=f"Problem #{req.number} not found. {exc}",
        )


@router.post("/from-text", response_model=Problem)
async def problem_from_text(req: FromTextRequest):
    """
    Parse a pasted problem statement (any format) using Gemini.
    Accepts LeetCode, HackerRank, Codeforces, or any custom problem text.
    """
    if not req.text or len(req.text.strip()) < 20:
        raise HTTPException(
            status_code=422,
            detail="Problem text is too short. Paste the full problem statement.",
        )
    try:
        return await parse_problem_from_text(req.text)
    except Exception as exc:
        logger.exception("Text parse failed: %s", exc)
        raise HTTPException(status_code=500, detail=f"Failed to parse problem: {exc}")


@router.post("/from-image", response_model=Problem)
async def problem_from_image(req: FromImageRequest):
    """
    Parse a problem from a screenshot/photo using Gemini vision.
    image: base64-encoded image bytes (without data:... prefix).
    """
    if not req.image:
        raise HTTPException(status_code=422, detail="No image data provided.")
    try:
        return await parse_problem_from_image(req.image, req.mime)
    except Exception as exc:
        logger.exception("Image parse failed: %s", exc)
        raise HTTPException(status_code=500, detail=f"Failed to parse image: {exc}")


@router.post("/parse", response_model=Problem)
async def parse_problem_legacy(req: ParseRequest):
    """
    Legacy endpoint: auto-detect input type and resolve.
    Accepts: number, LeetCode URL, or title search.
    Now backed by live LeetCode fetching.
    """
    text = req.input.strip()

    # 1. Bare number
    if text.isdigit():
        return await problem_from_number(FromNumberRequest(number=int(text)))

    # 2. LeetCode URL
    slug_match = re.search(r"leetcode\.com/problems/([\w-]+)", text)
    if slug_match:
        slug = slug_match.group(1)
        try:
            return await fetch_problem_by_slug(slug)
        except Exception as exc:
            raise HTTPException(status_code=404, detail=str(exc))

    # 3. Try parsing as text (pasted problem)
    if len(text) > 50:
        return await problem_from_text(FromTextRequest(text=text))

    # 4. Title search in local DB
    from ..data.problems import search_problems_by_title
    p = search_problems_by_title(text)
    if p:
        return p

    raise HTTPException(
        status_code=404,
        detail=f"Could not resolve '{text}'. Try a LeetCode number, URL, or paste the full problem.",
    )


@router.get("", response_model=list[dict])
async def list_problems():
    """Return a summary list of the local curated problems."""
    return [
        {
            "id":         p.id,
            "title":      p.title,
            "difficulty": p.difficulty,
            "tags":       p.tags,
            "patterns":   p.patterns,
        }
        for p in list_all_problems()
    ]


@router.get("/{problem_id}", response_model=Problem)
async def get_problem(problem_id: int):
    """Fetch from local DB. For LeetCode problems use /from-number."""
    p = get_problem_by_id(problem_id)
    if not p:
        # Try live fetch
        try:
            return await fetch_problem_by_number(problem_id)
        except Exception:
            pass
        raise HTTPException(status_code=404, detail=f"Problem {problem_id} not found.")
    return p

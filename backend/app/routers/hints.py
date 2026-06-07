"""
routers/hints.py
Hint generation endpoint powered by LangGraph.

POST /api/hints
  → Runs hint_graph (build_hint_prompt → generate_hint_response)
  → Returns { level, label, content }
"""

import logging
from fastapi import APIRouter, Depends, HTTPException

from ..middleware.auth import get_current_user_full, AuthUser
from ..models.tutor import HintRequest, HintResponse
from ..graph.hint_graph import hint_graph

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/hints", tags=["hints"])

HINT_LEVEL_LABELS = {
    0: ("conceptual",  "Conceptual"),
    1: ("directional", "Directional"),
    2: ("structural",  "Structural"),
    3: ("code",        "Code-Level"),
}


@router.post("", response_model=HintResponse)
async def get_hint(
    request: HintRequest,
    auth: AuthUser = Depends(get_current_user_full),
):
    """
    Generate a contextual Socratic hint at the requested level.
    Powered by the LangGraph hint pipeline.
    """
    idx = request.next_hint_index
    logger.info("Hint requested: level=%d, problem=%s", idx, request.problem.title if request.problem else "none")

    try:
        state = {
            "hint_index": idx,
            "problem":    request.problem.model_dump() if request.problem else None,
            "code":       request.code,
            "prompt":     "",
            "hint_content": "",
        }

        result = await hint_graph.ainvoke(state)
        content = result.get("hint_content", "")

        if not content:
            raise ValueError("Empty hint response from Gemini")

        level_key, label = HINT_LEVEL_LABELS.get(idx, ("conceptual", "Conceptual"))
        return HintResponse(level=level_key, label=label, content=content)

    except Exception as exc:
        logger.exception("Hint generation failed: %s", exc)
        raise HTTPException(status_code=500, detail=str(exc))

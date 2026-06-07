"""
routers/tutor.py
Tutor streaming endpoint powered by LangGraph.

POST /api/tutor/stream
  1. Authenticates user via JWT → real student UUID
  2. Creates DB session (if first message)
  3. Streams LangGraph astream_events as SSE
  4. Saves tutor response + persists misconceptions/mastery tags to DB
  5. Returns X-Session-Id header for the frontend to persist

SSE event types:
  { type: "chunk",  content: "..." }
  { type: "tags",   misconceptions: [...], mastery: [...], vizTriggers: [...] }
  { type: "error",  message: "..." }
  { type: "done" }
"""

import json
import logging
from fastapi import APIRouter, BackgroundTasks, Depends
from fastapi.responses import StreamingResponse

from ..models.tutor import TutorStreamRequest
from ..middleware.auth import get_current_user_full, AuthUser
from ..services.session_manager import (
    create_session,
    update_session,
    upsert_student_profile,
    persist_tags,
    mark_problem_solved,
    save_message,
)
from ..services.tag_parser import ParsedTags
from ..graph.tutor_graph import tutor_graph

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/tutor", tags=["tutor"])


def _sse(payload: dict) -> str:
    return f"data: {json.dumps(payload)}\n\n"


@router.post("/stream")
async def tutor_stream(
    request: TutorStreamRequest,
    background_tasks: BackgroundTasks,
    auth: AuthUser = Depends(get_current_user_full),
):
    """
    Stream Socratic tutor response via Server-Sent Events.
    Powered by LangGraph + Gemini 2.5 Flash.
    student_id is the authenticated Supabase user UUID.
    """
    student_id = auth.id

    logger.info(
        "Stream request — student=%s (%s), problem=%s, messages=%d",
        student_id[:8] + "…",
        auth.email or "no-email",
        request.problem.title if request.problem else "none",
        len(request.messages),
    )

    # ── Create session on first message ───────────────────────────
    session_id = request.session_id

    if not session_id and request.problem:
        session_id = await create_session(
            student_id=student_id,
            problem_id=request.problem.id if request.problem else None,
            problem_title=request.problem.title if request.problem else None,
            language=request.language,
        )
        # Create / update student profile in background (session START)
        background_tasks.add_task(
            upsert_student_profile,
            student_id    = student_id,
            email         = auth.email,
            display_name  = auth.display_name,
            problem_id    = request.problem.id if request.problem else None,
            problem_title = request.problem.title if request.problem else None,
        )

    # ── Persist student message in background ──────────────────────
    if session_id and request.messages:
        last = request.messages[-1]
        if last.role == "student":
            background_tasks.add_task(save_message, session_id, "student", last.content)

    # ── Update session metadata in background ──────────────────────
    if session_id:
        background_tasks.add_task(
            update_session,
            session_id,
            hints_used=max(0, request.hint_level_index + 1),
            code_edits=request.signals.code_edits,
        )

    # ── Build LangGraph initial state ──────────────────────────────
    graph_state = {
        "student_id":       student_id,
        "session_id":       session_id,
        "problem":          request.problem.model_dump() if request.problem else None,
        "code":             request.code,
        "language":         request.language,
        "messages":         [m.model_dump() for m in request.messages],
        "hint_level_index": request.hint_level_index,
        "signals":          request.signals.model_dump(by_alias=False),
        "voice_mode":       request.voice_mode,
        # Output fields (populated by graph nodes)
        "context_prompt":   "",
        "lc_messages":      [],
        "full_response":    "",
        "parsed_tags":      {},
        "calibration_state": {},
        "error":            None,
    }

    # ── SSE generator ──────────────────────────────────────────────
    async def event_generator():
        final_output = {}
        had_error    = False

        try:
            async for event in tutor_graph.astream_events(graph_state, version="v2"):
                event_type = event.get("event", "")
                event_name = event.get("name", "")

                # Stream LLM tokens to frontend
                if event_type == "on_chat_model_stream":
                    chunk = event["data"].get("chunk")
                    if chunk and hasattr(chunk, "content") and chunk.content:
                        yield _sse({"type": "chunk", "content": chunk.content})

                # Capture final graph output
                elif event_type == "on_chain_end" and event_name == "LangGraph":
                    final_output = event["data"].get("output", {})

                # Node-level errors
                elif event_type == "on_chain_error":
                    err_msg = str(event["data"].get("error", "Unknown error"))
                    logger.error("Graph node error: %s", err_msg)
                    yield _sse({"type": "error", "message": err_msg})
                    had_error = True

        except Exception as exc:
            logger.exception("Graph streaming error: %s", exc)
            yield _sse({"type": "error", "message": str(exc)})
            had_error = True

        # ── After stream: persist tutor response + tags ────────────
        if not had_error and final_output and session_id:
            full_response = final_output.get("full_response", "")
            raw_tags      = final_output.get("parsed_tags", {})

            # Persist misconceptions + mastery events + solved to DB
            # NOTE: Tutor message is saved by the LangGraph persist_data node,
            #       so we do NOT save it again here (avoids double-insert).
            if raw_tags:
                problem_solved = raw_tags.get("problem_solved", False)
                tags = ParsedTags(
                    misconceptions  = raw_tags.get("misconceptions", []),
                    mastery_events  = raw_tags.get("mastery_events", []),
                    visualizations  = raw_tags.get("visualizations", []),
                    wait_seconds    = raw_tags.get("wait_seconds"),
                    problem_solved  = problem_solved,
                )
                problem_id = request.problem.id if request.problem else None
                pattern    = request.problem.patterns[0] if request.problem and request.problem.patterns else None
                background_tasks.add_task(
                    persist_tags,
                    session_id  = session_id,
                    student_id  = student_id,
                    problem_id  = problem_id,
                    pattern     = pattern,
                    tags        = tags,
                )

                # If problem solved, update session phase + profile immediately
                if problem_solved and session_id:
                    background_tasks.add_task(
                        mark_problem_solved,
                        session_id = session_id,
                        student_id = student_id,
                    )

                # Emit tags event to frontend (always if anything useful)
                misconceptions = raw_tags.get("misconceptions", [])
                mastery        = raw_tags.get("mastery_events", [])
                viz_triggers   = raw_tags.get("visualizations", [])
                if misconceptions or mastery or viz_triggers or problem_solved:
                    yield _sse({
                        "type":          "tags",
                        "misconceptions": misconceptions,
                        "mastery":        mastery,
                        "vizTriggers":    viz_triggers,
                        "waitSeconds":    raw_tags.get("wait_seconds"),
                        "problemSolved":  problem_solved,
                    })

            # Surface any LLM error from inside the graph
            err = final_output.get("error")
            if err:
                yield _sse({"type": "error", "message": err})

        yield _sse({"type": "done", "sessionId": session_id or ""})

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control":     "no-cache",
            "X-Accel-Buffering": "no",
            "Connection":        "keep-alive",
            "X-Session-Id":      session_id or "",
        },
    )

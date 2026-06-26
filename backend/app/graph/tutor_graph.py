"""
graph/tutor_graph.py
LangGraph StateGraph for the Socratic tutoring pipeline.

Graph topology:
  START → build_context → generate_response → parse_tags → check_grounding_drift → persist_data → END

Streaming:
  The router calls graph.astream_events(state, version="v2") and
  forwards "on_chat_model_stream" events to the SSE response.
  All other nodes run silently in the background.
"""

import logging
from langgraph.graph import StateGraph, START, END

from .state import TutorState
from .nodes import (
    build_context,
    generate_response,
    parse_tags_node,
    check_grounding_drift,
    persist_data,
)

logger = logging.getLogger(__name__)

# ── Build and compile the graph ───────────────────────────────────

def _build_tutor_graph():
    g = StateGraph(TutorState)

    g.add_node("build_context",          build_context)
    g.add_node("generate_response",      generate_response)
    g.add_node("parse_tags",             parse_tags_node)
    g.add_node("check_grounding_drift",  check_grounding_drift)
    g.add_node("persist_data",           persist_data)

    g.add_edge(START,                    "build_context")
    g.add_edge("build_context",          "generate_response")
    g.add_edge("generate_response",      "parse_tags")
    g.add_edge("parse_tags",             "check_grounding_drift")
    g.add_edge("check_grounding_drift",  "persist_data")
    g.add_edge("persist_data",            END)

    compiled = g.compile()
    logger.info(
        "Tutor graph compiled — nodes: build_context → generate_response → "
        "parse_tags → check_grounding_drift → persist_data"
    )
    return compiled


# Singleton — compiled once at import time
tutor_graph = _build_tutor_graph()

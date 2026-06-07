"""
graph/hint_graph.py
LangGraph StateGraph for hint generation.

Graph topology:
  START → build_hint_prompt → generate_hint_response → END
"""

import logging
from langgraph.graph import StateGraph, START, END

from .state import HintState
from .nodes import build_hint_prompt, generate_hint_response

logger = logging.getLogger(__name__)


def _build_hint_graph():
    g = StateGraph(HintState)

    g.add_node("build_hint_prompt",     build_hint_prompt)
    g.add_node("generate_hint_response", generate_hint_response)

    g.add_edge(START,                "build_hint_prompt")
    g.add_edge("build_hint_prompt",  "generate_hint_response")
    g.add_edge("generate_hint_response", END)

    compiled = g.compile()
    logger.info("Hint graph compiled")
    return compiled


# Singleton
hint_graph = _build_hint_graph()

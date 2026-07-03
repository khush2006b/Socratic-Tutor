"""
services/tag_parser.py
Parses structured tags from Gemini tutor responses.

Tags are probabilistic pedagogical suggestions embedded by the LLM.
They are NOT authoritative state — backend validates before acting on them.

Supported tags:
  [MISCONCEPTION: description]
  [MASTERY: pattern → level]
  [TRIGGER_VISUALIZATION: type]
  [PREREQUISITE_GAP: concept]
  [WAIT: seconds]          — pedagogical think-time (timed countdown)
  [PROBLEM_SOLVED]

Voice-mode dialogue tags (interpreted by frontend speech engine):
  [PAUSE:N]                — N seconds of deliberate silence
  [WAIT]                   — stop speaking, wait for student to respond (no countdown)
"""

import re
import logging
from dataclasses import dataclass, field
from typing import Optional

logger = logging.getLogger(__name__)

# ── Tag regex patterns ────────────────────────────────────────────

_TAG_PATTERNS = {
    "misconception":    re.compile(r'\[MISCONCEPTION:\s*(.+?)\]', re.IGNORECASE),
    "mastery":          re.compile(r'\[MASTERY:\s*(.+?)\s*(?:→|->)\s*(.+?)\]', re.IGNORECASE),
    "visualization":    re.compile(r'\[TRIGGER_VISUALIZATION:\s*(.+?)\]', re.IGNORECASE),
    "prerequisite_gap": re.compile(r'\[PREREQUISITE_GAP:\s*(.+?)\]', re.IGNORECASE),
    "wait":             re.compile(r'\[WAIT:\s*(\d+)\]', re.IGNORECASE),
    "problem_solved":   re.compile(r'\[PROBLEM_SOLVED\]', re.IGNORECASE),
    "calibration":      re.compile(r'\[CALIBRATION:\s*(.+?)\]', re.IGNORECASE),
}

# Voice dialogue tags — used by the frontend speech engine
_VOICE_TAG_PATTERNS = {
    "pause":       re.compile(r'\[PAUSE:\s*(\d+)\]', re.IGNORECASE),
    "wait_bare":   re.compile(r'\[WAIT\]', re.IGNORECASE),    # bare [WAIT] — no seconds
}

VALID_MASTERY_LEVELS = {"recognition", "application", "generalisation"}
VALID_VIZ_TYPES = {
    "sliding_window", "bfs", "dfs", "two_pointers",
    "stack", "recursion", "trie",
}
VALID_CALIBRATION_TYPES = {
    "reasoning_strong", "reasoning_weak", "transfer_shown",
    "self_corrected", "frustration_detected", "disagreement_detected",
    "confusion_detected", "edge_case_awareness", "misconception_persistent",
}


@dataclass
class ParsedTags:
    misconceptions:    list[str]  = field(default_factory=list)
    mastery_events:    list[dict] = field(default_factory=list)   # [{pattern, level}]
    visualizations:    list[str]  = field(default_factory=list)
    prerequisite_gaps: list[str]  = field(default_factory=list)
    calibration_signals: list[str] = field(default_factory=list)  # ["reasoning_strong", ...]
    wait_seconds:      Optional[int] = None
    problem_solved:    bool       = False   # True when [PROBLEM_SOLVED] tag emitted
    clean_text:        str        = ""      # response with tags stripped


def parse_tags(text: str) -> ParsedTags:
    """
    Extract all structured tags from a Gemini response.
    Returns ParsedTags with extracted data and the cleaned text.
    """
    result = ParsedTags()

    # Misconceptions
    for m in _TAG_PATTERNS["misconception"].finditer(text):
        desc = m.group(1).strip()
        if desc:
            result.misconceptions.append(desc)

    # Mastery events — validate level before accepting
    for m in _TAG_PATTERNS["mastery"].finditer(text):
        pattern = m.group(1).strip()
        level   = m.group(2).strip().lower()
        if level in VALID_MASTERY_LEVELS and pattern:
            result.mastery_events.append({"pattern": pattern, "level": level})

    # Visualization triggers — validate type
    for m in _TAG_PATTERNS["visualization"].finditer(text):
        viz_type = m.group(1).strip().lower()
        if viz_type in VALID_VIZ_TYPES:
            result.visualizations.append(viz_type)

    # Prerequisite gaps
    for m in _TAG_PATTERNS["prerequisite_gap"].finditer(text):
        concept = m.group(1).strip()
        if concept:
            result.prerequisite_gaps.append(concept)

    # Wait (timed — e.g. [WAIT: 10])
    wait_match = _TAG_PATTERNS["wait"].search(text)
    if wait_match:
        result.wait_seconds = int(wait_match.group(1))

    # Problem solved tag
    result.problem_solved = bool(_TAG_PATTERNS["problem_solved"].search(text))

    # Calibration signals — validated against known types
    for m in _TAG_PATTERNS["calibration"].finditer(text):
        cal_type = m.group(1).strip().lower().replace(" ", "_")
        if cal_type in VALID_CALIBRATION_TYPES:
            result.calibration_signals.append(cal_type)

    # Strip all pedagogical tags from text for clean display
    # NOTE: voice tags ([PAUSE:N], bare [WAIT]) are NOT stripped here —
    #       the frontend speech engine needs them in the streamed chunks.
    clean = text
    for pattern in _TAG_PATTERNS.values():
        clean = pattern.sub("", clean)
    result.clean_text = clean.strip()

    if any([
        result.misconceptions, result.mastery_events,
        result.visualizations, result.prerequisite_gaps,
        result.calibration_signals, result.problem_solved,
    ]):
        logger.info(
            "Tags parsed — misconceptions=%d, mastery=%d, viz=%d, calibration=%s, solved=%s",
            len(result.misconceptions),
            len(result.mastery_events),
            len(result.visualizations),
            result.calibration_signals,
            result.problem_solved,
        )

    return result


def strip_voice_tags(text: str) -> str:
    """
    Remove voice dialogue tags ([PAUSE:N], bare [WAIT]) from text.
    Used before saving tutor messages to DB so text-mode chat stays clean.
    Does NOT strip pedagogical tags like [WAIT: 10] (with seconds) —
    those are handled by parse_tags.
    """
    result = text
    for pattern in _VOICE_TAG_PATTERNS.values():
        result = pattern.sub("", result)
    # Collapse any resulting double-spaces or leading/trailing whitespace
    result = re.sub(r'  +', ' ', result).strip()
    return result

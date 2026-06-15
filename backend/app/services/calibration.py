"""
services/calibration.py
Adaptive Scaffolding & Student Calibration Engine.

Continuously estimates student understanding, frustration, confusion,
and compression readiness to dynamically adapt tutoring behaviour.

Architecture:
  - CalibrationState: 7 scored dimensions (0–10 each)
  - DialogueMode: derived from scores (beginner/guided/compressed/advanced/direct)
  - Update rules: simple arithmetic from LLM calibration tags + frontend signals
  - No ML, no black boxes — interpretable heuristic scoring

The LLM evaluates reasoning quality and emits [CALIBRATION: ...] tags.
This engine accumulates those judgments and feeds the derived dialogue mode
back into the next prompt.

v2 — fixes observed in real sessions:
  - Added DIRECT mode for confused+frustrated students (stop questioning, start explaining)
  - confusion_detected also bumps frustration (confused students get frustrated fast)
  - Lower frustration threshold (> 4 instead of > 6)
  - Anti-loop: high turn_count + confusion triggers DIRECT mode
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field, asdict
from typing import Optional

logger = logging.getLogger(__name__)

# ── Valid calibration tag types (emitted by LLM) ──────────────────

VALID_CALIBRATION_TYPES = frozenset({
    "reasoning_strong",
    "reasoning_weak",
    "transfer_shown",
    "self_corrected",
    "frustration_detected",
    "disagreement_detected",
    "confusion_detected",
    "edge_case_awareness",
    "misconception_persistent",
})


# ── Dialogue modes ────────────────────────────────────────────────

class DialogueMode:
    BEGINNER   = "beginner"
    GUIDED     = "guided"
    COMPRESSED = "compressed"
    ADVANCED   = "advanced"
    DIRECT     = "direct"      # confused+frustrated → stop questioning, give answers


# ── Calibration state ─────────────────────────────────────────────

@dataclass
class CalibrationState:
    """
    Per-session calibration state. Each dimension is 0–10.
    Updated every turn from LLM calibration tags + frontend signals.
    """

    # Understanding dimensions
    reasoning_quality: float = 3.0      # 0=vague → 10=precise abstraction
    transfer_ability: float = 2.0       # 0=no transfer → 10=spontaneous connections
    self_correction: float = 2.0        # 0=never self-corrects → 10=catches own errors

    # Emotional/engagement dimensions
    frustration: float = 0.0            # 0=calm → 10=very frustrated
    confusion: float = 3.0              # 0=clear → 10=deeply confused

    # Pacing dimensions
    compression_readiness: float = 2.0  # 0=needs full scaffolding → 10=wants compression

    # Derived — recomputed after every update
    dialogue_mode: str = DialogueMode.GUIDED

    # Tracking
    turn_count: int = 0                 # how many turns have updated this state

    def to_dict(self) -> dict:
        return asdict(self)

    @classmethod
    def from_dict(cls, data: dict) -> CalibrationState:
        if not data:
            return cls()
        # Only pick known fields
        known = {f.name for f in cls.__dataclass_fields__.values()}
        filtered = {k: v for k, v in data.items() if k in known}
        return cls(**filtered)

    @classmethod
    def warm_start(cls, profile_aggregate: dict, weight: float = 0.3) -> CalibrationState:
        """
        Create a new session state warm-started from cross-session profile.
        Uses a fractional weight so past performance informs but doesn't dominate.
        """
        state = cls()
        if not profile_aggregate:
            return state

        for dim in ("reasoning_quality", "transfer_ability", "self_correction",
                     "compression_readiness"):
            if dim in profile_aggregate:
                default = getattr(state, dim)
                profile_val = float(profile_aggregate[dim])
                # Blend: (1-w)*default + w*profile
                setattr(state, dim, round((1 - weight) * default + weight * profile_val, 2))

        state._recompute_mode()
        return state


    # ── Score update methods ──────────────────────────────────────

    def update_from_calibration_tag(self, tag_type: str) -> None:
        """
        Called when the LLM emits a [CALIBRATION: tag_type] tag.
        Each tag nudges the relevant dimensions.
        """
        if tag_type not in VALID_CALIBRATION_TYPES:
            logger.warning("Unknown calibration tag: %s", tag_type)
            return

        if tag_type == "reasoning_strong":
            self.reasoning_quality = _up(self.reasoning_quality, 1.5)
            self.confusion = _down(self.confusion, 1.0)
            self.compression_readiness = _up(self.compression_readiness, 0.5)

        elif tag_type == "reasoning_weak":
            self.reasoning_quality = _down(self.reasoning_quality, 1.0)
            self.confusion = _up(self.confusion, 0.5)
            self.compression_readiness = _down(self.compression_readiness, 0.5)

        elif tag_type == "transfer_shown":
            self.transfer_ability = _up(self.transfer_ability, 2.0)
            self.compression_readiness = _up(self.compression_readiness, 1.0)
            self.reasoning_quality = _up(self.reasoning_quality, 0.5)

        elif tag_type == "self_corrected":
            self.self_correction = _up(self.self_correction, 2.0)
            self.reasoning_quality = _up(self.reasoning_quality, 0.5)
            self.confusion = _down(self.confusion, 0.5)

        elif tag_type == "frustration_detected":
            self.frustration = _up(self.frustration, 2.5)
            self.compression_readiness = _up(self.compression_readiness, 1.5)

        elif tag_type == "disagreement_detected":
            # Student is pushing back with reasoning — they're frustrated but engaged
            self.frustration = _up(self.frustration, 1.0)  # mild frustration
            self.reasoning_quality = _up(self.reasoning_quality, 0.5)  # they're arguing with evidence
            self.self_correction = _up(self.self_correction, 0.3)  # shows independent thinking

        elif tag_type == "confusion_detected":
            self.confusion = _up(self.confusion, 2.0)
            self.compression_readiness = _down(self.compression_readiness, 1.0)
            # KEY FIX: confused students get frustrated fast — cross-contamination
            self.frustration = _up(self.frustration, 0.8)

        elif tag_type == "edge_case_awareness":
            self.reasoning_quality = _up(self.reasoning_quality, 1.0)
            self.self_correction = _up(self.self_correction, 0.5)

        elif tag_type == "misconception_persistent":
            self.confusion = _up(self.confusion, 1.5)
            self.reasoning_quality = _down(self.reasoning_quality, 0.5)
            # Persistent misconceptions are frustrating for the student
            self.frustration = _up(self.frustration, 0.5)

        self._recompute_mode()

    def update_from_frontend_signals(self, signals: dict) -> None:
        """
        Called each turn with frontend observable signals.
        Extracts behavioral heuristics for frustration, confusion, engagement.
        """
        self.turn_count += 1

        # ── Struggle intensity → confusion/frustration ────────────
        struggle = signals.get("struggle_intensity", 0) or signals.get("struggleIntensity", 0)
        if struggle >= 7:
            self.frustration = _up(self.frustration, 0.5)
            self.confusion = _up(self.confusion, 0.3)

        # ── Many hints → struggling ──────────────────────────────
        hints = signals.get("hints_requested", 0) or signals.get("hintsRequested", 0)
        if hints >= 3:
            self.confusion = _up(self.confusion, 0.5)
            self.compression_readiness = _down(self.compression_readiness, 0.5)

        # ── Short reply streak → frustration signal ──────────────
        short_streak = signals.get("short_replies_streak", 0) or signals.get("shortRepliesStreak", 0)
        if short_streak >= 2:  # Lowered from 3 → 2 (catch frustration earlier)
            self.frustration = _up(self.frustration, 1.5)
            self.compression_readiness = _up(self.compression_readiness, 0.5)

        # ── Voice reasoning → engagement (reduces frustration) ───
        if signals.get("voice_reasoning_given") or signals.get("voiceReasoningGiven"):
            self.frustration = _down(self.frustration, 0.5)

        # ── Natural decay each turn ──────────────────────────────
        # Frustration decays slowly — student calms down over time
        self.frustration = _down(self.frustration, 0.15)
        # Confusion also decays slightly (continued conversation helps)
        self.confusion = _down(self.confusion, 0.1)

        self._recompute_mode()

    def _recompute_mode(self) -> None:
        """Derive dialogue mode from current dimension scores."""
        understanding = (self.reasoning_quality + self.transfer_ability) / 2

        # DIRECT MODE: confused AND frustrated → stop questioning, start explaining
        # This is the "I don't know, just tell me" state.
        if self.confusion > 5 and self.frustration > 4:
            self.dialogue_mode = DialogueMode.DIRECT
        # DIRECT MODE: too many turns with persistent confusion → loop detected
        elif self.turn_count > 8 and self.confusion > 6:
            self.dialogue_mode = DialogueMode.DIRECT
        # Frustration without confusion → compress (skip obvious stuff)
        elif self.frustration > 4:
            self.dialogue_mode = DialogueMode.COMPRESSED
        # Confusion without frustration → scaffold patiently
        elif self.confusion > 6:
            self.dialogue_mode = DialogueMode.BEGINNER
        # Strong student ready for compression
        elif understanding >= 7 and self.compression_readiness >= 6:
            self.dialogue_mode = DialogueMode.ADVANCED
        # Moderate understanding
        elif understanding >= 4:
            self.dialogue_mode = DialogueMode.GUIDED
        # Needs scaffolding
        else:
            self.dialogue_mode = DialogueMode.BEGINNER

    def get_prompt_context(self) -> str:
        """
        Generate the prompt injection string for build_context_prompt.
        This tells the LLM how to adapt its behaviour.
        """
        lines = []
        mode = self.dialogue_mode

        lines.append(f"\n**Dialogue Mode: {mode.upper()}**")

        if mode == DialogueMode.DIRECT:
            lines.append(
                "🛑 STOP QUESTIONING. The student is confused AND frustrated. "
                "They need ANSWERS, not more questions.\n"
                "- If they ask for clarification, GIVE IT DIRECTLY.\n"
                "- State the definition, rule, or concept clearly.\n"
                "- Then ask ONE simple confirmation question.\n"
                "- Do NOT repeat what they just said back to them.\n"
                "- Do NOT ask them to re-derive something they've failed 3+ times on.\n"
                "- Move the conversation FORWARD — do not loop on the same point.\n"
                "- Example: 'Single-digit numbers are considered monotonic. "
                "Now, given that — how would you structure your DP state?'"
            )
        elif mode == DialogueMode.BEGINNER:
            lines.append(
                "Student needs scaffolding. Use concrete examples. "
                "Ask simple, focused questions. Slower pacing. "
                "Break down complex ideas into small steps. "
                "If the student explicitly asks for an answer, GIVE IT — "
                "then follow up with a question to check understanding."
            )
        elif mode == DialogueMode.GUIDED:
            lines.append(
                "Balanced questioning. Moderate abstraction. "
                "One focused question per turn. Standard pacing."
            )
        elif mode == DialogueMode.COMPRESSED:
            lines.append(
                "Student is ready for compression OR is getting frustrated. "
                "Skip obvious micro-steps. Move toward structural discussion. "
                "Fewer questions, more direct engagement. "
                "Avoid repetitive questioning — respect their time. "
                "Do NOT re-ask what they've already answered."
            )
        elif mode == DialogueMode.ADVANCED:
            lines.append(
                "Student is strong. Use proof-level reasoning. "
                "Ask about invariants, optimality, and complexity tradeoffs. "
                "Challenge with harder edge cases. "
                "Discuss meta-level patterns and transferable insights."
            )

        # Emotional alerts (always shown regardless of mode)
        if self.frustration > 3:
            lines.append(
                "⚠️ FRUSTRATION RISING (level: {:.0f}/10) — compress dialogue, "
                "reduce questioning depth, acknowledge what they already know, "
                "avoid asking the same question in different words.".format(self.frustration)
            )
        if self.confusion > 5:
            lines.append(
                "⚠️ CONFUSION HIGH (level: {:.0f}/10) — "
                "when student asks 'what should I do?' or 'I don't know' — "
                "ANSWER directly, then ask a simple follow-up.".format(self.confusion)
            )

        # Anti-loop warning
        if self.turn_count > 6:
            lines.append(
                f"📊 Turn count: {self.turn_count}. "
                "If you've been discussing the same sub-topic for 3+ turns, "
                "MOVE ON. State the answer and advance to the next concept."
            )

        return "\n".join(lines)

    def get_aggregate_for_profile(self) -> dict:
        """
        Return scores suitable for cross-session profile storage.
        Only includes dimensions that make sense to aggregate.
        """
        return {
            "reasoning_quality": round(self.reasoning_quality, 2),
            "transfer_ability": round(self.transfer_ability, 2),
            "self_correction": round(self.self_correction, 2),
            "compression_readiness": round(self.compression_readiness, 2),
            "turn_count": self.turn_count,
        }


# ── Helper functions ──────────────────────────────────────────────

def _up(current: float, delta: float, ceiling: float = 10.0) -> float:
    """Increase a score, clamped at ceiling."""
    return min(ceiling, round(current + delta, 2))

def _down(current: float, delta: float, floor: float = 0.0) -> float:
    """Decrease a score, clamped at floor."""
    return max(floor, round(current - delta, 2))

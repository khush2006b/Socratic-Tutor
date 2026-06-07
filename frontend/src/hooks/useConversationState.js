/**
 * useConversationState.js
 *
 * Finite state machine for the voice conversation flow.
 *
 * States:
 *   idle        — voice mode not active
 *   listening   — microphone live, waiting for student input
 *   processing  — student finished speaking, request in flight
 *   speaking    — AI response streaming to TTS
 *   think_time  — deliberate pedagogical pause ([WAIT: N] tag)
 *   error       — recoverable fault (mic denied, network error…)
 *
 * All state transitions are validated against an explicit allowed-transitions
 * table so bugs in orchestration logic surface as warnings rather than
 * silent inconsistencies.
 */

import { useState, useRef, useCallback, useEffect } from 'react';

export const VS = Object.freeze({
  IDLE:       'idle',
  LISTENING:  'listening',
  PROCESSING: 'processing',
  SPEAKING:   'speaking',
  WAITING:    'waiting',      // tutor asked a question, patiently waiting for student
  THINK_TIME: 'think_time',
  ERROR:      'error',
});

// Which transitions are explicitly allowed
const ALLOWED = {
  idle:       [VS.LISTENING,  VS.ERROR],
  listening:  [VS.PROCESSING, VS.IDLE, VS.ERROR],
  processing: [VS.SPEAKING,   VS.LISTENING, VS.IDLE, VS.ERROR],
  speaking:   [VS.LISTENING,  VS.WAITING, VS.THINK_TIME, VS.IDLE, VS.ERROR],
  waiting:    [VS.PROCESSING, VS.LISTENING, VS.IDLE, VS.ERROR],
  think_time: [VS.LISTENING,  VS.IDLE, VS.ERROR],
  error:      [VS.IDLE,       VS.LISTENING],
};

export function useConversationState({ onTransition } = {}) {
  const [state,              setState]              = useState(VS.IDLE);
  const [thinkTimeRemaining, setThinkTimeRemaining] = useState(0);

  const stateRef      = useRef(VS.IDLE);
  const thinkTimerRef = useRef(null);

  // Callback ref so callers don't need to memoize
  const onTransitionRef = useRef(onTransition);
  useEffect(() => { onTransitionRef.current = onTransition; }, [onTransition]);

  /** Attempt a state transition. Returns true if successful. */
  const transition = useCallback((next, meta = {}) => {
    const current = stateRef.current;
    const allowed = ALLOWED[current] ?? [];

    if (!allowed.includes(next)) {
      if (process.env.NODE_ENV !== 'production') {
        console.warn(`[VoiceState] Invalid: ${current} → ${next}`);
      }
      return false;
    }

    // Clear any running think-time timer
    if (thinkTimerRef.current) {
      clearInterval(thinkTimerRef.current);
      thinkTimerRef.current = null;
    }

    stateRef.current = next;
    setState(next);
    onTransitionRef.current?.(next, current, meta);
    return true;
  }, []);

  /**
   * Enter think_time for `seconds`, then call onComplete and return to listening.
   * onComplete must handle the transition — this function only manages the timer.
   */
  const startThinkTime = useCallback((seconds, onComplete) => {
    if (!transition(VS.THINK_TIME)) return;

    let remaining = seconds;
    setThinkTimeRemaining(remaining);

    thinkTimerRef.current = setInterval(() => {
      remaining -= 1;
      setThinkTimeRemaining(remaining);
      if (remaining <= 0) {
        clearInterval(thinkTimerRef.current);
        thinkTimerRef.current = null;
        setThinkTimeRemaining(0);
        onComplete?.();
      }
    }, 1000);
  }, [transition]);

  // Cleanup timer on unmount
  useEffect(() => {
    return () => {
      if (thinkTimerRef.current) clearInterval(thinkTimerRef.current);
    };
  }, []);

  return {
    state,
    thinkTimeRemaining,

    // Convenience booleans
    isIdle:       state === VS.IDLE,
    isListening:  state === VS.LISTENING,
    isProcessing: state === VS.PROCESSING,
    isSpeaking:   state === VS.SPEAKING,
    isWaiting:    state === VS.WAITING,
    isThinking:   state === VS.THINK_TIME,
    isError:      state === VS.ERROR,

    transition,
    startThinkTime,
  };
}

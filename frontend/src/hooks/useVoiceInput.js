/**
 * useVoiceInput.js
 *
 * Speech-to-text (STT) hook — continuous mode with manual silence detection.
 *
 * Why continuous: true?
 *   Chrome's `continuous: false` has an internal ~6s timeout that fires
 *   `onerror('no-speech')` if the user doesn't speak immediately.
 *   This causes a restart loop and a "stuck on listening" experience.
 *
 *   With `continuous: true`, the mic stays open indefinitely.
 *   WE control when to submit via a silence timer:
 *     - Every time speech is detected → reset a 2-second timer
 *     - When 2 seconds of silence pass after speech → stop and submit
 *     - If no speech at all → mic just stays open (no timeout)
 *
 * Flow:
 *   startListening() → mic opens
 *   user speaks → interim results displayed live
 *   user pauses 2s → silence timer fires → recognition stops → onUtteranceEnd(text)
 *   orchestrator sends to backend → TTS plays response → calls startListening() again
 */

import { useState, useRef, useCallback, useEffect } from 'react';

const DEFAULT_LANG       = 'en-US';
const SILENCE_TIMEOUT_MS = 2000; // 2s of no new results after speech = submit

export function useVoiceInput({
  onUtteranceEnd,
  onRecognitionEnd,
  onInterimUpdate,
  onError,
  language         = DEFAULT_LANG,
  silenceMs        = SILENCE_TIMEOUT_MS,
} = {}) {
  // ── Support check ──────────────────────────────────────────────
  const isSupported = typeof window !== 'undefined' && (
    'SpeechRecognition' in window || 'webkitSpeechRecognition' in window
  );

  // ── State ──────────────────────────────────────────────────────
  const [isListening,       setIsListening]       = useState(false);
  const [transcript,        setTranscript]        = useState('');
  const [interimTranscript, setInterimTranscript] = useState('');
  const [error,             setError]             = useState(null);

  // ── Refs ───────────────────────────────────────────────────────
  const recognitionRef     = useRef(null);
  const finalPartsRef      = useRef('');  // accumulated isFinal results
  const lastInterimRef     = useRef('');  // most recent interim result
  const isListeningRef     = useRef(false);
  const stoppedManuallyRef = useRef(false);
  const hadSpeechRef       = useRef(false); // did we get any onresult at all?
  const silenceTimerRef    = useRef(null);

  // Callback refs
  const onUtteranceEndRef   = useRef(onUtteranceEnd);
  const onRecognitionEndRef = useRef(onRecognitionEnd);
  const onInterimRef        = useRef(onInterimUpdate);
  const onErrorRef          = useRef(onError);
  useEffect(() => { onUtteranceEndRef.current   = onUtteranceEnd;   }, [onUtteranceEnd]);
  useEffect(() => { onRecognitionEndRef.current = onRecognitionEnd; }, [onRecognitionEnd]);
  useEffect(() => { onInterimRef.current        = onInterimUpdate;  }, [onInterimUpdate]);
  useEffect(() => { onErrorRef.current          = onError;          }, [onError]);

  // ── Clear silence timer ────────────────────────────────────────
  const clearSilence = useCallback(() => {
    if (silenceTimerRef.current) {
      clearTimeout(silenceTimerRef.current);
      silenceTimerRef.current = null;
    }
  }, []);

  // ── Stop (manual — does NOT submit transcript) ─────────────────
  const stopListening = useCallback(() => {
    stoppedManuallyRef.current = true;
    clearSilence();
    if (recognitionRef.current && isListeningRef.current) {
      try { recognitionRef.current.stop(); } catch {}
    }
    isListeningRef.current = false;
    setIsListening(false);
    setInterimTranscript('');
  }, [clearSilence]);

  // ── Start ──────────────────────────────────────────────────────
  const startListening = useCallback(() => {
    if (!isSupported) {
      console.warn('[Voice] Web Speech API not supported in this browser');
      return;
    }
    if (isListeningRef.current) {
      console.warn('[Voice] Already listening — skipping start');
      return;
    }

    // Reset for new utterance
    setError(null);
    finalPartsRef.current      = '';
    lastInterimRef.current     = '';
    stoppedManuallyRef.current = false;
    hadSpeechRef.current       = false;
    setTranscript('');
    setInterimTranscript('');
    clearSilence();

    const SpeechRecognition =
      window.SpeechRecognition || window.webkitSpeechRecognition;
    const recognition = new SpeechRecognition();

    recognition.lang            = language;
    recognition.continuous      = true;   // ← stay open until WE stop
    recognition.interimResults  = true;
    recognition.maxAlternatives = 1;

    // ── onstart ────────────────────────────────────────────
    recognition.onstart = () => {
      console.log('[Voice] ✅ Mic opened — listening');
      isListeningRef.current = true;
      setIsListening(true);
      setError(null);
    };

    // ── onaudiostart — browser got mic access ──────────────
    recognition.onaudiostart = () => {
      console.log('[Voice] 🎤 Audio stream started');
    };

    // ── onspeechstart — speech detected ────────────────────
    recognition.onspeechstart = () => {
      console.log('[Voice] 🗣️ Speech detected');
    };

    // ── onresult — accumulate results, manage silence timer
    recognition.onresult = (event) => {
      hadSpeechRef.current = true;
      let currentFinal   = '';
      let currentInterim = '';

      for (let i = 0; i < event.results.length; i++) {
        const result = event.results[i];
        if (result.isFinal) {
          currentFinal += result[0].transcript;
        } else {
          currentInterim += result[0].transcript;
        }
      }

      finalPartsRef.current  = currentFinal;
      lastInterimRef.current = currentInterim;

      const displayFinal   = currentFinal.trim();
      const displayInterim = currentInterim.trim();
      setTranscript(displayFinal);
      setInterimTranscript(displayInterim);
      onInterimRef.current?.(displayFinal + ' ' + displayInterim);

      // ── Silence timer: reset on every result ─────────
      // After 2s of no new results = user stopped speaking
      clearSilence();
      const combined = (currentFinal + ' ' + currentInterim).trim();
      if (combined) {
        silenceTimerRef.current = setTimeout(() => {
          console.log('[Voice] 🔇 Silence detected — submitting:', combined);
          // Stop recognition — onend will fire
          stoppedManuallyRef.current = false; // we WANT to submit
          if (recognitionRef.current) {
            try { recognitionRef.current.stop(); } catch {}
          }
        }, silenceMs);
      }
    };

    // ── onerror ────────────────────────────────────────────
    recognition.onerror = (event) => {
      const code = event.error;
      console.warn('[Voice] ⚠️ Error:', code);

      // 'no-speech' with continuous:true shouldn't normally fire,
      // but handle it gracefully if it does
      if (code === 'no-speech' || code === 'aborted') {
        return; // onend will handle it
      }

      // Real error
      const err = new Error(`Speech recognition error: ${code}`);
      setError(code);
      onErrorRef.current?.(err);
    };

    // ── onend ──────────────────────────────────────────────
    recognition.onend = () => {
      console.log('[Voice] 🔴 Recognition ended — manual?',
        stoppedManuallyRef.current, '— had speech?', hadSpeechRef.current);

      clearSilence();
      isListeningRef.current = false;
      setIsListening(false);
      setInterimTranscript('');

      if (stoppedManuallyRef.current) {
        stoppedManuallyRef.current = false;
        return;
      }

      // Gather the best transcript we have (final + interim)
      const final   = finalPartsRef.current.trim();
      const interim = lastInterimRef.current.trim();
      const best    = final || interim; // prefer final, fall back to interim

      if (best) {
        console.log('[Voice] 📤 Submitting transcript:', best);
        onUtteranceEndRef.current?.(best);
      } else {
        // No speech captured — let orchestrator decide (restart or not)
        console.log('[Voice] 📭 No speech captured — notifying orchestrator');
        onRecognitionEndRef.current?.(null);
      }
    };

    recognitionRef.current = recognition;

    try {
      recognition.start();
      console.log('[Voice] 🚀 Recognition.start() called');
    } catch (e) {
      console.error('[Voice] ❌ start() threw:', e.message);
      setError('start-failed');
      onErrorRef.current?.(e);
    }
  }, [isSupported, language, silenceMs, stopListening, clearSilence]);

  // ── Reset transcript ───────────────────────────────────────────
  const resetTranscript = useCallback(() => {
    finalPartsRef.current  = '';
    lastInterimRef.current = '';
    setTranscript('');
    setInterimTranscript('');
  }, []);

  // ── Cleanup on unmount ─────────────────────────────────────────
  useEffect(() => {
    return () => {
      clearSilence();
      stoppedManuallyRef.current = true;
      if (recognitionRef.current) {
        try { recognitionRef.current.stop(); } catch {}
      }
    };
  }, [clearSilence]);

  return {
    isListening,
    isSupported,
    transcript,
    interimTranscript,
    error,
    startListening,
    stopListening,
    resetTranscript,
  };
}

/**
 * useVoiceTutor.js
 *
 * Orchestrator for the voice-native conversational interaction layer.
 * Creates a phone-call loop with conversational pacing:
 *
 *   ┌─ Student speaks ──────┐
 *   │                       │
 *   │  STT captures speech  │
 *   │  recognition.onend    │
 *   │  → transcript ready   │
 *   │                       ▼
 *   │          ┌─────────────────────┐
 *   │          │  Send to backend    │
 *   │          │  (SSE stream)       │
 *   │          └──────────┬──────────┘
 *   │                     │ chunks arrive (with [PAUSE], [WAIT] tags)
 *   │                     ▼
 *   │          ┌─────────────────────┐
 *   │          │  Speech engine      │
 *   │          │  speaks sentences,  │
 *   │          │  pauses at [PAUSE], │
 *   │          │  stops at [WAIT]    │
 *   │          └──────────┬──────────┘
 *   │                     │
 *   │              ┌──────┴──────┐
 *   │              │             │
 *   │          [WAIT] hit    queue drained
 *   │              │             │
 *   │          WAITING       LISTENING
 *   │          (patient)     (active)
 *   │              │             │
 *   └──── Student speaks ────────┘
 *
 * Key invariant: the mic does NOT restart until BOTH the backend
 * stream is complete AND the TTS queue is fully drained (or [WAIT] fires).
 * This prevents the mic from picking up the computer's own voice.
 *
 * Architecture:
 *   Fast lane : STT → backend stream → sentence TTS  (no blocking)
 *   Slow lane : DB writes, session management        (background tasks)
 */

import { useCallback, useRef, useEffect } from 'react';

import { useVoiceInput }                  from './useVoiceInput';
import { useSpeechOutput }                from './useSpeechOutput';
import { useConversationState, VS }       from './useConversationState';
import useSessionStore                    from '../store/sessionStore';
import { streamTutorResponse }            from '../api/tutor';

export function useVoiceTutor({ speechRate = 1.05, onError } = {}) {
  // ── Refs for cross-callback coordination ───────────────────────
  const abortRef         = useRef(null);
  const streamDoneRef    = useRef(false); // true once backend onDone fires
  const voiceActiveRef   = useRef(false); // true while voice mode is on

  // ── State machine ──────────────────────────────────────────────
  const conv = useConversationState();

  // ── Session store selectors ────────────────────────────────────
  const messages       = useSessionStore(s => s.messages);
  const problem        = useSessionStore(s => s.problem);
  const code           = useSessionStore(s => s.code);
  const language       = useSessionStore(s => s.language);
  const signals        = useSessionStore(s => s.signals);
  const hintLevelIndex = useSessionStore(s => s.hintLevelIndex);
  const sessionId      = useSessionStore(s => s.sessionId);
  const studentId      = useSessionStore(s => s.studentId);
  const phase          = useSessionStore(s => s.phase);

  const addMessage     = useSessionStore(s => s.addMessage);
  const startStreaming = useSessionStore(s => s.startStreaming);
  const appendChunk    = useSessionStore(s => s.appendStreamChunk);
  const finalizeStream = useSessionStore(s => s.finalizeStream);
  const handleTagEvent = useSessionStore(s => s.handleTagEvent);
  const setSessionId   = useSessionStore(s => s.setSessionId);
  const markVoice      = useSessionStore(s => s.markVoiceReasoningGiven);

  // Always-fresh refs for async callbacks
  const messagesRef  = useRef(messages);
  const sessionIdRef = useRef(sessionId);
  const problemRef   = useRef(problem);
  const codeRef      = useRef(code);
  const signalsRef   = useRef(signals);
  const hintLevelRef = useRef(hintLevelIndex);
  const languageRef  = useRef(language);
  const phaseRef     = useRef(phase);
  const convStateRef = useRef(conv.state);

  useEffect(() => { messagesRef.current  = messages;       }, [messages]);
  useEffect(() => { sessionIdRef.current = sessionId;      }, [sessionId]);
  useEffect(() => { problemRef.current   = problem;        }, [problem]);
  useEffect(() => { codeRef.current      = code;           }, [code]);
  useEffect(() => { signalsRef.current   = signals;        }, [signals]);
  useEffect(() => { hintLevelRef.current = hintLevelIndex; }, [hintLevelIndex]);
  useEffect(() => { languageRef.current  = language;       }, [language]);
  useEffect(() => { phaseRef.current     = phase;          }, [phase]);
  useEffect(() => { convStateRef.current = conv.state;     }, [conv.state]);

  // ── Think-time state ───────────────────────────────────────────
  const pendingThinkTimeRef = useRef(0);

  // ── Helper: restart mic if voice mode is still active ──────────
  // IMPORTANT: We delay 700ms after TTS ends to avoid the mic picking
  // up residual speaker audio (the computer's own voice).
  const doRestartListening = useCallback(() => {
    if (!voiceActiveRef.current) return;

    setTimeout(() => {
      if (!voiceActiveRef.current) return;

      // Safety: if TTS is somehow still playing, don't open the mic
      if (window.speechSynthesis?.speaking) {
        console.log('[VoiceTutor] ⏳ TTS still playing — waiting...');
        setTimeout(() => doRestartListening(), 500);
        return;
      }

      console.log('[VoiceTutor] 🎤 Restarting mic (700ms after TTS ended)');
      conv.transition(VS.LISTENING);
      sttRef.current?.startListening();
    }, 700);
  }, [conv]);

  // ── Helper: enter WAITING state (tutor asked question, waiting for student) ──
  const doEnterWaiting = useCallback(() => {
    if (!voiceActiveRef.current) return;

    // Brief delay to avoid mic picking up last TTS syllable
    setTimeout(() => {
      if (!voiceActiveRef.current) return;

      if (window.speechSynthesis?.speaking) {
        setTimeout(() => doEnterWaiting(), 300);
        return;
      }

      console.log('[VoiceTutor] 🤔 Entering WAITING — tutor asked a question');
      conv.transition(VS.WAITING);
      // Start the mic — student should be able to respond
      sttRef.current?.startListening();
    }, 500);
  }, [conv]);

  // Forward refs so callbacks/cleanup can reach hooks without re-render deps
  const sttRef = useRef(null);
  const ttsRef = useRef(null);

  // ── TTS ────────────────────────────────────────────────────────
  const tts = useSpeechOutput({
    rate: speechRate,

    // Called when the TTS queue is fully drained (all speech + pauses done)
    onSpeakEnd: () => {
      // TTS queue fully drained.
      // Only restart mic if the backend stream is ALSO done.
      if (!streamDoneRef.current) return; // more chunks may arrive

      // Check for think-time before restarting
      const thinkSecs = pendingThinkTimeRef.current;
      pendingThinkTimeRef.current = 0;

      if (thinkSecs > 0) {
        conv.startThinkTime(thinkSecs, () => doRestartListening());
      } else {
        doRestartListening();
      }
    },

    // Called when [WAIT] tag is hit — tutor asked a question and stopped
    onWaitForStudent: () => {
      console.log('[VoiceTutor] ⏸️ [WAIT] hit — tutor waiting for student response');
      streamDoneRef.current = true; // treat as stream complete for this exchange
      doEnterWaiting();
    },
  });

  // ── Ref to handleStudentSpeech ─────────────────────────────────
  const handleStudentSpeechRef = useRef(null);

  // ── STT ────────────────────────────────────────────────────────
  const stt = useVoiceInput({
    onUtteranceEnd: (transcript) => {
      console.log('[VoiceTutor] 📥 Got utterance:', transcript);
      handleStudentSpeechRef.current?.(transcript);
    },

    // This fires when recognition ends with NO speech captured.
    onRecognitionEnd: (reason) => {
      console.log('[VoiceTutor] 🔄 Recognition ended, reason:', reason);
      if (reason === 'error') {
        conv.transition(VS.ERROR);
        return;
      }
      // No speech captured — auto-restart to keep the phone call alive
      if (voiceActiveRef.current) {
        console.log('[VoiceTutor] 🔄 Auto-restarting mic in 500ms...');
        setTimeout(() => {
          if (voiceActiveRef.current) {
            sttRef.current?.startListening();
          }
        }, 500);
      }
    },

    onInterimUpdate: null,
    onError: (err) => console.warn('[VoiceTutor] ⚠️ STT error:', err.message),
  });

  // Keep refs current for cleanup and callbacks
  sttRef.current = stt;
  ttsRef.current = tts;

  // ── Core: send student transcript to AI ────────────────────────
  handleStudentSpeechRef.current = (transcript) => {
    if (!transcript.trim()) {
      console.log('[VoiceTutor] ⏭️ Empty transcript — skipping');
      return;
    }
    if (phaseRef.current === 'idle' || phaseRef.current === 'complete') {
      console.log('[VoiceTutor] ⏭️ Phase is', phaseRef.current, '— skipping');
      return;
    }

    console.log('[VoiceTutor] 🚀 Sending to AI:', transcript);
    console.log('[VoiceTutor]    Phase:', phaseRef.current, 'SessionId:', sessionIdRef.current);

    // Mark that the student gave voice reasoning
    markVoice?.();

    // CRITICAL: Stop recognition FIRST to prevent mic from picking up TTS
    sttRef.current?.stopListening();

    // Cancel any ongoing tutor speech
    ttsRef.current?.cancel();
    abortRef.current?.abort();

    // Reset stream-done flag for this new exchange
    streamDoneRef.current       = false;
    pendingThinkTimeRef.current = 0;

    // Add message to chat (text panel stays in sync)
    addMessage('student', transcript);
    conv.transition(VS.PROCESSING);
    startStreaming();

    const updatedMessages = [
      ...messagesRef.current,
      { role: 'student', content: transcript, timestamp: new Date().toISOString() },
    ];

    let firstChunk = true;

    const controller = streamTutorResponse(
      {
        studentId,
        sessionId:      sessionIdRef.current,
        problem:        problemRef.current,
        code:           codeRef.current,
        language:       languageRef.current,
        messages:       updatedMessages,
        hintLevelIndex: hintLevelRef.current,
        signals:        signalsRef.current,
        voiceMode:      true, // short conversational responses
      },
      {
        // ── Chunk arrives → update chat + feed TTS ──────────
        onChunk: (chunk) => {
          appendChunk(chunk);
          ttsRef.current?.feedChunk(chunk);

          if (firstChunk) {
            firstChunk = false;
            console.log('[VoiceTutor] 🗣️ First chunk received — transitioning to SPEAKING');
            conv.transition(VS.SPEAKING);
          }
        },

        // ── Tags (misconceptions, mastery, wait, solved) ────
        onTags: (tagsEvent) => {
          handleTagEvent(tagsEvent);

          // Store think-time to apply after TTS finishes
          if (tagsEvent.waitSeconds) {
            pendingThinkTimeRef.current = tagsEvent.waitSeconds;
          }
        },

        // ── Stream complete ─────────────────────────────────
        onDone: (returnedSessionId) => {
          console.log('[VoiceTutor] ✅ Stream done — TTS speaking?', ttsRef.current?.isSpeaking);
          streamDoneRef.current = true;

          ttsRef.current?.flushBuffer();
          finalizeStream();

          if (returnedSessionId && returnedSessionId !== sessionIdRef.current) {
            setSessionId(returnedSessionId);
          }

          // If TTS already finished (or never started), restart mic now
          if (!ttsRef.current?.isSpeaking && !window.speechSynthesis?.speaking) {
            console.log('[VoiceTutor] 🎤 TTS not speaking — restarting mic');
            const thinkSecs = pendingThinkTimeRef.current;
            pendingThinkTimeRef.current = 0;

            if (thinkSecs > 0) {
              conv.startThinkTime(thinkSecs, () => doRestartListening());
            } else {
              doRestartListening();
            }
          } else {
            console.log('[VoiceTutor] 🔊 TTS still speaking — will restart mic when done');
          }
        },

        // ── Error recovery ──────────────────────────────────
        onError: (err) => {
          console.error('[VoiceTutor] Stream error:', err);
          streamDoneRef.current = true;
          finalizeStream();
          onError?.(err);
          doRestartListening(); // recover — let student try again
        },
      }
    );

    abortRef.current = controller;
  };

  // ── Public: activate voice mode ────────────────────────────────
  const startVoiceMode = useCallback(() => {
    console.log('[VoiceTutor] 🎙️ startVoiceMode — phase:', phaseRef.current);
    if (phaseRef.current === 'idle' || phaseRef.current === 'complete') {
      console.log('[VoiceTutor] ⏭️ Cannot start voice mode in phase:', phaseRef.current);
      return;
    }
    voiceActiveRef.current = true;
    streamDoneRef.current  = false;
    conv.transition(VS.LISTENING);
    sttRef.current?.startListening();
  }, [conv]);

  // ── Public: deactivate voice mode cleanly ──────────────────────
  const stopVoiceMode = useCallback(() => {
    voiceActiveRef.current = false;
    sttRef.current?.stopListening();
    ttsRef.current?.cancel();
    abortRef.current?.abort();
    conv.transition(VS.IDLE);
  }, [conv]);

  // ── Public: interrupt tutor mid-sentence ───────────────────────
  const interrupt = useCallback(() => {
    ttsRef.current?.cancel();
    abortRef.current?.abort();
    streamDoneRef.current = true;
    if (voiceActiveRef.current) {
      conv.transition(VS.LISTENING);
      sttRef.current?.startListening();
    }
  }, [conv]);

  // ── Cleanup on unmount ONLY ────────────────────────────────────
  // CRITICAL: deps must be [] — using [stt, tts] caused cleanup to
  // fire on every render, killing recognition mid-utterance.
  useEffect(() => {
    return () => {
      voiceActiveRef.current = false;
      sttRef.current?.stopListening();
      ttsRef.current?.cancel();
      abortRef.current?.abort();
    };
  }, []);

  // ── Exposed interface ──────────────────────────────────────────
  return {
    // State
    voiceState:         conv.state,
    isIdle:             conv.isIdle,
    isListening:        stt.isListening,
    isProcessing:       conv.isProcessing,
    isSpeaking:         tts.isSpeaking,
    isWaiting:          conv.isWaiting,
    isThinking:         conv.isThinking,
    thinkTimeRemaining: conv.thinkTimeRemaining,
    currentSentence:    tts.currentSentence,

    // STT live transcript
    transcript:         stt.transcript,
    interimTranscript:  stt.interimTranscript,

    // Feature support
    isSTTSupported:     stt.isSupported,
    isTTSSupported:     tts.isSupported,

    // Controls
    startVoiceMode,
    stopVoiceMode,
    interrupt,
    setRate:            tts.setRate,
  };
}

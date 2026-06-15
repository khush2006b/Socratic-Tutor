/**
 * VoiceMode.jsx
 *
 * Floating voice panel — the "phone call" interface.
 *
 * Conversation loop:
 *   1. Panel opens → mic starts automatically
 *   2. Student speaks → interim transcript shown in real-time
 *   3. Student pauses → recognition ends → transcript sent to AI
 *   4. AI streams response → orb animates → TTS speaks each sentence
 *   5. TTS finishes → mic restarts → back to step 2
 *
 * The student can interrupt the tutor at ANY time by tapping the orb.
 * The text chat panel stays fully in sync — every voice turn appears there too.
 */

import { useState, useCallback, useEffect, useRef } from 'react';
import { useVoiceTutor }                    from '../hooks/useVoiceTutor';
import { VS }                               from '../hooks/useConversationState';
import useSessionStore                       from '../store/sessionStore';
import styles                                from './VoiceMode.module.css';

/* ── State labels ────────────────────────────────────────────── */
const STATE_LABELS = {
  [VS.IDLE]:       '',
  [VS.LISTENING]:  'Listening…',
  [VS.PROCESSING]: 'Thinking…',
  [VS.SPEAKING]:   'Speaking',
  [VS.WAITING]:    '…',
  [VS.THINK_TIME]: 'Think about it',
  [VS.ERROR]:      'Error — tap to retry',
};

/* ── Animated orb ────────────────────────────────────────────── */
function Orb({ voiceState, thinkTimeRemaining, onClick, isSpeaking, isListening }) {
  const orbClass = [
    styles.orb,
    isListening                         && styles.orbListening,
    voiceState === VS.PROCESSING        && styles.orbProcessing,
    isSpeaking                          && styles.orbSpeaking,
    voiceState === VS.WAITING           && styles.orbWaiting,
    voiceState === VS.THINK_TIME        && styles.orbThinkTime,
    voiceState === VS.ERROR             && styles.orbError,
  ].filter(Boolean).join(' ');

  return (
    <button className={orbClass} onClick={onClick} aria-label="Voice interaction orb">
      {voiceState === VS.THINK_TIME ? (
        <span className={styles.orbTimer}>{thinkTimeRemaining}</span>
      ) : isSpeaking ? (
        <span className={styles.orbIcon}>◾</span>
      ) : isListening ? (
        <span className={styles.orbIcon}>◉</span>
      ) : (
        <span className={styles.orbIcon}>⬡</span>
      )}
      {isListening && (
        <>
          <span className={`${styles.ring} ${styles.ring1}`} />
          <span className={`${styles.ring} ${styles.ring2}`} />
        </>
      )}
    </button>
  );
}

/* ── Live transcript display ─────────────────────────────────── */
function TranscriptDisplay({ transcript, interimTranscript, currentSentence, voiceState }) {
  const showTutor   = voiceState === VS.SPEAKING && currentSentence;
  const showStudent = (voiceState === VS.LISTENING || voiceState === VS.PROCESSING);

  return (
    <div className={styles.transcriptArea} aria-live="polite">
      {showTutor && (
        <p className={styles.tutorLine}>
          <span className={styles.speakerLabel}>Tutor</span>
          {currentSentence}
        </p>
      )}
      {showStudent && (interimTranscript || transcript) && (
        <p className={styles.studentLine}>
          <span className={styles.speakerLabel}>You</span>
          <span className={styles.interimText}>{interimTranscript || transcript}</span>
        </p>
      )}
    </div>
  );
}

/* ── Rate control ────────────────────────────────────────────── */
const RATE_OPTIONS = [
  { label: '0.8×', value: 0.8 },
  { label: '1×',   value: 1.0 },
  { label: '1.2×', value: 1.2 },
  { label: '1.5×', value: 1.5 },
];

function RateControl({ rate, onChange }) {
  return (
    <div className={styles.rateControl} role="group" aria-label="Speech rate">
      {RATE_OPTIONS.map(opt => (
        <button
          key={opt.value}
          className={`${styles.rateBtn} ${rate === opt.value ? styles.rateBtnActive : ''}`}
          onClick={() => onChange(opt.value)}
          aria-pressed={rate === opt.value}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}

/* ── Main component ──────────────────────────────────────────── */
export default function VoiceMode({ onClose }) {
  const phase = useSessionStore(s => s.phase);
  const [rate, setRateState] = useState(1.0);

  const voice = useVoiceTutor({ speechRate: rate });

  const {
    voiceState,
    isIdle,
    isListening,
    isProcessing,
    isSpeaking,
    isWaiting,
    isThinking,
    thinkTimeRemaining,
    currentSentence,
    transcript,
    interimTranscript,
    isSTTSupported,
    isTTSSupported,
    startVoiceMode,
    stopVoiceMode,
    interrupt,
    setRate,
  } = voice;

  // Auto-start voice mode on mount
  useEffect(() => {
    if (phase !== 'idle' && phase !== 'complete') {
      startVoiceMode();
    }
    return () => stopVoiceMode();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // intentionally run only once on mount

  const handleRateChange = useCallback((r) => {
    setRateState(r);
    setRate(r);
  }, [setRate]);

  // Orb tap: interrupt if speaking/processing, restart if idle
  const handleOrbClick = useCallback(() => {
    if (isSpeaking || isProcessing) {
      interrupt();
    } else if (isWaiting) {
      // Student taps orb during WAITING — show them we're listening actively
      // (mic is already on, but this gives visual feedback)
      startVoiceMode();
    } else if (isIdle && phase !== 'idle' && phase !== 'complete') {
      startVoiceMode();
    }
  }, [isSpeaking, isProcessing, isWaiting, isIdle, phase, interrupt, startVoiceMode]);

  const handleClose = useCallback(() => {
    stopVoiceMode();
    onClose?.();
  }, [stopVoiceMode, onClose]);

  // ── Browser unsupported ──────────────────────────────────────
  if (!isSTTSupported) {
    return (
      <div className={styles.panel} role="dialog" aria-label="Voice mode">
        <div className={styles.unsupported}>
          <span>🎤</span>
          <p>Voice input is not supported in this browser.</p>
          <p className={styles.unsupportedSub}>Use Chrome or Edge for voice mode.</p>
          <button className={styles.closeBtn} onClick={handleClose}>Close</button>
        </div>
      </div>
    );
  }

  /* ── Drag-to-move logic ──────────────────────────────────────── */
  const panelRef     = useRef(null);
  const dragOffset   = useRef({ x: 0, y: 0 });
  const [pos, setPos] = useState(null); // null = default CSS position
  const [isDragging, setIsDragging] = useState(false);

  const onPointerDown = useCallback((e) => {
    // Only drag from the header bar
    if (!panelRef.current) return;
    e.preventDefault();
    const rect = panelRef.current.getBoundingClientRect();
    dragOffset.current = {
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
    };
    setIsDragging(true);
    panelRef.current.setPointerCapture(e.pointerId);
  }, []);

  const onPointerMove = useCallback((e) => {
    if (!isDragging || !panelRef.current) return;
    const rect = panelRef.current.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    let newX = e.clientX - dragOffset.current.x;
    let newY = e.clientY - dragOffset.current.y;
    // Clamp to viewport
    newX = Math.max(0, Math.min(newX, vw - rect.width));
    newY = Math.max(0, Math.min(newY, vh - rect.height));
    setPos({ x: newX, y: newY });
  }, [isDragging]);

  const onPointerUp = useCallback(() => {
    setIsDragging(false);
  }, []);

  const panelStyle = pos
    ? { position: 'fixed', left: pos.x, top: pos.y, bottom: 'auto', right: 'auto' }
    : {};

  return (
    <div
      className={`${styles.panel} ${isDragging ? styles.panelDragging : ''}`}
      role="dialog"
      aria-modal="true"
      aria-label="Voice tutoring mode"
      ref={panelRef}
      style={panelStyle}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
    >
      {/* ── Header (drag handle) ── */}
      <div
        className={styles.header}
        onPointerDown={onPointerDown}
        style={{ cursor: isDragging ? 'grabbing' : 'grab' }}
      >
        <div className={styles.headerLeft}>
          <span className={styles.dot} />
          <span className={styles.title}>Voice Mode</span>
        </div>
        <button
          id="btn-voice-close"
          className={styles.closeBtn}
          onClick={handleClose}
          aria-label="Exit voice mode"
        >
          ✕
        </button>
      </div>

      {/* ── State label ── */}
      <p className={styles.stateLabel} aria-live="polite">
        {STATE_LABELS[voiceState] ?? ''}
        {isThinking && thinkTimeRemaining > 0 && (
          <span className={styles.thinkHint}> — {thinkTimeRemaining}s</span>
        )}
      </p>

      {/* ── Orb ── */}
      <div className={styles.orbWrapper}>
        <Orb
          voiceState={voiceState}
          thinkTimeRemaining={thinkTimeRemaining}
          onClick={handleOrbClick}
          isSpeaking={isSpeaking}
          isListening={isListening}
        />
      </div>

      {/* ── Live transcript ── */}
      <TranscriptDisplay
        transcript={transcript}
        interimTranscript={interimTranscript}
        currentSentence={currentSentence}
        voiceState={voiceState}
      />

      {/* ── Hint text ── */}
      <p className={styles.hint}>
        {isSpeaking
          ? 'Tap orb to interrupt and speak'
          : isListening
          ? 'Speak your reasoning…'
          : isProcessing
          ? 'Processing your input…'
          : isWaiting
          ? 'Take your time…'
          : isThinking
          ? 'Take your time to think'
          : ''}
      </p>

      {/* ── Footer controls ── */}
      <div className={styles.footer}>
        {isTTSSupported && (
          <RateControl rate={rate} onChange={handleRateChange} />
        )}
        <button
          id="btn-voice-interrupt"
          className={`${styles.interruptBtn} ${isSpeaking ? styles.interruptActive : ''}`}
          onClick={interrupt}
          disabled={!isSpeaking && !isProcessing}
          aria-label="Interrupt tutor"
          title="Interrupt"
        >
          ⏹ Interrupt
        </button>
      </div>
    </div>
  );
}

/**
 * Header.jsx
 * Top navigation bar — logo, problem title, session timer, controls.
 */

import { useEffect, useRef } from 'react';
import useSessionStore from '../store/sessionStore';
import useAuthStore    from '../store/authStore';
import styles from './Header.module.css';

const PHASE_LABELS = {
  idle:       { label: 'Ready',      color: 'var(--color-text-tertiary)' },
  solving:    { label: 'Solving',    color: 'var(--color-success)'       },
  stuck:      { label: 'Stuck',      color: 'var(--color-warning)'       },
  solved:     { label: 'Solved 🎉',   color: '#4ade80'                    },
  reflecting: { label: 'Reflecting', color: 'var(--color-accent)'        },
  complete:   { label: 'Complete',   color: 'var(--color-success)'       },
};

function formatTime(seconds) {
  const m = Math.floor(seconds / 60).toString().padStart(2, '0');
  const s = (seconds % 60).toString().padStart(2, '0');
  return `${m}:${s}`;
}

export default function Header({ onEndSession, currentView, onViewChange, isVoiceOpen, onToggleVoice }) {
  const problem        = useSessionStore((s) => s.problem);
  const phase          = useSessionStore((s) => s.phase);
  const elapsedSeconds = useSessionStore((s) => s.elapsedSeconds);
  const tickTimer      = useSessionStore((s) => s.tickTimer);

  const displayName = useAuthStore(s => s.displayName());
  const signOut     = useAuthStore(s => s.signOut);
  const user        = useAuthStore(s => s.user);

  const timerRef = useRef(null);

  useEffect(() => {
    if (phase === 'solving' || phase === 'stuck') {
      timerRef.current = setInterval(tickTimer, 1000);
    } else {
      clearInterval(timerRef.current);
    }
    return () => clearInterval(timerRef.current);
  }, [phase, tickTimer]);

  const phaseInfo = PHASE_LABELS[phase];

  return (
    <header className={styles.header} role="banner">
      {/* Logo */}
      <div className={styles.logo}>
        <span className={styles.logoMark} aria-hidden="true">⬡</span>
        <span className={styles.logoText}>SocraticDS</span>
      </div>

      {/* Problem title */}
      <div className={styles.center}>
        {problem ? (
          <div className={styles.problemInfo}>
            <span className={styles.problemTitle}>{problem.title}</span>
            <span
              className={styles.difficultyBadge}
              data-difficulty={problem.difficulty?.toLowerCase()}
            >
              {problem.difficulty}
            </span>
          </div>
        ) : (
          <span className={styles.emptyTitle}>No problem loaded</span>
        )}
      </div>

      {/* Controls */}
      <div className={styles.controls}>
        {/* Phase indicator */}
        <div className={styles.phaseIndicator} aria-label={`Session phase: ${phaseInfo.label}`}>
          <span
            className={styles.phaseDot}
            style={{ backgroundColor: phaseInfo.color }}
            aria-hidden="true"
          />
          <span className={styles.phaseLabel} style={{ color: phaseInfo.color }}>
            {phaseInfo.label}
          </span>
        </div>

        {/* Timer */}
        {phase !== 'idle' && (
          <div className={styles.timer} aria-label="Session time elapsed">
            <span className={styles.timerIcon} aria-hidden="true">◷</span>
            <span className={styles.timerValue}>{formatTime(elapsedSeconds)}</span>
          </div>
        )}

        {/* Notes nav */}
        <button
          id="btn-nav-notes"
          className={`${styles.navBtn} ${currentView === 'notes' ? styles.navBtnActive : ''}`}
          onClick={() => onViewChange(currentView === 'notes' ? 'tutor' : 'notes')}
          aria-label={currentView === 'notes' ? 'Back to tutor' : 'View session notes'}
          title="Session Notes"
        >
          📓 Notes
        </button>

        {/* End session */}
        {(phase === 'solving' || phase === 'stuck' || phase === 'solved') && currentView === 'tutor' && (
          <button
            id="btn-end-session"
            className={styles.endButton}
            onClick={onEndSession}
            aria-label="End session and begin reflection"
          >
            End Session
          </button>
        )}

        {/* Voice mode toggle */}
        {(phase === 'solving' || phase === 'stuck' || phase === 'solved') && currentView === 'tutor' && (
          <button
            id="btn-voice-mode"
            className={`${styles.voiceToggleBtn} ${isVoiceOpen ? styles.voiceToggleActive : ''}`}
            onClick={onToggleVoice}
            aria-label={isVoiceOpen ? 'Close voice mode' : 'Open voice mode'}
            aria-pressed={isVoiceOpen}
            title={isVoiceOpen ? 'Exit voice mode' : 'Voice mode — explain your reasoning aloud'}
          >
            {isVoiceOpen ? '◉' : '🎤'}
          </button>
        )}

        {/* User info + logout */}
        {user && (
          <div className={styles.userSection}>
            <div className={styles.avatar} aria-hidden="true" title={user.email}>
              {(displayName?.[0] ?? '?').toUpperCase()}
            </div>
            <span className={styles.displayName}>{displayName}</span>
            <button
              id="btn-logout"
              className={styles.logoutBtn}
              onClick={signOut}
              aria-label="Sign out"
              title="Sign out"
            >
              ↪
            </button>
          </div>
        )}
      </div>
    </header>
  );
}

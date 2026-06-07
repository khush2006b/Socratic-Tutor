/**
 * BottomBar.jsx
 * Status bar — hint level, struggle indicator, session controls.
 */

import useSessionStore from '../store/sessionStore';
import styles from './BottomBar.module.css';

const STRUGGLE_LEVELS = [
  { max: 2,  label: 'Flowing',     emoji: '🟢', color: 'var(--color-success)' },
  { max: 5,  label: 'Working',     emoji: '🟡', color: 'var(--color-warning)' },
  { max: 8,  label: 'Struggling',  emoji: '🟠', color: '#fb923c' },
  { max: 10, label: 'Very Stuck',  emoji: '🔴', color: 'var(--color-danger)' },
];

function getStruggleLevel(intensity) {
  return STRUGGLE_LEVELS.find((l) => intensity <= l.max) ?? STRUGGLE_LEVELS.at(-1);
}

const HINT_LEVEL_NAMES = ['Conceptual', 'Directional', 'Structural', 'Code-Level'];

export default function BottomBar() {
  const phase          = useSessionStore((s) => s.phase);
  const signals        = useSessionStore((s) => s.signals);
  const hintLevelIndex = useSessionStore((s) => s.hintLevelIndex);
  const problem        = useSessionStore((s) => s.problem);

  const struggle = getStruggleLevel(signals.struggleIntensity);
  const currentHintName = hintLevelIndex >= 0 ? HINT_LEVEL_NAMES[hintLevelIndex] : null;

  const isActive = phase === 'solving' || phase === 'stuck';

  return (
    <footer className={styles.bar} role="status" aria-label="Session status">
      {/* Left — struggle indicator */}
      <div className={styles.section}>
        {isActive && (
          <div className={styles.indicator} title={`Struggle intensity: ${signals.struggleIntensity}/10`}>
            <span aria-hidden="true">{struggle.emoji}</span>
            <span className={styles.indicatorLabel} style={{ color: struggle.color }}>
              {struggle.label}
            </span>
          </div>
        )}
        {!isActive && (
          <span className={styles.dimText}>
            {phase === 'idle' ? 'Load a problem to begin' : `Phase: ${phase}`}
          </span>
        )}
      </div>

      {/* Center — hint info */}
      <div className={styles.section}>
        {hintLevelIndex >= 0 && (
          <div className={styles.hintInfo}>
            <span className={styles.hintLabel}>Last hint:</span>
            <span className={styles.hintValue}>{currentHintName}</span>
            <span className={styles.hintCount}>
              ({hintLevelIndex + 1}/{HINT_LEVEL_NAMES.length})
            </span>
          </div>
        )}
        {isActive && hintLevelIndex < 0 && (
          <span className={styles.dimText}>No hints used yet</span>
        )}
      </div>

      {/* Right — metadata */}
      <div className={`${styles.section} ${styles.sectionRight}`}>
        {problem && (
          <div className={styles.metaChips}>
            {problem.patterns?.map((p) => (
              <span key={p} className={styles.chip}>{p}</span>
            ))}
            <span className={styles.separator} aria-hidden="true">·</span>
            <span className={styles.dimText}>{signals.codeEdits} edits</span>
          </div>
        )}
      </div>
    </footer>
  );
}

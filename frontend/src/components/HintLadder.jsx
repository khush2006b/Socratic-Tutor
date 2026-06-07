/**
 * HintLadder.jsx
 * Hint level indicator and "Request Hint" button.
 * Displays progressively revealed hints in the tutor chat panel area.
 *
 * The hint ladder is separate from TutorChat so it can be independently styled
 * and potentially moved to the bottom bar or a drawer in later stages.
 */

import { useState, useCallback } from 'react';
import useSessionStore from '../store/sessionStore';
import { requestHint } from '../api/tutor';
import styles from './HintLadder.module.css';

const HINT_LEVEL_STYLES = {
  conceptual:  { color: 'var(--color-hint-1)', label: 'Conceptual',  icon: '💡' },
  directional: { color: 'var(--color-hint-2)', label: 'Directional', icon: '🧭' },
  structural:  { color: 'var(--color-hint-3)', label: 'Structural',  icon: '🏗️' },
  code:        { color: 'var(--color-hint-4)', label: 'Code-Level',  icon: '💻' },
};

const TOTAL_LEVELS = 4;

export default function HintLadder() {
  const problem        = useSessionStore((s) => s.problem);
  const phase          = useSessionStore((s) => s.phase);
  const hintLevelIndex = useSessionStore((s) => s.hintLevelIndex);
  const hintsUsed      = useSessionStore((s) => s.hintsUsed);
  const code           = useSessionStore((s) => s.code);
  const escalateHint   = useSessionStore((s) => s.escalateHint);
  const addMessage     = useSessionStore((s) => s.addMessage);

  const [isLoading, setIsLoading] = useState(false);

  const nextIndex = hintLevelIndex + 1;
  const isMaxed   = nextIndex >= TOTAL_LEVELS;
  const canRequest = problem && (phase === 'solving' || phase === 'stuck') && !isLoading;

  const handleRequestHint = useCallback(async () => {
    if (!canRequest || isMaxed) return;

    setIsLoading(true);
    try {
      const hint = await requestHint(nextIndex, { problem, code });
      escalateHint(hint.content);

      // Post hint into chat as a tutor message with context
      const levelInfo = HINT_LEVEL_STYLES[hint.level];
      addMessage(
        'tutor',
        `**${levelInfo.icon} ${levelInfo.label} Hint**\n\n${hint.content}`
      );
    } catch (err) {
      console.error('[HintLadder] Failed to fetch hint:', err);
    } finally {
      setIsLoading(false);
    }
  }, [canRequest, isMaxed, nextIndex, problem, code, escalateHint, addMessage]);

  if (!problem) return null;

  return (
    <div className={styles.wrapper} aria-label="Hint ladder">
      {/* Level dots */}
      <div className={styles.levels} aria-label="Hint levels used">
        {Array.from({ length: TOTAL_LEVELS }).map((_, i) => {
          const levelKey = Object.keys(HINT_LEVEL_STYLES)[i];
          const info     = HINT_LEVEL_STYLES[levelKey];
          const isUsed   = i <= hintLevelIndex;
          const isCurrent = i === hintLevelIndex;

          return (
            <div
              key={levelKey}
              className={`${styles.level} ${isUsed ? styles.levelUsed : ''} ${isCurrent ? styles.levelCurrent : ''}`}
              style={isUsed ? { '--level-color': info.color } : {}}
              title={info.label}
              aria-label={`${info.label} hint ${isUsed ? '(used)' : '(available)'}`}
            >
              <span className={styles.levelDot} />
              <span className={styles.levelLabel}>{info.label}</span>
            </div>
          );
        })}
      </div>

      {/* Request button */}
      <button
        id="btn-request-hint"
        className={styles.hintButton}
        onClick={handleRequestHint}
        disabled={!canRequest || isMaxed}
        aria-label={
          isMaxed
            ? 'Maximum hint level reached'
            : `Request ${Object.keys(HINT_LEVEL_STYLES)[nextIndex] ?? ''} hint`
        }
      >
        {isLoading ? (
          <span className={`${styles.btnSpinner} animate-spin`} aria-hidden="true" />
        ) : isMaxed ? (
          '✓ All hints used'
        ) : (
          `Request hint ${nextIndex + 1} of ${TOTAL_LEVELS}`
        )}
      </button>

      {isMaxed && (
        <p className={styles.maxNote}>
          You've seen all available hints. Try the structured hint above and think through each step.
        </p>
      )}
    </div>
  );
}

/**
 * ReflectionModal.jsx
 * Post-session reflection drawer/modal.
 *
 * Triggered when user clicks "End Session" in the header.
 * Walks through structured reflection questions, then saves session summary.
 *
 * Architecture: modal state lives in sessionStore (isReflectionOpen).
 * This keeps App.jsx clean — it just renders <ReflectionModal /> always.
 */

import { useState, useCallback, useEffect, useRef } from 'react';
import useSessionStore from '../store/sessionStore';
import { submitReflection } from '../api/tutor';
import styles from './ReflectionModal.module.css';

const STEPS = [
  {
    id: 'pattern',
    question: 'What algorithmic pattern did you use, and why was it the right choice?',
    placeholder: 'e.g. Sliding Window — because the problem asked for a contiguous subarray with a condition…',
    required: true,
  },
  {
    id: 'insight',
    question: 'What was the key insight that unlocked the solution?',
    placeholder: 'e.g. I realised I needed to store the complement, not the value itself…',
    required: true,
  },
  {
    id: 'stuck',
    question: 'Where did you get stuck, and what helped you move forward?',
    placeholder: 'e.g. I kept confusing the left pointer update logic. The invariant question from the tutor helped…',
    required: false,
  },
  {
    id: 'transfer',
    question: 'Name 2–3 other problems where this same pattern would apply.',
    placeholder: 'e.g. Maximum Subarray, Minimum Window Substring, Longest Repeating Character Replacement…',
    required: false,
  },
];

export default function ReflectionModal() {
  const isOpen          = useSessionStore((s) => s.isReflectionOpen);
  const problem         = useSessionStore((s) => s.problem);
  const hintLevelIndex  = useSessionStore((s) => s.hintLevelIndex);
  const elapsedSeconds  = useSessionStore((s) => s.elapsedSeconds);
  const studentId       = useSessionStore((s) => s.studentId);
  const sessionId       = useSessionStore((s) => s.sessionId);
  const closeReflection = useSessionStore((s) => s.closeReflection);
  const completeSession = useSessionStore((s) => s.completeSession);

  const [step, setStep]       = useState(0);
  const [answers, setAnswers] = useState({});
  const [isSaving, setIsSaving] = useState(false);
  const [isSaved, setIsSaved]   = useState(false);
  const textareaRef = useRef(null);

  /* Focus textarea when step changes */
  useEffect(() => {
    if (isOpen) {
      setTimeout(() => textareaRef.current?.focus(), 50);
    }
  }, [isOpen, step]);

  /* Reset state when modal opens */
  useEffect(() => {
    if (isOpen) {
      setStep(0);
      setAnswers({});
      setIsSaved(false);
    }
  }, [isOpen]);

  /* Close on Escape */
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape' && isOpen) closeReflection(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [isOpen, closeReflection]);

  const currentStep = STEPS[step];
  const isLastStep  = step === STEPS.length - 1;
  const canAdvance  = !currentStep.required || (answers[currentStep.id] ?? '').trim().length > 0;

  const handleAnswer = useCallback((value) => {
    setAnswers((prev) => ({ ...prev, [currentStep.id]: value }));
  }, [currentStep.id]);

  const handleNext = useCallback(() => {
    if (step < STEPS.length - 1) {
      setStep((s) => s + 1);
    }
  }, [step]);

  const handleSave = useCallback(async () => {
    setIsSaving(true);
    try {
      const data = {
        studentId,
        sessionId,
        problemId:    problem?.id,
        problemTitle: problem?.title,
        problem:      problem,            // full problem for note generation
        messages:     useSessionStore.getState().messages,  // full conversation
        answers,
        hintsUsed:      hintLevelIndex + 1,
        elapsedSeconds,
        timestamp: new Date().toISOString(),
      };
      await submitReflection(data);
      completeSession(data);
      setIsSaved(true);
    } catch (err) {
      console.error('[ReflectionModal] Save failed:', err);
    } finally {
      setIsSaving(false);
    }
  }, [answers, problem, hintLevelIndex, elapsedSeconds, studentId, sessionId, completeSession]);

  if (!isOpen) return null;

  return (
    <>
      {/* Backdrop */}
      <div
        className={styles.backdrop}
        onClick={closeReflection}
        aria-hidden="true"
      />

      {/* Modal */}
      <div
        className={`${styles.modal} animate-scale-in`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="reflection-title"
      >
        {/* Header */}
        <div className={styles.modalHeader}>
          <div className={styles.headerLeft}>
            <span className={styles.headerIcon} aria-hidden="true">✦</span>
            <div>
              <h2 id="reflection-title" className={styles.modalTitle}>
                Session Reflection
              </h2>
              {problem && (
                <p className={styles.modalSubtitle}>{problem.title}</p>
              )}
            </div>
          </div>
          <button
            id="btn-close-reflection"
            className={styles.closeBtn}
            onClick={closeReflection}
            aria-label="Close reflection"
          >
            ✕
          </button>
        </div>

        {!isSaved ? (
          <>
            {/* Progress */}
            <div className={styles.progress} aria-label={`Step ${step + 1} of ${STEPS.length}`}>
              {STEPS.map((s, i) => (
                <div
                  key={s.id}
                  className={`${styles.progressDot} ${i <= step ? styles.progressDotActive : ''}`}
                />
              ))}
              <span className={styles.progressLabel}>
                {step + 1} / {STEPS.length}
              </span>
            </div>

            {/* Question */}
            <div className={styles.questionArea} key={step}>
              <p className={styles.question}>{currentStep.question}</p>
              {!currentStep.required && (
                <span className={styles.optional}>(optional)</span>
              )}
              <textarea
                ref={textareaRef}
                id={`reflection-${currentStep.id}`}
                className={styles.answerTextarea}
                placeholder={currentStep.placeholder}
                value={answers[currentStep.id] ?? ''}
                onChange={(e) => handleAnswer(e.target.value)}
                rows={4}
                aria-label={currentStep.question}
              />
            </div>

            {/* Stats strip */}
            <div className={styles.statsStrip}>
              <Stat label="Time" value={formatTime(elapsedSeconds)} />
              <Stat label="Hints used" value={`${Math.max(0, hintLevelIndex + 1)} / 4`} />
              <Stat label="Pattern" value={problem?.patterns?.[0] ?? '—'} />
            </div>

            {/* Actions */}
            <div className={styles.actions}>
              {step > 0 && (
                <button
                  className={styles.backBtn}
                  onClick={() => setStep((s) => s - 1)}
                >
                  ← Back
                </button>
              )}
              <span className={styles.actionsSpacer} />
              {!isLastStep ? (
                <button
                  id="btn-reflection-next"
                  className={styles.primaryBtn}
                  onClick={handleNext}
                  disabled={!canAdvance}
                >
                  Next →
                </button>
              ) : (
                <button
                  id="btn-save-reflection"
                  className={styles.saveBtn}
                  onClick={handleSave}
                  disabled={isSaving}
                >
                  {isSaving ? (
                    <>
                      <span className={`${styles.btnSpinner} animate-spin`} aria-hidden="true" />
                      Saving…
                    </>
                  ) : (
                    '✓ Save & Complete'
                  )}
                </button>
              )}
            </div>
          </>
        ) : (
          /* Saved state */
          <div className={`${styles.savedState} animate-scale-in`}>
            <span className={styles.savedIcon} aria-hidden="true">✦</span>
            <h3 className={styles.savedTitle}>Session saved!</h3>
            <p className={styles.savedText}>
              Your reflection has been recorded. In Stage 2, this will update your mastery model and generate personalised next-problem recommendations.
            </p>
            <div className={styles.savedStats}>
              <Stat label="Time spent" value={formatTime(elapsedSeconds)} />
              <Stat label="Hints used" value={`${Math.max(0, hintLevelIndex + 1)} / 4`} />
            </div>
            <button
              id="btn-reflection-done"
              className={styles.primaryBtn}
              onClick={closeReflection}
            >
              Done
            </button>
          </div>
        )}
      </div>
    </>
  );
}

function Stat({ label, value }) {
  return (
    <div className={styles.stat}>
      <span className={styles.statLabel}>{label}</span>
      <span className={styles.statValue}>{value}</span>
    </div>
  );
}

function formatTime(seconds) {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

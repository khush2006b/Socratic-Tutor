/**
 * sessionStore.js
 * Zustand store — single source of truth for tutoring session state.
 * All state mutations go through defined actions only.
 *
 * Stage 2 additions:
 *  - studentId: anonymous UUID persisted in localStorage
 *  - sessionId: DB session ID returned by backend via X-Session-Id header
 *  - vizTriggers: list of visualization types suggested by Gemini tags
 */

import { create } from 'zustand';
import useAuthStore from './authStore';

/** @typedef {'idle' | 'solving' | 'stuck' | 'solved' | 'reflecting' | 'complete'} SessionPhase */
/** @typedef {'conceptual' | 'directional' | 'structural' | 'code'} HintLevel */

const HINT_LEVELS = ['conceptual', 'directional', 'structural', 'code'];
const HINT_LABELS = {
  conceptual:  'Conceptual',
  directional: 'Directional',
  structural:  'Structural',
  code:        'Code-Level',
};

/* ── Student identity — always use real Supabase user ID ──────── */
// Read from authStore (JWT-verified UUID). Falls back to localStorage
// anonymous UUID only for unauthenticated dev sessions.
function getStudentId() {
  const authId = useAuthStore.getState().userId();
  if (authId) return authId;
  // Fallback for dev/unauthenticated use
  const key = 'socratic_student_id';
  let id = localStorage.getItem(key);
  if (!id) { id = crypto.randomUUID(); localStorage.setItem(key, id); }
  return id;
}

/* ── Initial state ────────────────────────────────────────────── */

const initialState = {
  /* ── Identity ─────────────────────────────────────────────── */
  studentId: getStudentId(),  // Real Supabase UUID (or anon fallback)
  sessionId: null,            // DB session ID returned by backend (X-Session-Id header)

  /* ── Problem ─────────────────────────────────────────────── */
  problem: null,
  isLoadingProblem: false,

  /* ── Editor ──────────────────────────────────────────────── */
  code: '',
  language: 'python',
  lastCodeSnapshot: '',

  /* ── AI tags ──────────────────────────────────────────────── */
  vizTriggers:       [],    // [{type, timestamp}]
  masteryEvents:     [],    // [{pattern, level, timestamp}]
  misconceptions:    [],    // [string]
  problemSolved:     false, // true when AI emits [PROBLEM_SOLVED]

  /* ── Chat ────────────────────────────────────────────────── */
  messages: [],           // { id, role: 'tutor'|'student', content, timestamp }
  isStreaming: false,
  streamingContent: '',

  /* ── Hints ───────────────────────────────────────────────── */
  hintLevelIndex: -1,
  hintsUsed: [],

  /* ── Session ─────────────────────────────────────────────── */
  phase: 'idle',
  sessionStartTime: null,
  elapsedSeconds: 0,

  /* ── Reflection ──────────────────────────────────────────── */
  isReflectionOpen: false,
  reflectionData: null,

  /* ── Inferred signals (probabilistic, not authoritative) ─── */
  signals: {
    struggleIntensity: 0,
    hintsRequested: 0,
    codeEdits: 0,
    voiceReasoningGiven: false,
    messageCount: 0,           // total student messages this session
    avgMessageLength: 0,       // running average of student message length
    shortRepliesStreak: 0,     // consecutive short replies (< 15 chars) → frustration
  },
};

/* ── Store ───────────────────────────────────────────────────── */

const useSessionStore = create((set, get) => ({
  ...initialState,

  /* ── Problem actions ──────────────────────────────────────── */

  setProblem: (problem) =>
    set({
      problem,
      phase: 'solving',
      sessionStartTime: Date.now(),
      sessionId: null,     // Reset — new session ID will arrive from backend
      hintLevelIndex: -1,
      hintsUsed: [],
      vizTriggers: [],
      signals: { ...initialState.signals },
      elapsedSeconds: 0,
      messages: [
        {
          id: crypto.randomUUID(),
          role: 'tutor',
          content: `Let's work through **${problem.title}** together.\n\nBefore writing any code — what do you notice about the input and output? What's the problem really asking you to do?`,
          timestamp: new Date().toISOString(),
        },
      ],
    }),

  setLoadingProblem: (isLoading) => set({ isLoadingProblem: isLoading }),

  clearProblem: () =>
    set({ ...initialState, studentId: getStudentId() }),

  /* ── Session ID (returned by backend) ────────────────────── */

  setSessionId:  (sessionId)  => set({ sessionId }),
  setStudentId:  (studentId)  => set({ studentId }),

  /* ── Editor actions ───────────────────────────────────────── */

  setCode: (code) => {
    const prev = get().signals;
    set({ code, signals: { ...prev, codeEdits: prev.codeEdits + 1 } });
  },

  setLanguage: (language) => set({ language }),

  snapshotCode: () => set((s) => ({ lastCodeSnapshot: s.code })),

  /* ── Chat actions ─────────────────────────────────────────── */

  addMessage: (role, content) =>
    set((s) => {
      const newSignals = { ...s.signals };
      if (role === 'student') {
        newSignals.messageCount = (newSignals.messageCount || 0) + 1;
        // Running average message length
        const prevTotal = (newSignals.avgMessageLength || 0) * ((newSignals.messageCount || 1) - 1);
        newSignals.avgMessageLength = Math.round((prevTotal + content.length) / newSignals.messageCount);
        // Short reply streak (< 15 chars → possible frustration)
        if (content.trim().length < 15) {
          newSignals.shortRepliesStreak = (newSignals.shortRepliesStreak || 0) + 1;
        } else {
          newSignals.shortRepliesStreak = 0;
        }
      }
      return {
        messages: [
          ...s.messages,
          { id: crypto.randomUUID(), role, content, timestamp: new Date().toISOString() },
        ],
        signals: newSignals,
      };
    }),

  startStreaming: () => set({ isStreaming: true, streamingContent: '' }),

  appendStreamChunk: (chunk) =>
    set((s) => ({ streamingContent: s.streamingContent + chunk })),

  finalizeStream: () =>
    set((s) => ({
      isStreaming: false,
      streamingContent: '',
      messages: [
        ...s.messages,
        {
          id: crypto.randomUUID(),
          role: 'tutor',
          content: s.streamingContent,
          timestamp: new Date().toISOString(),
        },
      ],
    })),

  /* ── Tag event handler ────────────────────────────────────── */

  handleTagEvent: ({ misconceptions = [], mastery = [], vizTriggers = [], problemSolved = false }) => {
    set((s) => {
      const updates = {};

      if (vizTriggers.length > 0) {
        updates.vizTriggers = [
          ...s.vizTriggers,
          ...vizTriggers.map((type) => ({ type, timestamp: new Date().toISOString() })),
        ];
      }

      if (mastery.length > 0) {
        updates.masteryEvents = [
          ...s.masteryEvents,
          ...mastery.map((e) => ({ ...e, timestamp: new Date().toISOString() })),
        ];
      }

      if (misconceptions.length > 0) {
        updates.misconceptions = [...s.misconceptions, ...misconceptions];
      }

      if (problemSolved && !s.problemSolved) {
        updates.problemSolved = true;
        // Move to 'solved' phase — Header will show "End Session" + solved banner
        updates.phase = 'solved';
      }

      return updates;
    });
  },

  clearVizTriggers: () => set({ vizTriggers: [] }),

  /* ── Hint actions ─────────────────────────────────────────── */

  escalateHint: (hintContent) =>
    set((s) => {
      const nextIndex = Math.min(s.hintLevelIndex + 1, HINT_LEVELS.length - 1);
      const level = HINT_LEVELS[nextIndex];
      const signals = { ...s.signals, hintsRequested: s.signals.hintsRequested + 1 };
      const struggleIntensity = Math.min(10, signals.hintsRequested * 2);
      return {
        hintLevelIndex: nextIndex,
        hintsUsed: [
          ...s.hintsUsed,
          { level, label: HINT_LABELS[level], content: hintContent, timestamp: new Date().toISOString() },
        ],
        signals: { ...signals, struggleIntensity },
        phase: nextIndex >= 2 ? 'stuck' : s.phase,
      };
    }),

  /* ── Session phase actions ────────────────────────────────── */

  setPhase: (phase) => set({ phase }),

  tickTimer: () => set((s) => ({ elapsedSeconds: s.elapsedSeconds + 1 })),

  /* ── Voice signal ─────────────────────────────────────────── */

  markVoiceReasoningGiven: () =>
    set((s) => ({ signals: { ...s.signals, voiceReasoningGiven: true } })),

  /* ── Reflection actions ───────────────────────────────────── */

  openReflection: () => set({ isReflectionOpen: true, phase: 'reflecting' }),

  closeReflection: () => set({ isReflectionOpen: false }),

  setReflectionData: (data) => set({ reflectionData: data }),

  completeSession: (data) =>
    set({ reflectionData: data, phase: 'complete', isReflectionOpen: false }),
}));

// ── Keep studentId in sync with auth state ────────────────────────
// When the user signs in (or out), update sessionStore.studentId
// so all subsequent DB writes use the real Supabase user UUID.
useAuthStore.subscribe((authState) => {
  const realId = authState.user?.id ?? null;
  const current = useSessionStore.getState().studentId;
  if (realId && realId !== current) {
    useSessionStore.setState({ studentId: realId });
  }
});

export { HINT_LEVELS, HINT_LABELS };
export default useSessionStore;

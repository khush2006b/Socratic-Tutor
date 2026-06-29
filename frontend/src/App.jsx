/**
 * App.jsx
 * Layout orchestrator — horizontal split panel, keyboard shortcuts,
 * panel collapse logic, and component assembly.
 *
 * Layout:
 *   ┌──────────────────────────────────────┐
 *   │  Header                              │
 *   ├─────────────────┬────────────────────┤
 *   │ Left panel      │ Right panel        │
 *   │  ProblemPanel   │  TutorChat         │
 *   │  ─────────────  │  HintLadder        │
 *   │  EditorPanel    │                    │
 *   ├─────────────────┴────────────────────┤
 *   │  BottomBar                           │
 *   └──────────────────────────────────────┘
 */

import { useState, useCallback, useEffect, useRef } from 'react';
import useSessionStore from './store/sessionStore';
import useAuthStore    from './store/authStore';

import Header          from './components/Header';
import ProblemPanel    from './components/ProblemPanel';
import EditorPanel     from './components/EditorPanel';
import TutorChat       from './components/TutorChat';
import HintLadder      from './components/HintLadder';
import BottomBar       from './components/BottomBar';
import ReflectionModal from './components/ReflectionModal';
import VoiceMode       from './components/VoiceMode';
import AuthPage        from './pages/AuthPage';
import NotesPage       from './pages/NotesPage';
import DashboardPage   from './pages/DashboardPage';

import styles from './App.module.css';

/* ── Drag-to-resize hook ──────────────────────────────────────── */

const SPLIT_MIN = 25; // %
const SPLIT_MAX = 70; // %
const SPLIT_DEFAULT = 42; // %

function usePanelSplit() {
  const [splitPct, setSplitPct] = useState(SPLIT_DEFAULT);
  const isDragging = useRef(false);
  const containerRef = useRef(null);

  const startDrag = useCallback((e) => {
    e.preventDefault();
    isDragging.current = true;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  }, []);

  useEffect(() => {
    const onMove = (e) => {
      if (!isDragging.current || !containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      const x = (e.clientX ?? e.touches?.[0]?.clientX) - rect.left;
      const pct = Math.round((x / rect.width) * 100);
      setSplitPct(Math.max(SPLIT_MIN, Math.min(SPLIT_MAX, pct)));
    };

    const stopDrag = () => {
      isDragging.current = false;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };

    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', stopDrag);
    window.addEventListener('touchmove', onMove);
    window.addEventListener('touchend', stopDrag);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', stopDrag);
      window.removeEventListener('touchmove', onMove);
      window.removeEventListener('touchend', stopDrag);
    };
  }, []);

  return { splitPct, containerRef, startDrag };
}

/* ── Problem panel split (vertical within left panel) ─────────── */

const LEFT_PROBLEM_DEFAULT = 35; // % of left panel height

function useVerticalSplit() {
  const [splitPct, setSplitPct] = useState(LEFT_PROBLEM_DEFAULT);
  const isDragging = useRef(false);
  const containerRef = useRef(null);

  const startDrag = useCallback((e) => {
    e.preventDefault();
    isDragging.current = true;
    document.body.style.cursor = 'row-resize';
    document.body.style.userSelect = 'none';
  }, []);

  useEffect(() => {
    const onMove = (e) => {
      if (!isDragging.current || !containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      const y = (e.clientY ?? e.touches?.[0]?.clientY) - rect.top;
      const pct = Math.round((y / rect.height) * 100);
      setSplitPct(Math.max(20, Math.min(60, pct)));
    };
    const stopDrag = () => {
      isDragging.current = false;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', stopDrag);
    window.addEventListener('touchmove', onMove, { passive: false });
    window.addEventListener('touchend', stopDrag);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', stopDrag);
      window.removeEventListener('touchmove', onMove);
      window.removeEventListener('touchend', stopDrag);
    };
  }, []);

  return { splitPct, containerRef, startDrag };
}

/* ── App ──────────────────────────────────────────────────────── */

export default function App() {
  const openReflection  = useSessionStore((s) => s.openReflection);
  const phase           = useSessionStore((s) => s.phase);

  const initAuth  = useAuthStore(s => s.init);
  const isLoading = useAuthStore(s => s.isLoading);
  const user      = useAuthStore(s => s.user);

  const [isProblemCollapsed, setIsProblemCollapsed] = useState(false);
  const [currentView, setCurrentView]               = useState('dashboard'); // 'dashboard' | 'tutor' | 'notes'
  const [isVoiceOpen, setIsVoiceOpen]               = useState(false);
  const hSplit = usePanelSplit();
  const vSplit = useVerticalSplit();

  /* Initialise Supabase auth once on mount */
  useEffect(() => { initAuth(); }, [initAuth]);

  /* Global keyboard shortcuts */
  useEffect(() => {
    const onKey = (e) => {
      if (e.ctrlKey && e.shiftKey && e.key === 'R' && (phase === 'solving' || phase === 'stuck')) {
        e.preventDefault();
        openReflection();
      }
      if (e.ctrlKey && e.shiftKey && e.key === 'P') {
        e.preventDefault();
        setIsProblemCollapsed((v) => !v);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [phase, openReflection]);

  const handleEndSession = useCallback(() => {
    if (phase === 'solving' || phase === 'stuck' || phase === 'solved') openReflection();
  }, [phase, openReflection]);

  const toggleVoiceMode = useCallback(() => {
    if (phase === 'idle' || phase === 'complete') return;
    setIsVoiceOpen(v => !v);
  }, [phase]);

  const toggleProblem = useCallback(() => {
    setIsProblemCollapsed((v) => !v);
  }, []);

  /* ── Auth gate ──────────────────────────────────────────────── */
  if (isLoading) {
    return (
      <div style={{
        minHeight: '100vh', display: 'flex', alignItems: 'center',
        justifyContent: 'center', background: '#09090f',
      }}>
        <span style={{ fontSize: '2rem', animation: 'spin 1s linear infinite' }}>⬡</span>
      </div>
    );
  }
  if (!user) return <AuthPage />;

  return (
    <div className={styles.appShell}>
      {/* ── Header ── */}
      <Header
        onEndSession={handleEndSession}
        currentView={currentView}
        onViewChange={setCurrentView}
        isVoiceOpen={isVoiceOpen}
        onToggleVoice={toggleVoiceMode}
      />

      {/* ── View Container with mount transition ── */}
      <div className={styles.viewWrapper} key={currentView}>
        {/* ── Dashboard page ── */}
        {currentView === 'dashboard' && (
          <DashboardPage onNavigateToTutor={() => setCurrentView('tutor')} />
        )}

        {/* ── Notes page ── */}
        {currentView === 'notes' && <NotesPage />}

        {/* ── Main tutoring workspace ── */}
        {currentView === 'tutor' && (
          <main
            className={styles.main}
            ref={hSplit.containerRef}
            aria-label="Main tutoring workspace"
          >
            {/* Left panel — problem + editor, vertically split */}
            <div
              className={styles.leftPanel}
              ref={vSplit.containerRef}
              style={{
                width: isProblemCollapsed ? '36px' : `${hSplit.splitPct}%`,
                minWidth: isProblemCollapsed ? '36px' : undefined,
              }}
            >
              {/* Problem panel — upper portion */}
              <div
                className={styles.problemSection}
                style={{ height: isProblemCollapsed ? '100%' : `${vSplit.splitPct}%` }}
              >
                <ProblemPanel
                  isCollapsed={isProblemCollapsed}
                  onToggleCollapse={toggleProblem}
                />
              </div>

              {/* Vertical drag handle */}
              {!isProblemCollapsed && (
                <div
                  className={styles.vDragHandle}
                  onMouseDown={vSplit.startDrag}
                  onTouchStart={vSplit.startDrag}
                  role="separator"
                  aria-orientation="horizontal"
                  aria-label="Resize problem/editor split"
                  tabIndex={0}
                />
              )}

              {/* Editor panel — lower portion */}
              {!isProblemCollapsed && (
                <div
                  className={styles.editorSection}
                  style={{ height: `${100 - vSplit.splitPct}%` }}
                >
                  <EditorPanel />
                </div>
              )}

              {/* Collapsed: show only editor */}
              {isProblemCollapsed && (
                <div className={styles.editorSection} style={{ height: '100%' }}>
                  <EditorPanel />
                </div>
              )}
            </div>

            {/* Horizontal drag handle */}
            {!isProblemCollapsed && (
              <div
                className={styles.hDragHandle}
                onMouseDown={hSplit.startDrag}
                onTouchStart={hSplit.startDrag}
                role="separator"
                aria-orientation="vertical"
                aria-label="Resize left/right panel split"
                tabIndex={0}
              />
            )}

            {/* Right panel — chat + hints */}
            <div
              className={styles.rightPanel}
              style={{ flex: 1, minWidth: 0 }}
            >
              {/* Chat takes most of the right panel */}
              <div className={styles.chatSection}>
                <TutorChat />
              </div>

              {/* Hint ladder — pinned below chat */}
              <HintLadder />
            </div>
          </main>
        )}
      </div>

      {/* ── Bottom bar (only in tutor view) ── */}
      {currentView === 'tutor' && <BottomBar onEndSession={handleEndSession} />}

      {/* ── Reflection modal ── */}
      <ReflectionModal />

      {/* ── Voice mode panel ── */}
      {isVoiceOpen && (
        <VoiceMode onClose={() => setIsVoiceOpen(false)} />
      )}
    </div>
  );
}

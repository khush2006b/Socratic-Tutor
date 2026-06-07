/**
 * EditorPanel.jsx
 * Monaco code editor with language selector, mock run button, output console.
 * Fires debounced snapshot every 2s to record code diff signals.
 */

import { useState, useRef, useCallback, useEffect } from 'react';
import Editor from '@monaco-editor/react';
import useSessionStore from '../store/sessionStore';
import styles from './EditorPanel.module.css';

/* ── Constants ────────────────────────────────────────────────── */

const LANGUAGES = [
  { value: 'python',     label: 'Python' },
  { value: 'javascript', label: 'JavaScript' },
  { value: 'java',       label: 'Java' },
  { value: 'cpp',        label: 'C++' },
];

const MONACO_OPTIONS = {
  fontSize: 14,
  fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
  fontLigatures: true,
  lineHeight: 22,
  minimap: { enabled: false },
  scrollBeyondLastLine: false,
  renderLineHighlight: 'line',
  cursorBlinking: 'smooth',
  cursorSmoothCaretAnimation: 'on',
  smoothScrolling: true,
  padding: { top: 16, bottom: 16 },
  tabSize: 4,
  wordWrap: 'on',
  overviewRulerLanes: 0,
  hideCursorInOverviewRuler: true,
  scrollbar: {
    verticalScrollbarSize: 5,
    horizontalScrollbarSize: 5,
  },
};

/** Custom dark theme definition — applied after Monaco mounts */
const SOCRATIC_THEME = {
  base: 'vs-dark',
  inherit: true,
  rules: [
    { token: 'comment',  foreground: '55596b', fontStyle: 'italic' },
    { token: 'keyword',  foreground: '8b7ff7' },
    { token: 'string',   foreground: '34d399' },
    { token: 'number',   foreground: 'fbbf24' },
    { token: 'type',     foreground: '60a5fa' },
  ],
  colors: {
    'editor.background':                  '#0d0f14',
    'editor.foreground':                  '#e8eaf0',
    'editor.lineHighlightBackground':     '#1a1e2a',
    'editor.selectionBackground':         '#6c63ff33',
    'editorLineNumber.foreground':        '#3a3f52',
    'editorLineNumber.activeForeground':  '#8b91a8',
    'editorCursor.foreground':            '#6c63ff',
    'editorIndentGuide.background1':      '#1e2333',
    'editorIndentGuide.activeBackground1':'#2a2f42',
    'editor.findMatchBackground':         '#6c63ff44',
    'editor.findMatchHighlightBackground':'#6c63ff22',
    'editorWidget.background':            '#13161e',
    'editorSuggestWidget.background':     '#13161e',
    'editorSuggestWidget.border':         '#2a2f42',
    'editorSuggestWidget.selectedBackground': '#1a1e2a',
  },
};

/** Stage 1 mock outputs */
const MOCK_PASS_OUTPUTS = [
  'All 3 test cases passed ✓\n\nRuntime: 68 ms  (beats 82%)\nMemory:  14.2 MB (beats 71%)',
  'Test 1: Passed ✓\nTest 2: Passed ✓\nTest 3: Passed ✓\n\nRuntime: 52 ms\nMemory:  13.8 MB',
];

/* ── Sub-component: Output console ────────────────────────────── */

function OutputConsole({ output, isRunning }) {
  if (!output && !isRunning) return null;

  return (
    <div className={styles.outputPanel} aria-live="polite" aria-label="Code output">
      <div className={styles.outputHeader}>
        <span className={styles.outputTitle}>Output</span>
        {isRunning && (
          <span className={styles.runDot} aria-hidden="true" />
        )}
      </div>
      <pre className={styles.outputContent}>
        {isRunning ? 'Running…' : output}
      </pre>
    </div>
  );
}

/* ── Main component ───────────────────────────────────────────── */

export default function EditorPanel() {
  const problem      = useSessionStore((s) => s.problem);
  const code         = useSessionStore((s) => s.code);
  const language     = useSessionStore((s) => s.language);
  const phase        = useSessionStore((s) => s.phase);
  const setCode      = useSessionStore((s) => s.setCode);
  const setLanguage  = useSessionStore((s) => s.setLanguage);
  const snapshotCode = useSessionStore((s) => s.snapshotCode);

  const [output, setOutput]     = useState('');
  const [isRunning, setIsRunning] = useState(false);

  const editorRef   = useRef(null);
  const debounceRef = useRef(null);

  /* Sync starter code when problem or language changes */
  useEffect(() => {
    if (problem?.starterCode?.[language]) {
      setCode(problem.starterCode[language]);
      setOutput('');
    }
  }, [problem?.id, language]); // eslint-disable-line react-hooks/exhaustive-deps

  /* Register custom theme once Monaco is ready */
  const handleEditorMount = useCallback((editor, monaco) => {
    editorRef.current = editor;
    monaco.editor.defineTheme('socratic-dark', SOCRATIC_THEME);
    monaco.editor.setTheme('socratic-dark');
  }, []);

  const handleCodeChange = useCallback((value = '') => {
    setCode(value);

    /* Debounced snapshot for diff tracking */
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(snapshotCode, 2000);
  }, [setCode, snapshotCode]);

  const handleLanguageChange = useCallback((e) => {
    setLanguage(e.target.value);
  }, [setLanguage]);

  const handleRun = useCallback(async () => {
    setIsRunning(true);
    setOutput('');

    /* Stage 1: simulate execution (no backend yet) */
    await new Promise((r) => setTimeout(r, 900));

    const hasCode = code.trim().length > 20;
    if (hasCode) {
      const out = MOCK_PASS_OUTPUTS[Math.floor(Math.random() * MOCK_PASS_OUTPUTS.length)];
      setOutput(out);
    } else {
      setOutput('Nothing to run — write your solution first.');
    }

    setIsRunning(false);
  }, [code]);

  const isDisabled = phase === 'idle' || phase === 'complete';

  return (
    <div className={styles.panel}>
      {/* Toolbar */}
      <div className={styles.toolbar}>
        <span className={styles.toolbarTitle}>Solution</span>
        <div className={styles.toolbarRight}>
          <select
            id="select-language"
            className={styles.langSelect}
            value={language}
            onChange={handleLanguageChange}
            aria-label="Programming language"
          >
            {LANGUAGES.map(({ value, label }) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>

          <button
            id="btn-run-code"
            className={styles.runButton}
            onClick={handleRun}
            disabled={isRunning || isDisabled}
            aria-label="Run code"
          >
            {isRunning ? (
              <>
                <span className={`${styles.btnSpinner} animate-spin`} aria-hidden="true" />
                Running…
              </>
            ) : (
              <>▶&nbsp; Run</>
            )}
          </button>
        </div>
      </div>

      {/* Monaco editor */}
      <div className={styles.editorWrap}>
        {isDisabled && (
          <div className={styles.overlay}>
            <p className={styles.overlayText}>
              {phase === 'idle'
                ? 'Load a problem to start coding'
                : 'Session complete'}
            </p>
          </div>
        )}

        <Editor
          height="100%"
          language={language}
          value={code}
          onChange={handleCodeChange}
          onMount={handleEditorMount}
          options={{ ...MONACO_OPTIONS, readOnly: isDisabled }}
          loading={<EditorSkeleton />}
        />
      </div>

      {/* Output console */}
      <OutputConsole output={output} isRunning={isRunning} />
    </div>
  );
}

function EditorSkeleton() {
  return (
    <div style={{ padding: '16px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
      {[60, 40, 75, 35, 55].map((w, i) => (
        <div
          key={i}
          className="skeleton"
          style={{ height: 14, width: `${w}%` }}
        />
      ))}
    </div>
  );
}

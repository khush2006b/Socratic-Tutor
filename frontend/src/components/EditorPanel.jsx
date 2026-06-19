/**
 * EditorPanel.jsx
 * Monaco code editor with language selector, real code execution, stdin input, output console.
 * Fires debounced snapshot every 2s to record code diff signals.
 */

import { useState, useRef, useCallback, useEffect } from 'react';
import Editor from '@monaco-editor/react';
import useSessionStore from '../store/sessionStore';
import { API_BASE_URL } from '../api/client.js';
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


/* ── Sub-component: Input/Output console ──────────────────────── */

function IOConsole({ output, stderr, exitCode, isRunning, stdin, onStdinChange, timedOut }) {
  const hasOutput = output || stderr || isRunning;

  return (
    <div className={styles.ioPanel}>
      {/* Stdin input */}
      <div className={styles.stdinSection}>
        <div className={styles.sectionHeader}>
          <span className={styles.sectionTitle}>Input (stdin)</span>
        </div>
        <textarea
          id="input-stdin"
          className={styles.stdinTextarea}
          placeholder="Enter input here (one value per line)…"
          value={stdin}
          onChange={(e) => onStdinChange(e.target.value)}
          rows={3}
          spellCheck={false}
          aria-label="Standard input for code execution"
        />
      </div>

      {/* Output */}
      {hasOutput && (
        <div className={styles.outputSection} aria-live="polite" aria-label="Code output">
          <div className={styles.sectionHeader}>
            <span className={styles.sectionTitle}>Output</span>
            {isRunning && <span className={styles.runDot} aria-hidden="true" />}
            {!isRunning && exitCode !== null && exitCode !== undefined && (
              <span className={`${styles.exitBadge} ${exitCode === 0 ? styles.exitSuccess : styles.exitError}`}>
                {exitCode === 0 ? '✓ exit 0' : `✗ exit ${exitCode}`}
              </span>
            )}
            {timedOut && (
              <span className={`${styles.exitBadge} ${styles.exitError}`}>⏱ timed out</span>
            )}
          </div>
          <pre className={styles.outputContent}>
            {isRunning ? 'Running…' : (
              <>
                {output && <span>{output}</span>}
                {stderr && <span className={styles.stderrText}>{output ? '\n' : ''}{stderr}</span>}
                {!output && !stderr && !isRunning && <span className={styles.emptyOutput}>No output</span>}
              </>
            )}
          </pre>
        </div>
      )}
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

  const [stdout, setStdout]       = useState('');
  const [stderr, setStderr]       = useState('');
  const [exitCode, setExitCode]   = useState(null);
  const [timedOut, setTimedOut]   = useState(false);
  const [isRunning, setIsRunning] = useState(false);
  const [stdin, setStdin]         = useState('');
  const [showIO, setShowIO]       = useState(false);

  const editorRef   = useRef(null);

  /* Sync starter code when problem or language changes */
  useEffect(() => {
    if (problem?.starterCode?.[language]) {
      setCode(problem.starterCode[language]);
      setStdout('');
      setStderr('');
      setExitCode(null);
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
  }, [setCode]);

  const handleLanguageChange = useCallback((e) => {
    setLanguage(e.target.value);
  }, [setLanguage]);

  const handleRun = useCallback(async () => {
    if (!code.trim()) {
      setStdout('');
      setStderr('Write some code first.');
      setExitCode(1);
      setShowIO(true);
      return;
    }

    setIsRunning(true);
    setStdout('');
    setStderr('');
    setExitCode(null);
    setTimedOut(false);
    setShowIO(true);

    try {
      const resp = await fetch(`${API_BASE_URL}/api/execute`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          code,
          language,
          stdin,
        }),
      });

      if (!resp.ok) {
        const errText = await resp.text().catch(() => 'Unknown error');
        setStderr(`Execution service error: ${resp.status}\n${errText}`);
        setExitCode(1);
      } else {
        const data = await resp.json();
        setStdout(data.stdout || '');
        setStderr(data.stderr || '');
        setExitCode(data.exit_code ?? 0);
        setTimedOut(data.timed_out || false);
      }
    } catch (err) {
      setStderr(`Network error: ${err.message}`);
      setExitCode(1);
    } finally {
      setIsRunning(false);
    }
  }, [code, language, stdin]);

  /* Ctrl+Enter shortcut to run */
  const handleEditorKeyDown = useCallback((e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault();
      handleRun();
    }
  }, [handleRun]);

  const isDisabled = phase === 'idle' || phase === 'complete';

  return (
    <div className={styles.panel} onKeyDown={handleEditorKeyDown}>
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
            id="btn-toggle-io"
            className={`${styles.ioToggle} ${showIO ? styles.ioToggleActive : ''}`}
            onClick={() => setShowIO(!showIO)}
            aria-label={showIO ? 'Hide I/O panel' : 'Show I/O panel'}
            title="Toggle Input/Output"
          >
            ⌨
          </button>

          <button
            id="btn-run-code"
            className={styles.runButton}
            onClick={handleRun}
            disabled={isRunning || isDisabled}
            aria-label="Run code (Ctrl+Enter)"
            title="Run code (Ctrl+Enter)"
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

      {/* I/O Console */}
      {showIO && (
        <IOConsole
          output={stdout}
          stderr={stderr}
          exitCode={exitCode}
          isRunning={isRunning}
          stdin={stdin}
          onStdinChange={setStdin}
          timedOut={timedOut}
        />
      )}
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

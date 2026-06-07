/**
 * ProblemPanel.jsx
 * Problem input — 3 modes:
 *   1. 🔢 LeetCode number / URL  (live fetch from LeetCode GraphQL)
 *   2. 📝 Paste text             (Gemini parses any format)
 *   3. 🖼️ Upload image           (Gemini vision reads the screenshot)
 */

import { useState, useCallback, useRef } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import useSessionStore from '../store/sessionStore';
import { apiFetch } from '../api/client.js';
import styles from './ProblemPanel.module.css';

const TAG_COLORS = {
  'Array':               '#60a5fa',
  'Hash Table':          '#a78bfa',
  'Hash Map':            '#a78bfa',
  'Sliding Window':      '#34d399',
  'String':              '#fbbf24',
  'Dynamic Programming': '#f472b6',
  'Graph':               '#fb923c',
  'Tree':                '#4ade80',
  'Binary Tree':         '#4ade80',
  'Binary Search':       '#22d3ee',
  'Two Pointers':        '#e879f9',
  'Stack':               '#f97316',
  'Heap':                '#f43f5e',
  'BFS':                 '#38bdf8',
  'DFS / Backtrack':     '#818cf8',
  'Greedy':              '#facc15',
  'Linked List':         '#a3e635',
  'Trie':                '#fb7185',
  'Math':                '#94a3b8',
};
function getTagColor(tag) { return TAG_COLORS[tag] ?? 'var(--color-text-secondary)'; }

const MODES = [
  { id: 'number', icon: '#', label: 'LeetCode No.' },
  { id: 'text',   icon: '✏', label: 'Paste Text'   },
  { id: 'image',  icon: '⬡', label: 'Upload Image' },
];

/* ── API helpers ─────────────────────────────────────────────────── */

async function postProblemAPI(path, body) {
  const res = await apiFetch(path, {
    method: 'POST',
    body: JSON.stringify(body),
  });
  return res.json();
}

/* ── Main component ──────────────────────────────────────────────── */

export default function ProblemPanel({ isCollapsed, onToggleCollapse }) {
  const problem           = useSessionStore(s => s.problem);
  const isLoadingProblem  = useSessionStore(s => s.isLoadingProblem);
  const setProblem        = useSessionStore(s => s.setProblem);
  const setLoadingProblem = useSessionStore(s => s.setLoadingProblem);


  const [mode,         setMode]         = useState('number');
  const [numberInput,  setNumberInput]  = useState('');
  const [textInput,    setTextInput]    = useState('');
  const [imageFile,    setImageFile]    = useState(null);   // { name, base64, mime }
  const [imagePreview, setImagePreview] = useState(null);
  const [error,        setError]        = useState('');
  const [activeExample,setActiveExample]= useState(0);

  const fileInputRef = useRef(null);

  /* ── Submit handler ─────────────────────────────────────────── */
  const handleSubmit = useCallback(async (e) => {
    e.preventDefault();
    setError('');
    setLoadingProblem(true);

    try {
      let result;

      if (mode === 'number') {
        const raw = numberInput.trim();
        // Number
        if (/^\d+$/.test(raw)) {
          result = await postProblemAPI('/api/problems/from-number', { number: parseInt(raw, 10) });
        }
        // URL
        else if (raw.includes('leetcode.com')) {
          result = await postProblemAPI('/api/problems/parse', { input: raw });
        }
        else {
          throw new Error('Enter a LeetCode problem number (e.g. 42) or URL.');
        }
      }

      else if (mode === 'text') {
        if (!textInput.trim() || textInput.trim().length < 20) {
          throw new Error('Paste the full problem statement (at least 20 characters).');
        }
        result = await postProblemAPI('/api/problems/from-text', { text: textInput.trim() });
      }

      else if (mode === 'image') {
        if (!imageFile) throw new Error('Please select an image first.');
        result = await postProblemAPI('/api/problems/from-image', {
          image: imageFile.base64,
          mime:  imageFile.mime,
        });
      }

      setProblem(result);
      setNumberInput('');
      setTextInput('');
      setImageFile(null);
      setImagePreview(null);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoadingProblem(false);
    }
  }, [mode, numberInput, textInput, imageFile, setProblem, setLoadingProblem]);


  /* ── Image file select ──────────────────────────────────────── */
  const handleImageSelect = useCallback((e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const mime = file.type || 'image/png';
    const reader = new FileReader();
    reader.onload = (ev) => {
      const dataUrl = ev.target.result;
      // Strip "data:image/...;base64," prefix
      const base64 = dataUrl.split(',')[1];
      setImageFile({ name: file.name, base64, mime });
      setImagePreview(dataUrl);
      setError('');
    };
    reader.readAsDataURL(file);
  }, []);

  /* ── Drag and drop ──────────────────────────────────────────── */
  const handleDrop = useCallback((e) => {
    e.preventDefault();
    const file = e.dataTransfer.files?.[0];
    if (!file) return;
    const syntheticEvt = { target: { files: [file] } };
    handleImageSelect(syntheticEvt);
  }, [handleImageSelect]);

  const isSubmitDisabled = isLoadingProblem ||
    (mode === 'number' && !numberInput.trim()) ||
    (mode === 'text'   && !textInput.trim())   ||
    (mode === 'image'  && !imageFile);

  return (
    <div className={styles.panel} data-collapsed={isCollapsed}>
      {/* Panel header */}
      <div className={styles.panelHeader}>
        <span className={styles.panelTitle}>Problem</span>
        <button
          id="btn-toggle-problem"
          className={styles.collapseBtn}
          onClick={onToggleCollapse}
          aria-label={isCollapsed ? 'Expand problem panel' : 'Collapse problem panel'}
          title={isCollapsed ? 'Expand' : 'Collapse'}
        >
          {isCollapsed ? '▶' : '◀'}
        </button>
      </div>

      {!isCollapsed && (
        <div className={styles.content}>

          {/* ── Input form (shown when no problem loaded) ── */}
          {!problem && (
            <div className={styles.inputSection}>
              {/* Mode tabs */}
              <div className={styles.modeTabs} role="tablist">
                {MODES.map(m => (
                  <button
                    key={m.id}
                    id={`tab-mode-${m.id}`}
                    role="tab"
                    aria-selected={mode === m.id}
                    className={`${styles.modeTab} ${mode === m.id ? styles.modeTabActive : ''}`}
                    onClick={() => { setMode(m.id); setError(''); }}
                  >
                    <span className={styles.modeIcon}>{m.icon}</span>
                    <span className={styles.modeLabel}>{m.label}</span>
                  </button>
                ))}
              </div>

              {/* Form */}
              <form
                id="form-load-problem"
                className={styles.inputForm}
                onSubmit={handleSubmit}
              >
                {/* ── Mode: Number ── */}
                {mode === 'number' && (
                  <div className={styles.numberMode}>
                    <label htmlFor="input-lc-number" className={styles.inputLabel}>
                      LeetCode problem number or URL
                    </label>
                    <div className={styles.inputRow}>
                      <input
                        id="input-lc-number"
                        type="text"
                        className={styles.input}
                        placeholder="e.g. 42, 567, 739 or paste a LeetCode URL"
                        value={numberInput}
                        onChange={e => setNumberInput(e.target.value)}
                        disabled={isLoadingProblem}
                        autoFocus
                      />
                    </div>
                    <div className={styles.quickLinks}>
                      <span className={styles.quickLinksLabel}>Popular:</span>
                      {[
                        { n: 1,   l: 'Two Sum' },
                        { n: 3,   l: 'Longest Substring' },
                        { n: 11,  l: 'Container with Water' },
                        { n: 42,  l: 'Trapping Rain Water' },
                        { n: 121, l: 'Best Time to Buy' },
                        { n: 200, l: 'Number of Islands' },
                        { n: 206, l: 'Reverse Linked List' },
                        { n: 300, l: 'Longest Increasing Subsequence' },
                      ].map(({ n, l }) => (
                        <button
                          key={n}
                          type="button"
                          className={styles.quickLink}
                          onClick={() => setNumberInput(String(n))}
                          title={l}
                        >
                          #{n}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {/* ── Mode: Text ── */}
                {mode === 'text' && (
                  <div className={styles.textMode}>
                    <label htmlFor="input-problem-text" className={styles.inputLabel}>
                      Paste the problem statement
                    </label>
                    <textarea
                      id="input-problem-text"
                      className={styles.textarea}
                      placeholder={"Paste any DSA problem here — LeetCode, HackerRank, Codeforces, or your own.\n\nGemini will read it and structure it automatically."}
                      value={textInput}
                      onChange={e => setTextInput(e.target.value)}
                      disabled={isLoadingProblem}
                      rows={9}
                      spellCheck={false}
                    />
                  </div>
                )}

                {/* ── Mode: Image ── */}
                {mode === 'image' && (
                  <div className={styles.imageMode}>
                    <div
                      id="drop-zone"
                      className={`${styles.dropZone} ${imagePreview ? styles.dropZoneHasImage : ''}`}
                      onDragOver={e => e.preventDefault()}
                      onDrop={handleDrop}
                      onClick={() => fileInputRef.current?.click()}
                      role="button"
                      aria-label="Upload problem screenshot"
                      tabIndex={0}
                      onKeyDown={e => e.key === 'Enter' && fileInputRef.current?.click()}
                    >
                      {imagePreview ? (
                        <div className={styles.imagePreviewWrapper}>
                          <img
                            src={imagePreview}
                            alt="Problem screenshot preview"
                            className={styles.imagePreview}
                          />
                          <div className={styles.imageOverlay}>
                            <span>Click to change</span>
                          </div>
                        </div>
                      ) : (
                        <div className={styles.dropZonePlaceholder}>
                          <span className={styles.dropZoneIcon}>📸</span>
                          <p className={styles.dropZoneText}>
                            Drop a screenshot here
                          </p>
                          <p className={styles.dropZoneSubtext}>
                            or click to browse · PNG, JPG, WEBP
                          </p>
                        </div>
                      )}
                    </div>
                    <input
                      ref={fileInputRef}
                      id="input-image-file"
                      type="file"
                      accept="image/*"
                      className={styles.hiddenFile}
                      onChange={handleImageSelect}
                    />
                    {imageFile && (
                      <p className={styles.fileName}>
                        📎 {imageFile.name}
                      </p>
                    )}
                  </div>
                )}

                {/* Error */}
                {error && (
                  <p className={styles.error} role="alert">{error}</p>
                )}

                {/* Submit */}
                <button
                  id="btn-load-problem"
                  type="submit"
                  className={styles.loadButton}
                  disabled={isSubmitDisabled}
                >
                  {isLoadingProblem ? (
                    <><span className={styles.spinner} />
                    {mode === 'number' ? 'Fetching from LeetCode…' :
                     mode === 'text'   ? 'Parsing with Gemini…' :
                                        'Reading image…'}</>
                  ) : (
                    mode === 'number' ? '→ Load Problem' :
                    mode === 'text'   ? '→ Parse Problem' :
                                       '→ Read Image'
                  )}
                </button>
              </form>
            </div>
          )}

          {/* ── Problem display ── */}
          {problem && (
            <div className={`${styles.problemDisplay} animate-fade-in`}>
              {/* Tags */}
              <div className={styles.tags} aria-label="Problem tags">
                {problem.tags.map(tag => (
                  <span
                    key={tag}
                    className={styles.tag}
                    style={{ color: getTagColor(tag), borderColor: getTagColor(tag) + '40' }}
                  >
                    {tag}
                  </span>
                ))}
              </div>

              {/* Statement */}
              <div className={`${styles.statement} prose`}>
                <ReactMarkdown remarkPlugins={[remarkGfm]}>
                  {problem.statement}
                </ReactMarkdown>
              </div>

              {/* Examples */}
              {problem.examples?.length > 0 && (
                <div className={styles.examples}>
                  <div className={styles.exampleTabs} role="tablist">
                    {problem.examples.map((_, i) => (
                      <button
                        key={i}
                        role="tab"
                        aria-selected={activeExample === i}
                        className={styles.exampleTab}
                        data-active={activeExample === i}
                        onClick={() => setActiveExample(i)}
                        id={`tab-example-${i}`}
                      >
                        Example {i + 1}
                      </button>
                    ))}
                  </div>
                  <div className={styles.exampleBody} role="tabpanel" aria-labelledby={`tab-example-${activeExample}`}>
                    <ExampleCard example={problem.examples[activeExample]} />
                  </div>
                </div>
              )}

              {/* Constraints */}
              {problem.constraints?.length > 0 && (
                <div className={styles.constraints}>
                  <p className={styles.constraintsTitle}>Constraints</p>
                  <ul className={styles.constraintsList}>
                    {problem.constraints.map((c, i) => (
                      <li key={i} className={styles.constraintItem}>{c}</li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Change problem */}
              <button
                id="btn-change-problem"
                className={styles.changeButton}
                onClick={() => {
                  useSessionStore.getState().clearProblem();
                  setError('');
                  setActiveExample(0);
                }}
              >
                ← Change problem
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function ExampleCard({ example }) {
  return (
    <div className={styles.exampleCard}>
      <div className={styles.exampleRow}>
        <span className={styles.exampleKey}>Input:</span>
        <code className={styles.exampleValue}>{example.input}</code>
      </div>
      <div className={styles.exampleRow}>
        <span className={styles.exampleKey}>Output:</span>
        <code className={styles.exampleValue}>{example.output}</code>
      </div>
      {example.explanation && (
        <div className={styles.exampleExplanation}>
          <span className={styles.exampleKey}>Explanation:</span>
          <span className={styles.exampleText}>{example.explanation}</span>
        </div>
      )}
    </div>
  );
}

/**
 * VisualizationPanel.jsx
 * Animated DSA pattern visualizations triggered by [TRIGGER_VISUALIZATION] tags.
 *
 * Renders inline in the tutor chat when Gemini emits a visualization tag.
 * Each visualization is a self-contained animated canvas using requestAnimationFrame.
 *
 * Supported types:
 *   - sliding_window: two-pointer window moving across an array
 *   - two_pointers:   left/right pointers converging
 *   - bfs:            level-order graph traversal
 *   - dfs:            depth-first graph traversal with backtracking
 *   - stack:          push/pop stack operations
 *   - recursion:      recursion tree branching
 */

import { useEffect, useRef, useState, useCallback } from 'react';
import useSessionStore from '../store/sessionStore';
import styles from './VisualizationPanel.module.css';

/* ── Color palette ──────────────────────────────────────────────── */
const COLORS = {
  bg:         '#05060b',
  grid:       '#161a2e',
  cell:       '#1f243d',
  cellActive: '#8b5cf6',
  cellVisited:'#06b6d4',
  cellCurrent:'#f59e0b',
  pointer:    '#f43f5e',
  pointerR:   '#10b981',
  text:       '#f3f4f6',
  textDim:    '#6b7280',
  window:     'rgba(139, 92, 246, 0.16)',
  windowBorder:'#8b5cf6',
  edge:       '#2b314d',
  edgeActive: '#8b5cf6',
};

const CELL_SIZE = 44;
const CELL_GAP = 4;
const ANIM_SPEED = 800; // ms per step

/* ── Array drawing helpers ──────────────────────────────────────── */

function drawArray(ctx, arr, opts = {}) {
  const { highlight = [], window: win, pointers = {}, y = 40, labels = {} } = opts;
  const totalW = arr.length * (CELL_SIZE + CELL_GAP) - CELL_GAP;
  const startX = (ctx.canvas.width - totalW) / 2;

  // Window background
  if (win && win.left <= win.right) {
    const wx = startX + win.left * (CELL_SIZE + CELL_GAP) - 3;
    const ww = (win.right - win.left + 1) * (CELL_SIZE + CELL_GAP) - CELL_GAP + 6;
    ctx.fillStyle = COLORS.window;
    ctx.strokeStyle = COLORS.windowBorder;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.roundRect(wx, y - 3, ww, CELL_SIZE + 6, 6);
    ctx.fill();
    ctx.stroke();
  }

  // Cells
  arr.forEach((val, i) => {
    const x = startX + i * (CELL_SIZE + CELL_GAP);
    const isHighlight = highlight.includes(i);

    ctx.fillStyle = isHighlight ? COLORS.cellActive : COLORS.cell;
    ctx.beginPath();
    ctx.roundRect(x, y, CELL_SIZE, CELL_SIZE, 6);
    ctx.fill();

    ctx.fillStyle = isHighlight ? '#fff' : COLORS.text;
    ctx.font = 'bold 16px Inter, system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(val), x + CELL_SIZE / 2, y + CELL_SIZE / 2);

    // Index labels
    ctx.fillStyle = COLORS.textDim;
    ctx.font = '11px Inter, system-ui, sans-serif';
    ctx.fillText(String(i), x + CELL_SIZE / 2, y + CELL_SIZE + 14);
  });

  // Pointers
  Object.entries(pointers).forEach(([label, idx]) => {
    if (idx < 0 || idx >= arr.length) return;
    const x = startX + idx * (CELL_SIZE + CELL_GAP) + CELL_SIZE / 2;
    const py = y - 16;
    const color = label === 'R' || label === 'right' ? COLORS.pointerR : COLORS.pointer;

    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(x, py + 10);
    ctx.lineTo(x - 6, py);
    ctx.lineTo(x + 6, py);
    ctx.closePath();
    ctx.fill();

    ctx.font = 'bold 12px Inter, system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(label, x, py - 6);
  });

  // Labels
  Object.entries(labels).forEach(([key, { x: lx, text, color }]) => {
    ctx.fillStyle = color || COLORS.text;
    ctx.font = '13px Inter, system-ui, sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText(text, lx, y + CELL_SIZE + 34);
  });
}

/* ── Sliding Window Animation ───────────────────────────────────── */

function SlidingWindowViz() {
  const canvasRef = useRef(null);
  const [step, setStep] = useState(0);
  const [isPlaying, setIsPlaying] = useState(true);
  const arr = [2, 1, 5, 1, 3, 2];
  const k = 3;
  const maxStep = arr.length - k;

  useEffect(() => {
    if (!isPlaying) return;
    const timer = setInterval(() => {
      setStep(s => {
        if (s >= maxStep) { setIsPlaying(false); return maxStep; }
        return s + 1;
      });
    }, ANIM_SPEED);
    return () => clearInterval(timer);
  }, [isPlaying, maxStep]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const windowHighlight = [];
    for (let i = step; i < step + k; i++) windowHighlight.push(i);
    const sum = windowHighlight.reduce((a, i) => a + arr[i], 0);

    drawArray(ctx, arr, {
      highlight: windowHighlight,
      window: { left: step, right: step + k - 1 },
      y: 50,
    });

    // Window sum label
    ctx.fillStyle = COLORS.cellActive;
    ctx.font = 'bold 14px Inter, system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(`Window sum = ${sum}`, canvas.width / 2, 130);

    // Step label
    ctx.fillStyle = COLORS.textDim;
    ctx.font = '12px Inter, system-ui, sans-serif';
    ctx.fillText(`Step ${step + 1} / ${maxStep + 1}`, canvas.width / 2, 150);
  }, [step]);

  return (
    <div className={styles.vizContainer}>
      <div className={styles.vizHeader}>
        <span className={styles.vizIcon}>◧</span>
        <span className={styles.vizTitle}>Sliding Window (k={k})</span>
        <div className={styles.controls}>
          <button className={styles.controlBtn} onClick={() => { setStep(0); setIsPlaying(true); }} title="Restart">↺</button>
          <button className={styles.controlBtn} onClick={() => setIsPlaying(!isPlaying)}>
            {isPlaying ? '⏸' : '▶'}
          </button>
        </div>
      </div>
      <canvas ref={canvasRef} width={360} height={160} className={styles.canvas} />
    </div>
  );
}

/* ── Two Pointers Animation ─────────────────────────────────────── */

function TwoPointersViz() {
  const canvasRef = useRef(null);
  const [step, setStep] = useState(0);
  const [isPlaying, setIsPlaying] = useState(true);
  const arr = [1, 3, 5, 7, 9, 11];
  const target = 12;

  // Precompute steps: converging pointers for target sum
  const steps = [];
  let l = 0, r = arr.length - 1;
  while (l < r) {
    steps.push({ l, r, sum: arr[l] + arr[r] });
    if (arr[l] + arr[r] < target) l++;
    else if (arr[l] + arr[r] > target) r--;
    else break;
  }
  steps.push({ l, r, sum: arr[l] + arr[r] }); // final
  const maxStep = steps.length - 1;

  useEffect(() => {
    if (!isPlaying) return;
    const timer = setInterval(() => {
      setStep(s => {
        if (s >= maxStep) { setIsPlaying(false); return maxStep; }
        return s + 1;
      });
    }, ANIM_SPEED);
    return () => clearInterval(timer);
  }, [isPlaying, maxStep]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const s = steps[Math.min(step, maxStep)];
    const found = s.sum === target;

    drawArray(ctx, arr, {
      highlight: [s.l, s.r],
      pointers: { L: s.l, R: s.r },
      y: 50,
    });

    ctx.fillStyle = found ? '#51cf66' : COLORS.text;
    ctx.font = 'bold 14px Inter, system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(
      found ? `✓ Found! ${arr[s.l]} + ${arr[s.r]} = ${target}` : `${arr[s.l]} + ${arr[s.r]} = ${s.sum} (target: ${target})`,
      canvas.width / 2, 130
    );

    ctx.fillStyle = COLORS.textDim;
    ctx.font = '12px Inter, system-ui, sans-serif';
    ctx.fillText(
      s.sum < target ? '→ Move L right (need larger sum)' : s.sum > target ? '← Move R left (need smaller sum)' : 'Found the pair!',
      canvas.width / 2, 150
    );
  }, [step]);

  return (
    <div className={styles.vizContainer}>
      <div className={styles.vizHeader}>
        <span className={styles.vizIcon}>⇿</span>
        <span className={styles.vizTitle}>Two Pointers (target={target})</span>
        <div className={styles.controls}>
          <button className={styles.controlBtn} onClick={() => { setStep(0); setIsPlaying(true); }} title="Restart">↺</button>
          <button className={styles.controlBtn} onClick={() => setIsPlaying(!isPlaying)}>
            {isPlaying ? '⏸' : '▶'}
          </button>
        </div>
      </div>
      <canvas ref={canvasRef} width={360} height={160} className={styles.canvas} />
    </div>
  );
}

/* ── BFS / DFS Graph Visualization ──────────────────────────────── */

const GRAPH_NODES = [
  { id: 0, x: 160, y: 20, label: 'A' },
  { id: 1, x: 80,  y: 70, label: 'B' },
  { id: 2, x: 240, y: 70, label: 'C' },
  { id: 3, x: 40,  y: 130, label: 'D' },
  { id: 4, x: 120, y: 130, label: 'E' },
  { id: 5, x: 200, y: 130, label: 'F' },
  { id: 6, x: 280, y: 130, label: 'G' },
];
const GRAPH_EDGES = [[0,1],[0,2],[1,3],[1,4],[2,5],[2,6]];

function computeTraversal(type) {
  // BFS: level-order, DFS: pre-order
  const adj = {};
  GRAPH_NODES.forEach(n => adj[n.id] = []);
  GRAPH_EDGES.forEach(([a, b]) => { adj[a].push(b); adj[b].push(a); });

  const visited = [];
  const edgesUsed = [];

  if (type === 'bfs') {
    const queue = [0];
    const seen = new Set([0]);
    while (queue.length) {
      const node = queue.shift();
      visited.push(node);
      for (const nb of adj[node]) {
        if (!seen.has(nb)) {
          seen.add(nb);
          queue.push(nb);
          edgesUsed.push([node, nb]);
        }
      }
    }
  } else {
    // DFS
    const seen = new Set();
    function dfs(node) {
      seen.add(node);
      visited.push(node);
      for (const nb of adj[node]) {
        if (!seen.has(nb)) {
          edgesUsed.push([node, nb]);
          dfs(nb);
        }
      }
    }
    dfs(0);
  }
  return { visited, edgesUsed };
}

function GraphViz({ type = 'bfs' }) {
  const canvasRef = useRef(null);
  const [step, setStep] = useState(0);
  const [isPlaying, setIsPlaying] = useState(true);
  const { visited, edgesUsed } = computeTraversal(type);
  const maxStep = visited.length - 1;

  useEffect(() => {
    if (!isPlaying) return;
    const timer = setInterval(() => {
      setStep(s => {
        if (s >= maxStep) { setIsPlaying(false); return maxStep; }
        return s + 1;
      });
    }, ANIM_SPEED);
    return () => clearInterval(timer);
  }, [isPlaying, maxStep]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const visitedSoFar = new Set(visited.slice(0, step + 1));
    const activeEdges = edgesUsed.slice(0, step);
    const currentNode = visited[step];

    // Draw edges
    GRAPH_EDGES.forEach(([a, b]) => {
      const na = GRAPH_NODES[a], nb = GRAPH_NODES[b];
      const isActive = activeEdges.some(([ea, eb]) => (ea === a && eb === b) || (ea === b && eb === a));
      ctx.strokeStyle = isActive ? COLORS.edgeActive : COLORS.edge;
      ctx.lineWidth = isActive ? 2.5 : 1.5;
      ctx.beginPath();
      ctx.moveTo(na.x + 20, na.y + 20);
      ctx.lineTo(nb.x + 20, nb.y + 20);
      ctx.stroke();
    });

    // Draw nodes
    GRAPH_NODES.forEach(n => {
      const isVisited = visitedSoFar.has(n.id);
      const isCurrent = n.id === currentNode;

      ctx.fillStyle = isCurrent ? COLORS.cellCurrent : isVisited ? COLORS.cellActive : COLORS.cell;
      ctx.beginPath();
      ctx.arc(n.x + 20, n.y + 20, 18, 0, Math.PI * 2);
      ctx.fill();

      if (isCurrent) {
        ctx.strokeStyle = COLORS.cellCurrent;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(n.x + 20, n.y + 20, 21, 0, Math.PI * 2);
        ctx.stroke();
      }

      ctx.fillStyle = isVisited ? '#fff' : COLORS.text;
      ctx.font = 'bold 14px Inter, system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(n.label, n.x + 20, n.y + 20);
    });

    // Order label
    const orderStr = visited.slice(0, step + 1).map(i => GRAPH_NODES[i].label).join(' → ');
    ctx.fillStyle = COLORS.text;
    ctx.font = '13px Inter, system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(`Order: ${orderStr}`, canvas.width / 2, 172);
  }, [step]);

  const label = type === 'bfs' ? 'Breadth-First Search' : 'Depth-First Search';
  const icon = type === 'bfs' ? '◉' : '⊙';

  return (
    <div className={styles.vizContainer}>
      <div className={styles.vizHeader}>
        <span className={styles.vizIcon}>{icon}</span>
        <span className={styles.vizTitle}>{label}</span>
        <div className={styles.controls}>
          <button className={styles.controlBtn} onClick={() => { setStep(0); setIsPlaying(true); }}>↺</button>
          <button className={styles.controlBtn} onClick={() => setIsPlaying(!isPlaying)}>
            {isPlaying ? '⏸' : '▶'}
          </button>
        </div>
      </div>
      <canvas ref={canvasRef} width={320} height={190} className={styles.canvas} />
    </div>
  );
}

/* ── Stack Visualization ────────────────────────────────────────── */

function StackViz() {
  const canvasRef = useRef(null);
  const [step, setStep] = useState(0);
  const [isPlaying, setIsPlaying] = useState(true);

  // Simulate stack operations: push/pop sequence
  const ops = [
    { op: 'push', val: 3 },
    { op: 'push', val: 7 },
    { op: 'push', val: 1 },
    { op: 'pop' },
    { op: 'push', val: 5 },
    { op: 'pop' },
    { op: 'pop' },
  ];
  const maxStep = ops.length;

  useEffect(() => {
    if (!isPlaying) return;
    const timer = setInterval(() => {
      setStep(s => {
        if (s >= maxStep) { setIsPlaying(false); return maxStep; }
        return s + 1;
      });
    }, ANIM_SPEED);
    return () => clearInterval(timer);
  }, [isPlaying, maxStep]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Replay ops up to current step
    const stack = [];
    let lastOp = '';
    for (let i = 0; i < step; i++) {
      const o = ops[i];
      if (o.op === 'push') { stack.push(o.val); lastOp = `push(${o.val})`; }
      else { const v = stack.pop(); lastOp = `pop() → ${v}`; }
    }

    const cellH = 32;
    const cellW = 60;
    const baseX = canvas.width / 2 - cellW / 2;
    const baseY = 140;

    // Stack frame
    ctx.strokeStyle = COLORS.edge;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(baseX - 4, baseY + 4);
    ctx.lineTo(baseX - 4, baseY - 5 * (cellH + 2));
    ctx.moveTo(baseX + cellW + 4, baseY + 4);
    ctx.lineTo(baseX + cellW + 4, baseY - 5 * (cellH + 2));
    ctx.moveTo(baseX - 4, baseY + 4);
    ctx.lineTo(baseX + cellW + 4, baseY + 4);
    ctx.stroke();

    // Stack cells
    stack.forEach((val, i) => {
      const y = baseY - (i + 1) * (cellH + 2);
      const isTop = i === stack.length - 1;

      ctx.fillStyle = isTop ? COLORS.cellActive : COLORS.cell;
      ctx.beginPath();
      ctx.roundRect(baseX, y, cellW, cellH, 4);
      ctx.fill();

      ctx.fillStyle = isTop ? '#fff' : COLORS.text;
      ctx.font = 'bold 15px Inter, system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(String(val), baseX + cellW / 2, y + cellH / 2);

      if (isTop) {
        ctx.fillStyle = COLORS.pointer;
        ctx.font = '12px Inter, system-ui, sans-serif';
        ctx.textAlign = 'left';
        ctx.fillText('← top', baseX + cellW + 10, y + cellH / 2);
      }
    });

    // Operation label
    if (lastOp) {
      ctx.fillStyle = COLORS.cellActive;
      ctx.font = 'bold 13px Inter, system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(lastOp, canvas.width / 2, 168);
    }

    // Step counter
    ctx.fillStyle = COLORS.textDim;
    ctx.font = '11px Inter, system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(`Step ${step} / ${maxStep}`, canvas.width / 2, 185);
  }, [step]);

  return (
    <div className={styles.vizContainer}>
      <div className={styles.vizHeader}>
        <span className={styles.vizIcon}>⊞</span>
        <span className={styles.vizTitle}>Stack Operations</span>
        <div className={styles.controls}>
          <button className={styles.controlBtn} onClick={() => { setStep(0); setIsPlaying(true); }}>↺</button>
          <button className={styles.controlBtn} onClick={() => setIsPlaying(!isPlaying)}>
            {isPlaying ? '⏸' : '▶'}
          </button>
        </div>
      </div>
      <canvas ref={canvasRef} width={240} height={195} className={styles.canvas} />
    </div>
  );
}

/* ── Recursion Tree Visualization ───────────────────────────────── */

function RecursionViz() {
  const canvasRef = useRef(null);
  const [step, setStep] = useState(0);
  const [isPlaying, setIsPlaying] = useState(true);

  // fib(4) recursion tree nodes in pre-order
  const nodes = [
    { id: 0, x: 160, y: 10, label: 'f(4)' },
    { id: 1, x: 80,  y: 55, label: 'f(3)' },
    { id: 2, x: 40,  y: 100, label: 'f(2)' },
    { id: 3, x: 20,  y: 140, label: 'f(1)=1' },
    { id: 4, x: 60,  y: 140, label: 'f(0)=0' },
    { id: 5, x: 120, y: 100, label: 'f(1)=1' },
    { id: 6, x: 240, y: 55, label: 'f(2)' },
    { id: 7, x: 220, y: 100, label: 'f(1)=1' },
    { id: 8, x: 270, y: 100, label: 'f(0)=0' },
  ];
  const edges = [[0,1],[0,6],[1,2],[1,5],[2,3],[2,4],[6,7],[6,8]];
  const order = [0,1,2,3,4,5,6,7,8]; // pre-order
  const maxStep = order.length - 1;

  useEffect(() => {
    if (!isPlaying) return;
    const timer = setInterval(() => {
      setStep(s => {
        if (s >= maxStep) { setIsPlaying(false); return maxStep; }
        return s + 1;
      });
    }, ANIM_SPEED);
    return () => clearInterval(timer);
  }, [isPlaying, maxStep]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const visitedSet = new Set(order.slice(0, step + 1));
    const current = order[step];

    // Edges
    edges.forEach(([a, b]) => {
      const na = nodes[a], nb = nodes[b];
      const bothVisited = visitedSet.has(a) && visitedSet.has(b);
      ctx.strokeStyle = bothVisited ? COLORS.edgeActive : COLORS.edge;
      ctx.lineWidth = bothVisited ? 2 : 1;
      ctx.beginPath();
      ctx.moveTo(na.x + 15, na.y + 15);
      ctx.lineTo(nb.x + 15, nb.y + 15);
      ctx.stroke();
    });

    // Nodes
    nodes.forEach(n => {
      const isVisited = visitedSet.has(n.id);
      const isCurrent = n.id === current;

      ctx.fillStyle = isCurrent ? COLORS.cellCurrent : isVisited ? COLORS.cellActive : COLORS.cell;
      ctx.beginPath();
      ctx.roundRect(n.x, n.y, 30, 24, 6);
      ctx.fill();

      if (isCurrent) {
        ctx.strokeStyle = COLORS.cellCurrent;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.roundRect(n.x - 2, n.y - 2, 34, 28, 8);
        ctx.stroke();
      }

      ctx.fillStyle = isVisited ? '#fff' : COLORS.textDim;
      ctx.font = n.label.length > 4 ? '10px Inter, system-ui, sans-serif' : 'bold 11px Inter, system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(n.label, n.x + 15, n.y + 12);
    });
  }, [step]);

  return (
    <div className={styles.vizContainer}>
      <div className={styles.vizHeader}>
        <span className={styles.vizIcon}>🌲</span>
        <span className={styles.vizTitle}>Recursion Tree — fib(4)</span>
        <div className={styles.controls}>
          <button className={styles.controlBtn} onClick={() => { setStep(0); setIsPlaying(true); }}>↺</button>
          <button className={styles.controlBtn} onClick={() => setIsPlaying(!isPlaying)}>
            {isPlaying ? '⏸' : '▶'}
          </button>
        </div>
      </div>
      <canvas ref={canvasRef} width={310} height={170} className={styles.canvas} />
    </div>
  );
}

/* ── Type → Component map ───────────────────────────────────────── */

const VIZ_COMPONENTS = {
  sliding_window: SlidingWindowViz,
  two_pointers:   TwoPointersViz,
  bfs:            (props) => <GraphViz type="bfs" {...props} />,
  dfs:            (props) => <GraphViz type="dfs" {...props} />,
  stack:          StackViz,
  recursion:      RecursionViz,
};

/* ── Main export ────────────────────────────────────────────────── */

export default function VisualizationPanel() {
  const vizTriggers = useSessionStore((s) => s.vizTriggers);
  const clearVizTriggers = useSessionStore((s) => s.clearVizTriggers);

  if (!vizTriggers || vizTriggers.length === 0) return null;

  // Show the latest trigger
  const latest = vizTriggers[vizTriggers.length - 1];
  const VizComponent = VIZ_COMPONENTS[latest.type];

  if (!VizComponent) return null;

  return (
    <div className={`${styles.panel} animate-scale-in`}>
      <VizComponent />
      <button
        className={styles.dismissBtn}
        onClick={clearVizTriggers}
        aria-label="Dismiss visualization"
      >
        ✕
      </button>
    </div>
  );
}

export { VIZ_COMPONENTS };

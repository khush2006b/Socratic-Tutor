/**
 * NotesPage.jsx
 * Displays AI-generated session notes: mistakes, techniques, insights, patterns.
 */
import { useState, useEffect, useCallback } from 'react';
import { fetchNotes } from '../api/notes';
import styles from './NotesPage.module.css';

const CATEGORIES = [
  { id: null,        label: 'All Notes',  icon: '◈', color: '#a78bfa' },
  { id: 'mistake',   label: 'Mistakes',   icon: '⚠', color: '#ef4444' },
  { id: 'technique', label: 'Techniques', icon: '⚙', color: '#8b5cf6' },
  { id: 'insight',   label: 'Insights',   icon: '💡', color: '#06b6d4' },
  { id: 'pattern',   label: 'Patterns',   icon: '◈', color: '#10b981' },
];

const CATEGORY_META = {
  mistake:   { icon: '⚠',  color: '#ef4444', bg: 'rgba(239,68,68,0.1)',   label: 'Mistake'   },
  technique: { icon: '⚙',  color: '#8b5cf6', bg: 'rgba(139,92,246,0.1)',  label: 'Technique' },
  insight:   { icon: '💡', color: '#06b6d4', bg: 'rgba(6,182,212,0.1)',   label: 'Insight'   },
  pattern:   { icon: '◈',  color: '#10b981', bg: 'rgba(16,185,129,0.1)',  label: 'Pattern'   },
};

function formatDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function NoteCard({ note }) {
  const meta = CATEGORY_META[note.category] ?? CATEGORY_META.insight;
  return (
    <div className={styles.card} style={{ '--card-accent': meta.color }}>
      <div className={styles.cardAccent} />
      <div className={styles.cardHeader}>
        <span className={styles.categoryBadge} style={{ background: meta.bg, color: meta.color }}>
          <span className={styles.categoryIcon}>{meta.icon}</span>
          {meta.label}
        </span>
        {note.problem_title && (
          <span className={styles.problemTag}>{note.problem_title}</span>
        )}
      </div>
      <h3 className={styles.cardTitle}>{note.title}</h3>
      <p className={styles.cardContent}>{note.content}</p>
      {note.tags && note.tags.length > 0 && (
        <div className={styles.tagRow}>
          {note.tags.map(tag => (
            <span key={tag} className={styles.tag}>{tag}</span>
          ))}
        </div>
      )}
      <time className={styles.cardDate}>{formatDate(note.created_at)}</time>
    </div>
  );
}

function SkeletonCard() {
  return (
    <div className={styles.skeleton}>
      <div className={styles.skeletonLine} style={{ width: '30%', height: '20px', marginBottom: '12px' }} />
      <div className={styles.skeletonLine} style={{ width: '80%', height: '18px', marginBottom: '8px' }} />
      <div className={styles.skeletonLine} style={{ width: '100%', height: '14px', marginBottom: '6px' }} />
      <div className={styles.skeletonLine} style={{ width: '90%', height: '14px' }} />
    </div>
  );
}

export default function NotesPage() {
  const [notes, setNotes]         = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError]         = useState(null);
  const [activeCategory, setActiveCategory] = useState(null);
  const [search, setSearch]       = useState('');

  const loadNotes = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const data = await fetchNotes(activeCategory);
      setNotes(data.notes ?? []);
    } catch (err) {
      setError(err.message);
    } finally {
      setIsLoading(false);
    }
  }, [activeCategory]);

  useEffect(() => { loadNotes(); }, [loadNotes]);

  const filtered = notes.filter(n => {
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      n.title?.toLowerCase().includes(q) ||
      n.content?.toLowerCase().includes(q) ||
      n.problem_title?.toLowerCase().includes(q) ||
      n.tags?.some(t => t.toLowerCase().includes(q))
    );
  });

  const counts = CATEGORIES.reduce((acc, cat) => {
    acc[cat.id ?? 'all'] = cat.id ? notes.filter(n => n.category === cat.id).length : notes.length;
    return acc;
  }, {});

  return (
    <div className={styles.page}>
      {/* ── Page header ── */}
      <div className={styles.pageHeader}>
        <div className={styles.headerLeft}>
          <div className={styles.headerIcon}>📓</div>
          <div>
            <h1 className={styles.pageTitle}>Session Notes</h1>
            <p className={styles.pageSubtitle}>AI-generated notes from your tutoring sessions — mistakes caught, techniques learned, insights gained</p>
          </div>
        </div>
        <button className={styles.refreshBtn} onClick={loadNotes} title="Refresh notes">
          ↺ Refresh
        </button>
      </div>

      {/* ── Stats strip ── */}
      <div className={styles.statsStrip}>
        {CATEGORIES.slice(1).map(cat => {
          const count = counts[cat.id] ?? 0;
          const meta  = CATEGORY_META[cat.id];
          return (
            <div key={cat.id} className={styles.statCard} style={{ '--stat-color': meta.color, '--stat-bg': meta.bg }}>
              <span className={styles.statIcon}>{cat.icon}</span>
              <span className={styles.statCount}>{count}</span>
              <span className={styles.statLabel}>{cat.label}</span>
            </div>
          );
        })}
      </div>

      {/* ── Controls ── */}
      <div className={styles.controls}>
        <div className={styles.filterTabs}>
          {CATEGORIES.map(cat => (
            <button
              key={cat.id ?? 'all'}
              className={`${styles.filterTab} ${activeCategory === cat.id ? styles.filterTabActive : ''}`}
              style={activeCategory === cat.id ? { '--tab-color': cat.color } : {}}
              onClick={() => setActiveCategory(cat.id)}
            >
              <span>{cat.icon}</span>
              {cat.label}
              <span className={styles.filterCount}>{counts[cat.id ?? 'all'] ?? 0}</span>
            </button>
          ))}
        </div>
        <div className={styles.searchWrapper}>
          <span className={styles.searchIcon}>🔍</span>
          <input
            className={styles.searchInput}
            type="text"
            placeholder="Search notes…"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
          {search && (
            <button className={styles.searchClear} onClick={() => setSearch('')}>✕</button>
          )}
        </div>
      </div>

      {/* ── Content ── */}
      {error && (
        <div className={styles.errorBox}>
          <span>⚠</span> Failed to load notes: {error}
          <button className={styles.retryBtn} onClick={loadNotes}>Retry</button>
        </div>
      )}

      {isLoading ? (
        <div className={styles.grid}>
          {[1,2,3,4,5,6].map(i => <SkeletonCard key={i} />)}
        </div>
      ) : filtered.length === 0 ? (
        <div className={styles.emptyState}>
          <div className={styles.emptyIcon}>📓</div>
          <h3 className={styles.emptyTitle}>
            {search ? 'No notes match your search' : 'No notes yet'}
          </h3>
          <p className={styles.emptyText}>
            {search
              ? 'Try a different search term or clear the filter.'
              : 'Complete a tutoring session and the AI will automatically generate notes capturing your mistakes, techniques, and key insights.'}
          </p>
        </div>
      ) : (
        <div className={styles.grid}>
          {filtered.map(note => (
            <NoteCard key={note.id} note={note} />
          ))}
        </div>
      )}
    </div>
  );
}

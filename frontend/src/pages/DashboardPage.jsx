/**
 * DashboardPage.jsx
 * Premium dashboard — stats, activity heatmap, daily question,
 * pattern mastery, weakness alerts, and recent sessions.
 *
 * Fetches all data from GET /api/dashboard/me in a single call.
 */

import { useState, useEffect, useCallback, useMemo } from 'react';
import useAuthStore from '../store/authStore';
import useSessionStore from '../store/sessionStore';
import { fetchDashboard, refreshDailyQuestion } from '../api/dashboard';
import { parseProblem } from '../api/tutor';
import styles from './DashboardPage.module.css';

/* ── Helpers ─────────────────────────────────────────────────── */

function formatTime(seconds) {
  if (!seconds) return '0m';
  const m = Math.floor(seconds / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}

function formatDate(dateStr) {
  if (!dateStr) return '';
  try {
    return new Date(dateStr).toLocaleDateString('en-US', {
      month: 'short', day: 'numeric',
    });
  } catch { return ''; }
}

function getHeatmapLevel(count) {
  if (count === 0) return 0;
  if (count === 1) return 1;
  if (count === 2) return 2;
  if (count <= 4) return 3;
  return 4;
}

const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

function formatPatternName(pattern) {
  if (!pattern) return '';
  return pattern
    .replace(/_/g, ' ')
    .replace(/\b\w/g, c => c.toUpperCase());
}

/* ── Activity Heatmap ────────────────────────────────────────── */

function ActivityHeatmap({ heatmap, streak }) {
  // Build weeks (columns of 7 cells)
  const weeks = useMemo(() => {
    if (!heatmap || heatmap.length === 0) return [];
    const w = [];
    for (let i = 0; i < heatmap.length; i += 7) {
      w.push(heatmap.slice(i, i + 7));
    }
    return w;
  }, [heatmap]);

  // Month labels
  const monthLabels = useMemo(() => {
    if (!heatmap || heatmap.length === 0) return [];
    const labels = [];
    let lastMonth = -1;
    for (let i = 0; i < heatmap.length; i += 7) {
      const d = new Date(heatmap[i].date);
      const m = d.getMonth();
      if (m !== lastMonth) {
        labels.push({ index: Math.floor(i / 7), label: MONTHS[m] });
        lastMonth = m;
      }
    }
    return labels;
  }, [heatmap]);

  const totalSubmissions = useMemo(
    () => heatmap?.reduce((s, d) => s + d.count, 0) || 0,
    [heatmap]
  );

  return (
    <div className={styles.heatmapSection}>
      <div className={styles.heatmapHeader}>
        <span className={styles.heatmapTitle}>
          <strong>{totalSubmissions}</strong> problems solved in the past year
        </span>
        <div className={styles.heatmapStats}>
          <span>Active days: <strong>{streak?.total_active_days || 0}</strong></span>
          <span>Max streak: <strong>{streak?.max || 0}</strong></span>
          <span>Current: <strong>{streak?.current || 0}</strong> 🔥</span>
        </div>
      </div>

      <div className={styles.heatmapGrid}>
        {weeks.map((week, wi) => (
          <div key={wi} className={styles.heatmapWeek}>
            {week.map((day, di) => (
              <div
                key={di}
                className={styles.heatmapCell}
                data-level={getHeatmapLevel(day.count)}
                title={`${day.date}: ${day.count} problem${day.count !== 1 ? 's' : ''}`}
              />
            ))}
          </div>
        ))}
      </div>

      {/* Month labels */}
      <div className={styles.heatmapMonths}>
        {monthLabels.map((m, i) => (
          <span
            key={i}
            className={styles.heatmapMonth}
            style={{ marginLeft: i === 0 ? 0 : `${(m.index - (monthLabels[i-1]?.index || 0)) * 15 - 20}px` }}
          >
            {m.label}
          </span>
        ))}
      </div>

      <div className={styles.heatmapLegend}>
        <span>Less</span>
        {[0,1,2,3,4].map(l => (
          <div key={l} className={styles.heatmapCell} data-level={l} />
        ))}
        <span>More</span>
      </div>
    </div>
  );
}

/* ── Stats Cards ─────────────────────────────────────────────── */

function StatsRow({ profile, streak }) {
  const stats = [
    { icon: '🎯', value: profile.total_problems_solved || 0, label: 'Problems Solved' },
    { icon: '🔥', value: streak?.current || 0, label: 'Day Streak' },
    { icon: '📚', value: profile.total_sessions || 0, label: 'Sessions' },
    { icon: '💡', value: profile.total_hints_used || 0, label: 'Hints Used' },
  ];

  return (
    <div className={styles.statsRow}>
      {stats.map((s, i) => (
        <div key={i} className={styles.statCard}>
          <span className={styles.statIcon}>{s.icon}</span>
          <span className={styles.statValue}>{s.value}</span>
          <span className={styles.statLabel}>{s.label}</span>
        </div>
      ))}
    </div>
  );
}

/* ── Daily Question ──────────────────────────────────────────── */

function DailyQuestion({ question, onStart, onRefresh }) {
  const [isRefreshing, setIsRefreshing] = useState(false);

  if (!question) return null;

  const handleSkip = async () => {
    setIsRefreshing(true);
    try {
      await onRefresh();
    } finally {
      setIsRefreshing(false);
    }
  };

  return (
    <div className={styles.dailyCard}>
      <div className={styles.cardHeader}>
        <span className={styles.cardIcon}>🧠</span>
        <span className={styles.cardTitle}>Today's Challenge</span>
        <span className={styles.aiBadge}>✨ AI Recommended</span>
      </div>
      <div className={styles.dailyProblem}>
        <span className={styles.dailyTitle}>
          #{question.id} {question.title}
        </span>
        <div className={styles.dailyMeta}>
          <span className={styles.difficultyBadge} data-difficulty={question.difficulty}>
            {question.difficulty}
          </span>
          <span className={styles.patternBadge}>
            {formatPatternName(question.pattern)}
          </span>
        </div>
        <p className={styles.dailyReason}>"{question.reason}"</p>
        <div className={styles.dailyActions}>
          <button className={styles.startBtn} onClick={() => onStart(question)}>
            Start Problem →
          </button>
          <button
            className={styles.skipBtn}
            onClick={handleSkip}
            disabled={isRefreshing}
          >
            {isRefreshing ? '⏳ Loading…' : 'Skip → New Question'}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ── Pattern Mastery ─────────────────────────────────────────── */

function PatternMastery({ mastery }) {
  const entries = useMemo(() => {
    if (!mastery || typeof mastery !== 'object') return [];
    return Object.entries(mastery)
      .map(([pattern, data]) => ({
        pattern,
        level: data?.level || 'recognition',
        attempts: data?.attempts || 0,
      }))
      .sort((a, b) => {
        const order = { generalisation: 3, application: 2, recognition: 1 };
        return (order[b.level] || 0) - (order[a.level] || 0);
      });
  }, [mastery]);

  if (entries.length === 0) {
    return (
      <div className={styles.card}>
        <div className={styles.cardHeader}>
          <span className={styles.cardIcon}>📊</span>
          <span className={styles.cardTitle}>Pattern Mastery</span>
        </div>
        <div className={styles.emptyState}>
          <span className={styles.emptyIcon}>📊</span>
          Solve problems to track pattern mastery
        </div>
      </div>
    );
  }

  return (
    <div className={styles.card}>
      <div className={styles.cardHeader}>
        <span className={styles.cardIcon}>📊</span>
        <span className={styles.cardTitle}>Pattern Mastery</span>
      </div>
      <div className={styles.masteryList}>
        {entries.map(e => (
          <div key={e.pattern} className={styles.masteryRow}>
            <span className={styles.masteryPattern}>{formatPatternName(e.pattern)}</span>
            <div className={styles.masteryBarOuter}>
              <div className={styles.masteryBarInner} data-level={e.level} />
            </div>
            <span className={styles.masteryLevel} data-level={e.level}>
              {e.level}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ── Weakness Alerts ─────────────────────────────────────────── */

function WeaknessAlerts({ misconceptions, weakPatterns }) {
  const hasContent = (misconceptions?.length > 0) || (weakPatterns?.length > 0);

  return (
    <div className={styles.card}>
      <div className={styles.cardHeader}>
        <span className={styles.cardIcon}>⚠️</span>
        <span className={styles.cardTitle}>Areas to Improve</span>
      </div>
      {!hasContent ? (
        <div className={styles.emptyState}>
          <span className={styles.emptyIcon}>✨</span>
          No active weaknesses — keep going!
        </div>
      ) : (
        <div className={styles.weaknessList}>
          {weakPatterns?.map((p, i) => (
            <div key={`wp-${i}`} className={styles.weaknessItem}>
              <span className={styles.weaknessDot} />
              <span>{formatPatternName(p)}</span>
              <span className={styles.weaknessType}>Weak Pattern</span>
            </div>
          ))}
          {misconceptions?.map((m, i) => (
            <div key={`mc-${i}`} className={styles.weaknessItem}>
              <span className={styles.weaknessDot} />
              <span>{m.description}</span>
              <span className={styles.weaknessType}>Misconception</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ── Recent Sessions ─────────────────────────────────────────── */

function RecentSessions({ sessions }) {
  if (!sessions || sessions.length === 0) {
    return (
      <div className={styles.card}>
        <div className={styles.cardHeader}>
          <span className={styles.cardIcon}>📝</span>
          <span className={styles.cardTitle}>Recent Sessions</span>
        </div>
        <div className={styles.emptyState}>
          <span className={styles.emptyIcon}>📝</span>
          No sessions yet — start your first problem!
        </div>
      </div>
    );
  }

  return (
    <div className={styles.card}>
      <div className={styles.cardHeader}>
        <span className={styles.cardIcon}>📝</span>
        <span className={styles.cardTitle}>Recent Sessions</span>
      </div>
      <div className={styles.sessionsList}>
        {sessions.slice(0, 6).map((s, i) => (
          <div key={s.id || i} className={styles.sessionItem}>
            <div className={styles.sessionInfo}>
              <span className={styles.sessionTitle}>
                {s.problem_title || 'Untitled Problem'}
              </span>
              <div className={styles.sessionMeta}>
                <span>{formatTime(s.elapsed_seconds)}</span>
                <span>{s.hints_used || 0} hints</span>
                <span>{formatDate(s.started_at)}</span>
              </div>
            </div>
            <span className={styles.phaseBadge} data-phase={s.phase || 'solving'}>
              {s.phase === 'complete' || s.phase === 'solved' ? 'Solved' : s.phase || 'In Progress'}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ── Main Dashboard ──────────────────────────────────────────── */

export default function DashboardPage({ onNavigateToTutor }) {
  const displayName = useAuthStore(s => s.displayName?.());
  const [data, setData] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);

  const setProblem = useSessionStore(s => s.setProblem);
  const setLoadingProblem = useSessionStore(s => s.setLoadingProblem);

  useEffect(() => {
    let cancelled = false;
    setIsLoading(true);
    setError(null);

    fetchDashboard()
      .then(d => { if (!cancelled) setData(d); })
      .catch(e => { if (!cancelled) setError(e.message); })
      .finally(() => { if (!cancelled) setIsLoading(false); });

    return () => { cancelled = true; };
  }, []);

  const handleStartProblem = useCallback(async (question) => {
    try {
      setLoadingProblem(true);
      const problem = await parseProblem(String(question.id));
      setProblem(problem);
      onNavigateToTutor?.();
    } catch (e) {
      console.error('Failed to start problem:', e);
    } finally {
      setLoadingProblem(false);
    }
  }, [setProblem, setLoadingProblem, onNavigateToTutor]);

  const handleRefreshQuestion = useCallback(async () => {
    try {
      const res = await refreshDailyQuestion();
      setData(prev => ({ ...prev, daily_question: res.daily_question }));
    } catch (e) {
      console.error('Failed to refresh question:', e);
    }
  }, []);

  if (isLoading) {
    return (
      <div className={styles.loading}>
        <span className={styles.spinner}>⬡</span>
        Loading dashboard…
      </div>
    );
  }

  if (error) {
    return (
      <div className={styles.loading}>
        <span>Failed to load dashboard: {error}</span>
      </div>
    );
  }

  const { profile, activity_heatmap, streak, recent_sessions, daily_question, misconceptions_active } = data || {};

  const today = new Date().toLocaleDateString('en-US', {
    weekday: 'long', month: 'long', day: 'numeric', year: 'numeric',
  });

  return (
    <div className={styles.dashboard}>
      {/* Ambient background glows */}
      <div className={styles.orbPurple} />
      <div className={styles.orbCyan} />
      <div className={styles.orbPink} />

      {/* Welcome */}
      <div className={styles.welcomeSection}>
        <h1 className={styles.greeting}>
          Welcome back, <span className={styles.greetingName}>{displayName || 'Student'}</span> 👋
        </h1>
        <span className={styles.dateText}>{today}</span>
      </div>

      {/* Stats */}
      <StatsRow profile={profile || {}} streak={streak} />

      {/* Heatmap */}
      <ActivityHeatmap heatmap={activity_heatmap || []} streak={streak || {}} />

      {/* Content grid */}
      <div className={styles.contentGrid}>
        {/* Left column */}
        <div>
          <DailyQuestion question={daily_question} onStart={handleStartProblem} onRefresh={handleRefreshQuestion} />
          <div style={{ marginTop: 20 }}>
            <WeaknessAlerts
              misconceptions={misconceptions_active || []}
              weakPatterns={profile?.weak_patterns || []}
            />
          </div>
        </div>

        {/* Right column */}
        <div>
          <PatternMastery mastery={profile?.per_pattern_mastery || {}} />
          <div style={{ marginTop: 20 }}>
            <RecentSessions sessions={recent_sessions || []} />
          </div>
        </div>
      </div>
    </div>
  );
}

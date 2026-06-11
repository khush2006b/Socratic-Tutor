-- ================================================================
-- Migration: Add Cognitive Profile System
-- Run this in Supabase SQL Editor to add the solved_problems table
-- and expand student_profiles with fingerprint columns.
-- ================================================================

-- ── Solved Problems table ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS solved_problems (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id      text NOT NULL,
  session_id      uuid REFERENCES sessions(id),
  problem_id      integer,
  problem_title   text,
  pattern         text,
  difficulty      text,
  solved          boolean DEFAULT false,
  hints_used      integer DEFAULT 0,
  elapsed_seconds integer DEFAULT 0,
  strategy_used   text,
  key_mistake     text,
  mastery_level   text CHECK (mastery_level IN ('recognition','application','generalisation')),
  solved_at       timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_solved_problems_student ON solved_problems(student_id);
CREATE INDEX IF NOT EXISTS idx_solved_problems_pattern ON solved_problems(pattern);

-- Disable RLS for now (same as other tables)
ALTER TABLE solved_problems DISABLE ROW LEVEL SECURITY;

-- ── Expand student_profiles ──────────────────────────────────────
ALTER TABLE student_profiles
  ADD COLUMN IF NOT EXISTS weakness_fingerprint text[] DEFAULT '{}';

ALTER TABLE student_profiles
  ADD COLUMN IF NOT EXISTS strength_fingerprint text[] DEFAULT '{}';

ALTER TABLE student_profiles
  ADD COLUMN IF NOT EXISTS learning_velocity jsonb DEFAULT '{}';

ALTER TABLE student_profiles
  ADD COLUMN IF NOT EXISTS recent_strategies jsonb DEFAULT '{}';

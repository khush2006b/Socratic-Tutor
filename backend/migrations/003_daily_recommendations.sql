-- ================================================================
-- Migration: Add daily_recommendations table
-- Stores AI-generated daily question recommendations per student.
-- Questions persist until solved or skipped.
-- ================================================================

CREATE TABLE IF NOT EXISTS daily_recommendations (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id      TEXT NOT NULL,
  problem_id      INTEGER NOT NULL,
  problem_title   TEXT NOT NULL,
  difficulty      TEXT,
  pattern         TEXT,
  reason          TEXT,
  status          TEXT DEFAULT 'active'
                    CHECK (status IN ('active', 'solved', 'skipped')),
  recommended_at  TIMESTAMPTZ DEFAULT now(),
  solved_at       TIMESTAMPTZ,
  created_at      TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_daily_rec_student_status
  ON daily_recommendations(student_id, status);

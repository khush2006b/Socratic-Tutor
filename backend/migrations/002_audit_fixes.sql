-- ================================================================
-- Migration: Fix schema mismatches found in project audit
-- Run this in Supabase SQL Editor to update an existing database
-- ================================================================

-- 1. Add 'solved' to sessions phase CHECK + add solved_at column
ALTER TABLE sessions DROP CONSTRAINT IF EXISTS sessions_phase_check;
ALTER TABLE sessions ADD CONSTRAINT sessions_phase_check
  CHECK (phase IN ('solving','stuck','reflecting','complete','solved'));
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS solved_at timestamptz;

-- 2. Fix mastery_events level CHECK (was 'structural'/'fluent', now 'application'/'generalisation')
ALTER TABLE mastery_events DROP CONSTRAINT IF EXISTS mastery_events_level_check;
ALTER TABLE mastery_events ADD CONSTRAINT mastery_events_level_check
  CHECK (level IN ('recognition', 'application', 'generalisation'));

-- 3. Add missing columns to student_profiles
ALTER TABLE student_profiles ADD COLUMN IF NOT EXISTS email text DEFAULT '';
ALTER TABLE student_profiles ADD COLUMN IF NOT EXISTS display_name text DEFAULT '';
ALTER TABLE student_profiles ADD COLUMN IF NOT EXISTS total_hints_used integer DEFAULT 0;
ALTER TABLE student_profiles ADD COLUMN IF NOT EXISTS last_problem_id integer;
ALTER TABLE student_profiles ADD COLUMN IF NOT EXISTS last_problem_title text;

-- 4. Create notes table (was missing entirely)
CREATE TABLE IF NOT EXISTS notes (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id      uuid REFERENCES sessions(id) ON DELETE CASCADE,
  student_id      text NOT NULL,
  problem_id      integer,
  problem_title   text,
  category        text NOT NULL
                    CHECK (category IN ('mistake','technique','insight','pattern')),
  title           text NOT NULL,
  content         text NOT NULL,
  tags            text[] DEFAULT '{}',
  created_at      timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_notes_student_id ON notes(student_id);
CREATE INDEX IF NOT EXISTS idx_notes_session_id ON notes(session_id);

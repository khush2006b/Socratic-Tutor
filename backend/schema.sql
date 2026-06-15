-- ================================================================
-- SocraticDS — Supabase Database Schema
-- Run this in your Supabase project → SQL Editor
-- ================================================================

-- Enable UUID generation
create extension if not exists "pgcrypto";


-- ── Sessions ──────────────────────────────────────────────────────
-- One row per problem attempt. Created when student loads a problem,
-- updated continuously, closed when reflection is saved.

create table if not exists sessions (
  id               uuid primary key default gen_random_uuid(),
  student_id       text not null,
  problem_id       integer,
  problem_title    text,
  language         text default 'python',
  phase            text default 'solving'
                     check (phase in ('solving','stuck','reflecting','complete','solved')),
  hints_used       integer default 0,
  code_edits       integer default 0,
  elapsed_seconds  integer default 0,
  calibration_state jsonb default '{}',
  started_at       timestamptz default now(),
  ended_at         timestamptz,
  solved_at        timestamptz
);

create index if not exists idx_sessions_student_id on sessions(student_id);
create index if not exists idx_sessions_problem_id on sessions(problem_id);


-- ── Messages ──────────────────────────────────────────────────────
-- Stores conversation turns for each session.
-- Tutor messages include the full Gemini response text.

create table if not exists messages (
  id          uuid primary key default gen_random_uuid(),
  session_id  uuid references sessions(id) on delete cascade,
  role        text not null check (role in ('tutor', 'student')),
  content     text not null,
  created_at  timestamptz default now()
);

create index if not exists idx_messages_session_id on messages(session_id);


-- ── Reflections ───────────────────────────────────────────────────
-- Stores post-session reflection answers.
-- One per session (1:1 with sessions where reflection was completed).

create table if not exists reflections (
  id               uuid primary key default gen_random_uuid(),
  session_id       uuid references sessions(id) on delete cascade,
  student_id       text not null,
  problem_id       integer,
  problem_title    text,
  pattern_answer   text,   -- "What pattern did you use?"
  insight_answer   text,   -- "What was the key insight?"
  stuck_answer     text,   -- "Where did you get stuck?"
  transfer_answer  text,   -- "Name 2-3 similar problems"
  hints_used       integer default 0,
  elapsed_seconds  integer default 0,
  quality_level    text check (quality_level in ('surface','structural','transferable')),
  quality_feedback text,   -- AI-generated feedback on reflection depth
  created_at       timestamptz default now()
);

create index if not exists idx_reflections_student_id on reflections(student_id);


-- ── Misconceptions ────────────────────────────────────────────────
-- Detected from [MISCONCEPTION: ...] tags in Gemini responses.
-- Stored as specific mental-model failures, not vague labels.
-- Example: "confuses DP state with full path reconstruction"

create table if not exists misconceptions (
  id           uuid primary key default gen_random_uuid(),
  session_id   uuid references sessions(id) on delete cascade,
  student_id   text not null,
  problem_id   integer,
  pattern      text,
  description  text not null,
  resolved     boolean default false,
  detected_at  timestamptz default now()
);

create index if not exists idx_misconceptions_student_id on misconceptions(student_id);
create index if not exists idx_misconceptions_resolved   on misconceptions(resolved);


-- ── Mastery Events ────────────────────────────────────────────────
-- Detected from [MASTERY: pattern → level] tags in Gemini responses.
-- Append-only log; aggregated into student profile on read.

create table if not exists mastery_events (
  id          uuid primary key default gen_random_uuid(),
  session_id  uuid references sessions(id) on delete cascade,
  student_id  text not null,
  pattern     text not null,
  level       text not null
                check (level in ('recognition', 'application', 'generalisation')),
  problem_id  integer,
  recorded_at timestamptz default now()
);

create index if not exists idx_mastery_events_student_id on mastery_events(student_id);
create index if not exists idx_mastery_events_pattern    on mastery_events(pattern);


-- ── Solved Problems (Cross-Session Log) ──────────────────────────
-- One row per problem attempt. Populated when [PROBLEM_SOLVED] fires
-- or when session reflection is saved.

create table if not exists solved_problems (
  id              uuid primary key default gen_random_uuid(),
  student_id      text not null,
  session_id      uuid references sessions(id),
  problem_id      integer,
  problem_title   text,
  pattern         text,
  difficulty      text,
  solved          boolean default false,
  hints_used      integer default 0,
  elapsed_seconds integer default 0,
  strategy_used   text,
  key_mistake     text,
  mastery_level   text check (mastery_level in ('recognition','application','generalisation')),
  solved_at       timestamptz default now()
);

create index if not exists idx_solved_problems_student on solved_problems(student_id);
create index if not exists idx_solved_problems_pattern on solved_problems(pattern);


-- ── Student Profiles (Aggregate View) ────────────────────────────
-- Lightweight denormalized profile per student.
-- Updated after each session completion.

create table if not exists student_profiles (
  student_id              text primary key,
  email                   text default '',
  display_name            text default '',
  total_sessions          integer default 0,
  total_problems_solved   integer default 0,
  total_hints_used        integer default 0,
  problems_attempted      integer[] default '{}',
  patterns_seen           text[] default '{}',
  weak_patterns           text[] default '{}',
  calibration_aggregate   jsonb default '{}',
  per_pattern_mastery     jsonb default '{}',
  weakness_fingerprint    text[] default '{}',
  strength_fingerprint    text[] default '{}',
  learning_velocity       jsonb default '{}',
  recent_strategies       jsonb default '{}',
  last_problem_id         integer,
  last_problem_title      text,
  created_at              timestamptz default now(),
  last_active_at          timestamptz default now()
);


-- ── Notes ─────────────────────────────────────────────────────────
-- AI-generated study notes from session analysis.
-- Created by note_generator after session reflection.

create table if not exists notes (
  id              uuid primary key default gen_random_uuid(),
  session_id      uuid references sessions(id) on delete cascade,
  student_id      text not null,
  problem_id      integer,
  problem_title   text,
  category        text not null
                    check (category in ('mistake','technique','insight','pattern','process')),
  title           text not null,
  content         text not null,
  tags            text[] default '{}',
  created_at      timestamptz default now()
);

create index if not exists idx_notes_student_id on notes(student_id);
create index if not exists idx_notes_session_id on notes(session_id);


-- ── Row Level Security (enable when using Supabase Auth in Stage 3) ──
-- For Stage 2 (anonymous student_id), disable RLS and rely on API-level checks.
-- Uncomment these when adding auth in Stage 3:

-- alter table sessions      enable row level security;
-- alter table messages      enable row level security;
-- alter table reflections   enable row level security;
-- alter table misconceptions enable row level security;
-- alter table mastery_events enable row level security;
-- alter table student_profiles enable row level security;

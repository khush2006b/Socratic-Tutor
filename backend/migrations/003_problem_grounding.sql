-- ================================================================
-- Migration 003: Problem Grounding Engine
-- Run this in Supabase Dashboard → SQL Editor → New Query
-- ================================================================

-- Structured problem knowledge extracted by Gemini (one-time per session)
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS grounding_json jsonb;

-- Dynamic per-session student state relative to the problem grounding
-- Tracks: misconceptions_triggered, mastered concepts, confusion points
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS student_grounding jsonb DEFAULT '{}';

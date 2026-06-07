-- ================================================================
-- Migration: Add Calibration State Columns
-- Run this in Supabase SQL Editor to add the calibration columns
-- to your existing tables.
-- ================================================================

-- Add calibration_state JSONB to sessions table
ALTER TABLE sessions
  ADD COLUMN IF NOT EXISTS calibration_state jsonb DEFAULT '{}';

-- Add calibration columns to student_profiles table
ALTER TABLE student_profiles
  ADD COLUMN IF NOT EXISTS calibration_aggregate jsonb DEFAULT '{}';

ALTER TABLE student_profiles
  ADD COLUMN IF NOT EXISTS per_pattern_mastery jsonb DEFAULT '{}';

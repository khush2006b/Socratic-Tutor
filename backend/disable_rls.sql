-- ================================================================
-- SocraticDS — Disable Row Level Security
-- Run this in: Supabase Dashboard → SQL Editor → New Query
--
-- RLS is disabled here because we're using anonymous student IDs
-- (no Supabase Auth yet). Re-enable with proper policies in Stage 3
-- when you add user authentication.
-- ================================================================

alter table sessions          disable row level security;
alter table messages          disable row level security;
alter table reflections       disable row level security;
alter table misconceptions    disable row level security;
alter table mastery_events    disable row level security;
alter table student_profiles  disable row level security;

-- Verify RLS is off on all tables
select tablename, rowsecurity 
from pg_tables 
where schemaname = 'public'
order by tablename;

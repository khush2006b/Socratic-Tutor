/**
 * lib/supabase.js
 * Shared Supabase client instance for the frontend.
 * Used for auth (sign up, sign in, sign out, session).
 */

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL  = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_ANON = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!SUPABASE_URL || !SUPABASE_ANON) {
  console.warn('[supabase] VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY not set — auth will not work.');
}

export const supabase = createClient(SUPABASE_URL ?? '', SUPABASE_ANON ?? '', {
  auth: {
    persistSession:    true,        // stores session in localStorage
    autoRefreshToken:  true,        // silently refreshes before expiry
    detectSessionInUrl: true,       // handles OAuth redirect
  },
});

/**
 * store/authStore.js
 * Zustand store for authentication state.
 *
 * Listens to Supabase's onAuthStateChange so the store always reflects
 * the true session — even after page refresh or token auto-refresh.
 */

import { create } from 'zustand';
import { supabase } from '../lib/supabase';

const useAuthStore = create((set, get) => ({
  /* ── State ─────────────────────────────────────────────────── */
  user:        null,     // Supabase User object
  session:     null,     // Supabase Session (contains access_token)
  isLoading:   true,     // true while hydrating from localStorage
  authError:   null,     // last auth error message

  /* ── Actions ────────────────────────────────────────────────── */

  /** Called once on app mount — hydrates session from localStorage */
  init: async () => {
    const { data: { session } } = await supabase.auth.getSession();
    set({ user: session?.user ?? null, session, isLoading: false });

    // Subscribe to future auth events
    supabase.auth.onAuthStateChange((_event, session) => {
      set({ user: session?.user ?? null, session, authError: null });
    });
  },

  /** Sign up with email + password */
  signUp: async (email, password, displayName) => {
    set({ authError: null });
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: { data: { display_name: displayName } },
    });
    if (error) {
      // Map Supabase error messages to user-friendly text
      const msg = error.message ?? '';
      let friendly = msg;
      if (msg.toLowerCase().includes('email rate limit') || msg.toLowerCase().includes('rate limit')) {
        friendly = 'Too many sign-ups in a short time. Please wait a few minutes and try again, or ask your admin to disable email confirmation in Supabase.';
      } else if (msg.toLowerCase().includes('user already registered') || msg.toLowerCase().includes('already registered')) {
        friendly = 'An account with this email already exists. Try signing in instead.';
      } else if (msg.toLowerCase().includes('password')) {
        friendly = 'Password must be at least 6 characters.';
      } else if (msg.toLowerCase().includes('invalid email')) {
        friendly = 'Please enter a valid email address.';
      }
      set({ authError: friendly });
      return false;
    }

    // If email confirmation is ON  → data.session is null (email not yet confirmed)
    // If email confirmation is OFF → data.session is set  (instant login)
    if (data.session) {
      // Instant login — session is live
      set({ user: data.user, session: data.session });
      return true;
    } else {
      // Confirmation email sent — tell the UI to show the "check your inbox" notice
      return 'confirm';
    }
  },

  /** Sign in with email + password */
  signIn: async (email, password) => {
    set({ authError: null });
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) {
      set({ authError: error.message });
      return false;
    }
    set({ user: data.user, session: data.session });
    return true;
  },

  /** Sign out */
  signOut: async () => {
    await supabase.auth.signOut();
    set({ user: null, session: null });
  },

  clearError: () => set({ authError: null }),

  /* ── Derived helpers ────────────────────────────────────────── */
  isAuthenticated: () => !!get().user,
  accessToken:     () => get().session?.access_token ?? null,
  userId:          () => get().user?.id ?? null,
  displayName:     () =>
    get().user?.user_metadata?.display_name
    ?? get().user?.email?.split('@')[0]
    ?? 'Student',
}));

export default useAuthStore;

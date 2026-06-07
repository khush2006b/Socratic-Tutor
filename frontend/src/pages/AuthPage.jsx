/**
 * pages/AuthPage.jsx
 * Premium login / signup page.
 * Tabs switch between sign-in and sign-up without a page reload.
 */

import { useState, useCallback, useEffect } from 'react';
import useAuthStore from '../store/authStore';
import styles from './AuthPage.module.css';

/* ── Field component ─────────────────────────────────────────────── */
function Field({ id, label, type = 'text', value, onChange, placeholder, autoComplete }) {
  return (
    <div className={styles.field}>
      <label className={styles.label} htmlFor={id}>{label}</label>
      <input
        id={id}
        className={styles.input}
        type={type}
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        autoComplete={autoComplete}
        required
      />
    </div>
  );
}

/* ── Main component ──────────────────────────────────────────────── */
export default function AuthPage() {
  const [tab, setTab]             = useState('signin');   // 'signin' | 'signup'
  const [email, setEmail]         = useState('');
  const [password, setPassword]   = useState('');
  const [name, setName]           = useState('');
  const [loading, setLoading]     = useState(false);
  const [notice, setNotice]       = useState('');         // success message

  const authError  = useAuthStore(s => s.authError);
  const clearError = useAuthStore(s => s.clearError);
  const signIn     = useAuthStore(s => s.signIn);
  const signUp     = useAuthStore(s => s.signUp);

  // Reset form when switching tabs
  useEffect(() => {
    clearError();
    setNotice('');
    setEmail('');
    setPassword('');
    setName('');
  }, [tab, clearError]);

  const handleSubmit = useCallback(async (e) => {
    e.preventDefault();
    setLoading(true);
    setNotice('');
    clearError();

    if (tab === 'signin') {
      await signIn(email, password);
    } else {
      const result = await signUp(email, password, name);
      // result = true  → session created immediately (email confirm disabled)
      // result = 'confirm' → email sent, needs confirmation
      // result = false → error (already set in store)
      if (result === true) {
        // Session is live — authStore.signUp already called initAuth,
        // so the app will redirect automatically. Nothing to do.
      } else if (result === 'confirm') {
        setNotice('Account created! Check your inbox to confirm your email, then sign in.');
        setTab('signin');
      }
    }

    setLoading(false);
  }, [tab, email, password, name, signIn, signUp, clearError]);

  const isSignup = tab === 'signup';

  return (
    <div className={styles.page}>
      {/* Background orbs */}
      <div className={styles.orb1} aria-hidden="true" />
      <div className={styles.orb2} aria-hidden="true" />
      <div className={styles.orb3} aria-hidden="true" />

      <div className={styles.card}>
        {/* Logo + headline */}
        <div className={styles.brand}>
          <span className={styles.logo} aria-hidden="true">⬡</span>
          <h1 className={styles.brandName}>SocraticDS</h1>
          <p className={styles.tagline}>Learn DSA through dialogue, not answers.</p>
        </div>

        {/* Tab switcher */}
        <div className={styles.tabs} role="tablist">
          <button
            id="tab-signin"
            role="tab"
            aria-selected={!isSignup}
            className={`${styles.tab} ${!isSignup ? styles.tabActive : ''}`}
            onClick={() => setTab('signin')}
          >
            Sign In
          </button>
          <button
            id="tab-signup"
            role="tab"
            aria-selected={isSignup}
            className={`${styles.tab} ${isSignup ? styles.tabActive : ''}`}
            onClick={() => setTab('signup')}
          >
            Sign Up
          </button>
          <div className={`${styles.tabSlider} ${isSignup ? styles.tabSliderRight : ''}`} aria-hidden="true" />
        </div>

        {/* Form */}
        <form className={styles.form} onSubmit={handleSubmit} noValidate>
          {isSignup && (
            <Field
              id="auth-name"
              label="Display Name"
              value={name}
              onChange={setName}
              placeholder="e.g. Alex"
              autoComplete="name"
            />
          )}
          <Field
            id="auth-email"
            label="Email"
            type="email"
            value={email}
            onChange={setEmail}
            placeholder="you@example.com"
            autoComplete={isSignup ? 'email' : 'username'}
          />
          <Field
            id="auth-password"
            label="Password"
            type="password"
            value={password}
            onChange={setPassword}
            placeholder={isSignup ? 'min. 6 characters' : '••••••••'}
            autoComplete={isSignup ? 'new-password' : 'current-password'}
          />

          {/* Error */}
          {authError && (
            <p className={styles.error} role="alert">{authError}</p>
          )}

          {/* Success notice */}
          {notice && (
            <p className={styles.notice} role="status">{notice}</p>
          )}

          <button
            id="btn-auth-submit"
            type="submit"
            className={styles.submitBtn}
            disabled={loading}
          >
            {loading ? (
              <span className={styles.spinner} aria-hidden="true" />
            ) : (
              isSignup ? 'Create Account →' : 'Sign In →'
            )}
          </button>
        </form>

        {/* Switch tab prompt */}
        <p className={styles.switchPrompt}>
          {isSignup ? 'Already have an account?' : "Don't have an account?"}
          {' '}
          <button
            className={styles.switchLink}
            onClick={() => setTab(isSignup ? 'signin' : 'signup')}
          >
            {isSignup ? 'Sign In' : 'Sign Up'}
          </button>
        </p>

        <p className={styles.footer}>
          Powered by Gemini 2.5 · Socratic method · LangGraph
        </p>
      </div>
    </div>
  );
}

'use client';

import { FormEvent, useState } from 'react';
import { createClient } from '@/lib/supabase/client';

export default function LoginPage() {
  const [mode, setMode] = useState<'login' | 'signup'>('login');
  const [resetEmail, setResetEmail] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState(false);
  async function requestReset() {
    setBusy(true); setMessage(''); setError(false);
    try {
      const supabase = createClient();
      const { error } = await supabase.auth.resetPasswordForEmail(resetEmail || email, { redirectTo: `${window.location.origin}/auth/callback?next=/reset-password` });
      if (error) throw error;
      setMessage('Password reset email sent. Check your inbox and follow the link.');
    } catch (e) {
      setError(true);
      setMessage(e instanceof Error ? e.message : 'Could not send the password reset email.');
    } finally { setBusy(false); }
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true); setMessage(''); setError(false);
    try {
      const requestedNext = new URLSearchParams(window.location.search).get('next');
      const next = requestedNext?.startsWith('/') && !requestedNext.startsWith('//') ? requestedNext : '/account';
      const supabase = createClient();
      if (mode === 'login') {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        window.location.href = next;
      } else {
        const { data, error } = await supabase.auth.signUp({
          email,
          password,
          options: { emailRedirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}` },
        });
        if (error) throw error;
        if (!data.session) setMessage('Account created. Check your email to confirm your account, then log in.');
        else window.location.href = next;
      }
    } catch (e) {
      setError(true);
      setMessage(e instanceof Error ? e.message : 'Authentication failed.');
    } finally { setBusy(false); }
  }

  return (
    <main className="auth-page">
      <div className="auth-card">
        <div className="auth-top"><a className="brand auth-brand" href="/"><span className="brand-mark">F</span><span>FileForge</span></a><a className="auth-home-link" href="/">← Home</a></div>
        <span className="section-kicker">{mode === 'login' ? 'Welcome back' : 'Create your account'}</span>
        <h1>{mode === 'login' ? 'Log in to FileForge' : 'Start with FileForge'}</h1>
        <p>{mode === 'login' ? 'Sign in only when you want a persistent account. FileForge tools work without signup.' : 'Use FileForge tools without signup. Create an account only when you want a persistent login. Use a password of at least 12 characters.'}</p>
        <form onSubmit={submit} className="auth-form">
          <label>Email<input required type="email" value={email} onChange={e => setEmail(e.target.value)} autoComplete="email" /></label>
          <label>Password<input required minLength={mode === 'signup' ? 12 : undefined} type="password" value={password} onChange={e => setPassword(e.target.value)} autoComplete={mode === 'login' ? 'current-password' : 'new-password'} /></label>
          <button className="primary" disabled={busy} type="submit">{busy ? 'Please wait…' : mode === 'login' ? 'Log in' : 'Create account'}</button>
          {mode === 'login' && <button className="switch-button" type="button" disabled={busy} onClick={requestReset}>Forgot password?</button>}
        </form>
        {message && <p className={error ? 'notice error' : 'notice success'}>{message}</p>}
        <button className="switch-button" type="button" onClick={() => { setMode(mode === 'login' ? 'signup' : 'login'); setMessage(''); setError(false); }}>
          {mode === 'login' ? 'Need an account? Sign up' : 'Already have an account? Log in'}
        </button>
        
      </div>
    </main>
  );
}

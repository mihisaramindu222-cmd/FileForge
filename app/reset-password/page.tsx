'use client';

import { FormEvent, useState } from 'react';
import { createClient } from '@/lib/supabase/client';

export default function ResetPasswordPage() {
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault(); setBusy(true); setMessage(''); setError(false);
    if (password.length < 8 || password !== confirm) {
      setError(true); setMessage(password.length < 8 ? 'Password must be at least 8 characters.' : 'Passwords do not match.'); setBusy(false); return;
    }
    try {
      const { error } = await createClient().auth.updateUser({ password });
      if (error) throw error;
      setMessage('Password updated successfully. You can now log in with your new password.');
      setPassword(''); setConfirm('');
    } catch (e) {
      setError(true); setMessage(e instanceof Error ? e.message : 'Could not update your password. Please request a new reset link.');
    } finally { setBusy(false); }
  }

  return <main className="auth-page"><div className="auth-card"><a className="brand auth-brand" href="/">FileForge</a><span className="section-kicker">Account recovery</span><h1>Set a new password</h1><p>Choose a new password for your FileForge account.</p><form onSubmit={submit} className="auth-form"><label>New password<input required minLength={8} type="password" value={password} onChange={e => setPassword(e.target.value)} autoComplete="new-password" /></label><label>Confirm password<input required minLength={8} type="password" value={confirm} onChange={e => setConfirm(e.target.value)} autoComplete="new-password" /></label><button className="primary" disabled={busy} type="submit">{busy ? 'Updating…' : 'Update password'}</button></form>{message && <p className={error ? 'notice error' : 'notice success'}>{message}</p>}<a className="back-link" href="/login">← Back to login</a></div></main>;
}

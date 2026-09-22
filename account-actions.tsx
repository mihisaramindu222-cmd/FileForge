'use client';

import { useState } from 'react';
import { createClient } from '@/lib/supabase/client';

export default function AccountActions({ portalOnly = false }: { portalOnly?: boolean }) {
  const [busy, setBusy] = useState(false);
  async function logout() {
    await createClient().auth.signOut();
    window.location.href = '/';
  }
  async function portal() {
    setBusy(true);
    try {
      const res = await fetch('/api/billing/portal', { method: 'POST' });
      const data = await res.json().catch(() => ({}));
      if (data.url) window.location.href = data.url;
      else alert(data.error || 'Could not open billing portal.');
    } catch {
      alert('Billing is temporarily unavailable. Please try again.');
    } finally {
      setBusy(false);
    }
  }
  if (portalOnly) return <button className="secondary" onClick={portal} disabled={busy} type="button">{busy ? 'Opening…' : 'Manage billing'}</button>;
  return <button className="nav-link-button" onClick={logout} type="button">Log out</button>;
}

'use client';

import { useState } from 'react';

export default function PricingPage() {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  async function checkout() {
    setBusy(true); setMessage('');
    try {
      const res = await fetch('/api/billing/checkout', { method: 'POST' });
      const data = await res.json().catch(() => ({}));
      if (res.status === 401) { window.location.href = '/login?next=/pricing'; return; }
      if (data.url) { window.location.href = data.url; return; }
      setMessage(data.error || 'Checkout is not configured yet.');
    } catch {
      setMessage('Checkout is temporarily unavailable. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="pricing-page">
      <div className="pricing-shell shell">
        <div className="dashboard-top"><a className="brand" href="/">FileForge</a><a className="back-link" href="/">← Home</a></div>
        <div className="pricing-head"><span className="section-kicker">Simple pricing</span><h1>Choose the plan that fits your PDFs.</h1><p>Start free. Upgrade only when you need more capacity.</p></div>
        <div className="pricing-grid">
          <article className="price-card"><span className="plan-tag">FREE</span><h2>$0</h2><p className="price-note">For occasional use</p><ul><li>3 successful jobs per day (compression or conversion)</li><li>Up to 500 MB upload size</li><li>All compression modes</li><li>Ads may appear</li></ul><a className="secondary inline-cta" href="/login">Create free account</a></article>
          <article className="price-card featured"><span className="plan-tag">PRO</span><h2>$4.99 <small>/ month</small></h2><p className="price-note">For frequent PDF work</p><ul><li>Higher / unlimited daily use</li><li>Up to 500 MB upload size</li><li>All compression modes</li><li>Ad-free experience</li><li>Stripe billing portal</li></ul><button className="primary" onClick={checkout} disabled={busy}>{busy ? 'Opening checkout…' : 'Upgrade to Pro'}</button></article>
        </div>
        {message && <p className="notice error">{message}</p>}
        <p className="fine-print">Payments are handled by Stripe. You can cancel or manage your subscription from your account.</p>
      </div>
    </main>
  );
}

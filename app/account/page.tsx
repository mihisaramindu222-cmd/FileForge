import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import AccountActions from '@/components/account-actions';
import AdSlot from '@/components/ad-slot';

export const dynamic = 'force-dynamic';

export default async function AccountPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');
  const { data: profile } = await supabase.from('profiles').select('plan, role, subscription_status, current_period_end').eq('id', user.id).single();
  const plan = profile?.plan === 'pro' ? 'Pro' : 'Free';
  return (
    <main className="dashboard-page">
      <div className="dashboard shell">
        <div className="dashboard-top"><div className="dashboard-nav-left"><a className="brand" href="/" aria-label="FileForge home"><span className="brand-mark">F</span><span>FileForge</span></a><a className="back-link dashboard-back" href="/">← Back to FileForge</a></div><AccountActions /></div>
        <div className="dashboard-hero"><span className="section-kicker">Your account</span><h1>Hello{user.email ? `, ${user.email}` : ''}.</h1><p>Manage your plan and billing from one place.</p></div>
        <div className="stats-grid">
          <div className="stat-card"><span>Plan</span><strong>{plan}</strong><small>{plan === 'Free' ? '3 jobs per day' : 'Premium access'}</small></div>
          <div className="stat-card"><span>Subscription</span><strong>{profile?.subscription_status || '—'}</strong><small>{profile?.current_period_end ? `Renews ${new Date(profile.current_period_end).toLocaleDateString()}` : 'No active subscription'}</small></div>
          <div className="stat-card"><span>Role</span><strong>{profile?.role === 'admin' ? 'Admin' : 'Member'}</strong><small>{profile?.role === 'admin' ? 'Full site management access' : 'Standard account'}</small></div>
        </div>
        <div className="dashboard-card"><h2>Billing</h2><p>{plan === 'Pro' ? 'Your Pro subscription is active. Manage billing, payment method, or cancellation securely through Stripe.' : 'Upgrade to Pro for higher limits, 500 MB uploads, and an ad-free experience.'}</p><div className="button-row">{plan === 'Pro' ? <AccountActions portalOnly /> : <a className="primary inline-cta" href="/pricing">Upgrade to Pro</a>}{profile?.role === 'admin' && <a className="secondary inline-cta" href="/admin">Open Admin Dashboard</a>}</div></div>
        <AdSlot className="dashboard-ad" hideForPro />
      </div>
    </main>
  );
}

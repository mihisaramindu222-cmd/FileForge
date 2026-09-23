import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import AccountActions from '@/components/account-actions';

export const dynamic = 'force-dynamic';

export default async function AccountPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');
  if (user.is_anonymous) redirect('/');
  const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).single();
  return (
    <main className="dashboard-page">
      <div className="dashboard shell">
        <div className="dashboard-top"><div className="dashboard-nav-left"><a className="brand" href="/" aria-label="FileForge home"><span className="brand-mark">F</span><span>FileForge</span></a><a className="back-link dashboard-back" href="/">← Back to FileForge</a></div><AccountActions /></div>
        <div className="dashboard-hero"><span className="section-kicker">Your account</span><h1>Hello{user.email ? `, ${user.email}` : ''}.</h1><p>Your FileForge account is ready. All FileForge tools are currently free.</p></div>
        <div className="stats-grid">
          <div className="stat-card"><span>Plan</span><strong>Free</strong><small>Unlimited daily jobs</small></div>
          <div className="stat-card"><span>Upload limit</span><strong>500 MB</strong><small>Maximum file size</small></div>
          <div className="stat-card"><span>Role</span><strong>{profile?.role === 'admin' ? 'Admin' : 'Member'}</strong><small>{profile?.role === 'admin' ? 'Full site management access' : 'Standard account'}</small></div>
        </div>
        <div className="dashboard-card"><h2>Free forever</h2><p>All FileForge tools are available without a paid subscription. You get unlimited daily jobs and uploads up to 500 MB.</p><div className="button-row">{profile?.role === 'admin' && <a className="secondary inline-cta" href="/admin">Open Admin Dashboard</a>}<a className="primary inline-cta" href="/#tools">Use FileForge tools</a></div></div>
      </div>
    </main>
  );
}

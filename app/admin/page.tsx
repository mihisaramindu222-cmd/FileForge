import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';

export const dynamic = 'force-dynamic';

type AdminDashboard = {
  total_users?: number;
  recent_usage?: Array<{ usage_date: string; count: number }>;
};

export default async function AdminPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login?next=/admin');

  const { data: me } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single();

  if (me?.role !== 'admin') redirect('/account');

  const adminClient = createAdminClient();
  const { data, error } = await adminClient.rpc('get_admin_dashboard', { p_user_id: user.id });
  if (error) {
    console.error('Could not load admin dashboard.', error);
    throw new Error('Could not load the admin dashboard.');
  }

  const dashboard = (data ?? {}) as AdminDashboard;
  const recentUsage = Array.isArray(dashboard.recent_usage) ? dashboard.recent_usage : [];

  return (
    <main className="admin-page">
      <div className="admin-shell shell">
        <div className="dashboard-top">
          <a className="brand" href="/">FileForge</a>
          <a className="back-link" href="/account">← Account</a>
        </div>

        <div className="dashboard-hero">
          <span className="section-kicker">Admin only</span>
          <h1>FileForge dashboard</h1>
          <p>Site usage and account activity.</p>
        </div>

        <div className="stats-grid">
          <div className="stat-card">
            <span>Total users</span>
            <strong>{dashboard.total_users ?? 0}</strong>
            <small>Registered accounts</small>
          </div>
          <div className="stat-card">
            <span>Upload limit</span>
            <strong>500 MB</strong>
            <small>Maximum file size</small>
          </div>
          <div className="stat-card">
            <span>Service</span>
            <strong>Free</strong>
            <small>Unlimited daily jobs</small>
          </div>
        </div>

        <section className="dashboard-card">
          <div className="section-header">
            <div>
              <span className="section-kicker">Usage</span>
              <h2>Recent daily usage</h2>
            </div>
          </div>
          <div className="mini-list">
            {recentUsage.length ? recentUsage.map((row) => (
              <div key={row.usage_date}>
                <span>{row.usage_date}</span>
                <strong>{row.count}</strong>
              </div>
            )) : (
              <div>
                <span>No completed jobs recorded yet.</span>
                <strong>0</strong>
              </div>
            )}
          </div>
        </section>
      </div>
    </main>
  );
}

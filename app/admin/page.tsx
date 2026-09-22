import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';

export const dynamic = 'force-dynamic';

export default async function AdminPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login?next=/admin');
  const { data: me } = await supabase.from('profiles').select('role').eq('id', user.id).single();
  if (me?.role !== 'admin') redirect('/account');

  const admin = createAdminClient();
  const [{ count: users }, { count: proCount }, { data: proUsers }, { data: recentUsage }, { data: recentEvents }] = await Promise.all([
    admin.from('profiles').select('*', { count: 'exact', head: true }),
    admin.from('profiles').select('*', { count: 'exact', head: true }).eq('plan', 'pro'),
    admin.from('profiles').select('id, email, plan, subscription_status, current_period_end').eq('plan', 'pro').order('current_period_end', { ascending: false }).limit(20),
    admin.from('usage_daily').select('usage_date, count').order('usage_date', { ascending: false }).limit(14),
    admin.from('billing_events').select('event_type, amount_total, currency, created_at').eq('event_type', 'invoice.payment_succeeded').order('created_at', { ascending: false }).limit(20),
  ]);

  const revenue = (recentEvents ?? []).reduce((sum, row) => sum + Number(row.amount_total || 0), 0) / 100;
  return (
    <main className="admin-page"><div className="admin-shell shell">
      <div className="dashboard-top"><a className="brand" href="/">FileForge</a><a className="back-link" href="/account">← Account</a></div>
      <div className="dashboard-hero"><span className="section-kicker">Admin only</span><h1>FileForge dashboard</h1><p>Users, subscriptions and compression activity.</p></div>
      <div className="stats-grid"><div className="stat-card"><span>Total users</span><strong>{users ?? 0}</strong><small>Registered accounts</small></div><div className="stat-card"><span>Active Pro users</span><strong>{proCount ?? 0}</strong><small>Recent active subscriptions</small></div><div className="stat-card"><span>Recent revenue</span><strong>${revenue.toFixed(2)}</strong><small>Recorded successful invoice payments</small></div></div>
      <section className="dashboard-card"><div className="section-header"><div><span className="section-kicker">Subscribers</span><h2>Pro accounts</h2></div></div><div className="table-wrap"><table><thead><tr><th>Email</th><th>Status</th><th>Renewal</th></tr></thead><tbody>{(proUsers ?? []).map(row => <tr key={row.id}><td>{row.email || row.id.slice(0,8)}</td><td>{row.subscription_status || 'active'}</td><td>{row.current_period_end ? new Date(row.current_period_end).toLocaleDateString() : '—'}</td></tr>)}</tbody></table></div></section>
      <div className="admin-two-col"><section className="dashboard-card"><h2>Daily usage</h2><div className="mini-list">{(recentUsage ?? []).map(row => <div key={row.usage_date}><span>{row.usage_date}</span><strong>{row.count}</strong></div>)}</div></section><section className="dashboard-card"><h2>Billing events</h2><div className="mini-list">{(recentEvents ?? []).map((row, i) => <div key={`${row.created_at}-${i}`}><span>{row.event_type}</span><strong>{row.amount_total && row.currency ? `${row.currency.toUpperCase()} ${(Number(row.amount_total)/100).toFixed(2)}` : '—'}</strong></div>)}</div></section></div>
    </div></main>
  );
}

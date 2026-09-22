import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export const runtime = 'nodejs';

export async function POST() {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Please log in first.' }, { status: 401 });
    const { data: profile } = await supabase.from('profiles').select('stripe_customer_id').eq('id', user.id).single();
    if (!profile?.stripe_customer_id) return NextResponse.json({ error: 'No Stripe customer is linked to this account.' }, { status: 400 });
    const key = process.env.STRIPE_SECRET_KEY;
    const siteUrl = process.env.NEXT_PUBLIC_SITE_URL;
    if (!key || !siteUrl) return NextResponse.json({ error: 'Stripe billing is not configured yet.' }, { status: 503 });
    const body = new URLSearchParams({ customer: profile.stripe_customer_id, return_url: `${siteUrl}/account` });
    const response = await fetch('https://api.stripe.com/v1/billing_portal/sessions', {
      method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/x-www-form-urlencoded' }, body, cache: 'no-store'
    });
    const data = await response.json().catch(() => null);
    if (!response.ok || !data?.url) return NextResponse.json({ error: 'Could not open the billing portal.' }, { status: 502 });
    return NextResponse.json({ url: data.url }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    console.error('Stripe portal failed.', error);
    return NextResponse.json({ error: 'Billing is temporarily unavailable. Please try again later.' }, { status: 500 });
  }
}

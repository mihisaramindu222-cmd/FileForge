import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export const runtime = 'nodejs';

function stripeSecret() {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error('Stripe is not configured.');
  return key;
}

export async function POST() {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Please log in first.' }, { status: 401 });
    const { data: profile } = await supabase.from('profiles').select('plan, stripe_customer_id').eq('id', user.id).single();
    if (profile?.plan === 'pro') return NextResponse.json({ error: 'Your account is already on Pro.' }, { status: 400 });

    const price = process.env.STRIPE_PRICE_ID;
    const siteUrl = process.env.NEXT_PUBLIC_SITE_URL;
    if (!price || !siteUrl) return NextResponse.json({ error: 'Stripe checkout is not configured yet.' }, { status: 503 });

    const body = new URLSearchParams();
    body.set('mode', 'subscription');
    body.set('line_items[0][price]', price);
    body.set('line_items[0][quantity]', '1');
    body.set('customer_email', user.email || '');
    body.set('success_url', `${siteUrl}/account?billing=success`);
    body.set('cancel_url', `${siteUrl}/pricing?billing=cancelled`);
    body.set('allow_promotion_codes', 'true');
    body.set('metadata[user_id]', user.id);
    body.set('subscription_data[metadata][user_id]', user.id);
    if (profile?.stripe_customer_id) { body.delete('customer_email'); body.set('customer', profile.stripe_customer_id); }

    const response = await fetch('https://api.stripe.com/v1/checkout/sessions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${stripeSecret()}`, 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
      cache: 'no-store',
    });
    const data = await response.json();
    if (!response.ok) return NextResponse.json({ error: data?.error?.message || 'Stripe checkout failed.' }, { status: 502 });
    return NextResponse.json({ url: data.url }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    console.error('Stripe checkout failed.', error);
    return NextResponse.json({ error: 'Checkout is temporarily unavailable. Please try again later.' }, { status: 500 });
  }
}

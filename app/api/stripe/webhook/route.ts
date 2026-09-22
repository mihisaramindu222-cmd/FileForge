import crypto from 'node:crypto';
import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';

export const runtime = 'nodejs';
type StripeObject = {
  metadata?: { user_id?: string };
  subscription_details?: { metadata?: { user_id?: string } };
  amount_total?: number; currency?: string; customer?: string; subscription?: string | { id?: string };
  payment_status?: 'paid' | 'unpaid' | 'no_payment_required';
  amount_paid?: number;
  id?: string; status?: string; current_period_end?: number;
};

function verifyStripeSignature(rawBody: string, signature: string, secret: string) {
  const parts = signature.split(',');
  const timestamp = parts.find(x => x.startsWith('t='))?.slice(2);
  const candidates = parts.filter(x => x.startsWith('v1=')).map(x => x.slice(3));
  if (!timestamp || !candidates.length) return false;
  const age = Math.abs(Math.floor(Date.now()/1000) - Number(timestamp));
  if (!Number.isFinite(age) || age > 300) return false;
  const payload = `${timestamp}.${rawBody}`;
  const expected = crypto.createHmac('sha256', secret).update(payload).digest('hex');
  return candidates.some(candidate => {
    try { return crypto.timingSafeEqual(Buffer.from(candidate, 'hex'), Buffer.from(expected, 'hex')); } catch { return false; }
  });
}

export async function POST(request: Request) {
  const rawBody = await request.text();
  const signature = request.headers.get('stripe-signature');
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!signature || !secret || !verifyStripeSignature(rawBody, signature, secret)) return NextResponse.json({ error: 'Invalid signature.' }, { status: 400 });

  let event: { id?: string; type?: string; data?: { object?: StripeObject } };
  try { event = JSON.parse(rawBody); } catch { return NextResponse.json({ error: 'Invalid event payload.' }, { status: 400 }); }
  if (!event.id || !event.type) return NextResponse.json({ error: 'Invalid event payload.' }, { status: 400 });
  const admin = createAdminClient();
  const payload: StripeObject = event.data?.object || {};
  const userId = payload.metadata?.user_id || payload.subscription_details?.metadata?.user_id;

  const { error: eventError } = await admin.from('billing_events').upsert({
    event_id: event.id,
    event_type: event.type,
    user_id: userId || null,
    amount_total: event.type === 'invoice.payment_succeeded' ? (payload.amount_paid ?? payload.amount_total ?? 0) : 0,
    currency: payload.currency || null,
    created_at: new Date().toISOString(),
  }, { onConflict: 'event_id' });
  if (eventError) {
    console.error('Could not record Stripe webhook event.', eventError);
    return NextResponse.json({ error: 'Could not record webhook event.' }, { status: 500 });
  }

  if (event.type === 'checkout.session.completed' && userId) {
    const paymentConfirmed = payload.payment_status === 'paid' || payload.payment_status === 'no_payment_required';
    const values = {
      stripe_customer_id: payload.customer || null,
      stripe_subscription_id: typeof payload.subscription === 'string' ? payload.subscription : null,
      ...(paymentConfirmed ? { plan: 'pro', subscription_status: 'active' } : { subscription_status: 'incomplete' }),
    };
    const { error } = await admin.from('profiles').update(values).eq('id', userId);
    if (error) return NextResponse.json({ error: 'Could not update subscription.' }, { status: 500 });
  } else if (event.type === 'checkout.session.async_payment_succeeded' && userId) {
    const { error } = await admin.from('profiles').update({ plan: 'pro', subscription_status: 'active', stripe_customer_id: payload.customer || null, stripe_subscription_id: typeof payload.subscription === 'string' ? payload.subscription : null }).eq('id', userId);
    if (error) return NextResponse.json({ error: 'Could not update subscription.' }, { status: 500 });
  } else if (event.type === 'customer.subscription.updated' || event.type === 'customer.subscription.created') {
    const customerId = payload.customer;
    const status = payload.status ?? 'unknown';
    const values = { stripe_customer_id: customerId, stripe_subscription_id: payload.id, subscription_status: status, plan: ['active','trialing','past_due'].includes(status) ? 'pro' : 'free', current_period_end: payload.current_period_end ? new Date(payload.current_period_end * 1000).toISOString() : null };
    const { error } = userId
      ? await admin.from('profiles').update(values).eq('id', userId)
      : customerId
        ? await admin.from('profiles').update(values).eq('stripe_customer_id', customerId)
        : { error: null };
    if (error) return NextResponse.json({ error: 'Could not update subscription.' }, { status: 500 });
  } else if (event.type === 'customer.subscription.deleted') {
    const { error } = await admin.from('profiles').update({ plan: 'free', subscription_status: 'canceled', current_period_end: null }).eq('stripe_subscription_id', payload.id);
    if (error) return NextResponse.json({ error: 'Could not update subscription.' }, { status: 500 });
  }

  return NextResponse.json({ received: true });
}

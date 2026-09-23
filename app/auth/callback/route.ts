import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

function getPublicOrigin(request: Request) {
  const configured = process.env.NEXT_PUBLIC_SITE_URL?.trim();
  if (configured && /^https:\/\/[^/]+$/i.test(configured)) return configured.replace(/\/$/, '');

  const productionHost = process.env.VERCEL_PROJECT_PRODUCTION_URL?.trim();
  if (productionHost && !/^(localhost|127\\.0\\.1)(:\\d+)?$/i.test(productionHost)) {
    return `https://${productionHost.replace(/^https?:\\/\\//, '').replace(/\\/$/, '')}`;
  }

  const forwardedHost = request.headers.get('x-forwarded-host')?.split(',')[0]?.trim()
    || request.headers.get('host')?.split(',')[0]?.trim();
  const forwardedProto = request.headers.get('x-forwarded-proto')?.split(',')[0]?.trim() || 'https';
  if (forwardedHost && !/^(localhost|127\\.0\\.0\\.1|0\\.0\\.0\\.0)(:\\d+)?$/i.test(forwardedHost)) {
    return `${forwardedProto}://${forwardedHost}`;
  }

  return 'https://fileforge-final-deploy.vercel.app';
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const publicOrigin = getPublicOrigin(request);
  const code = url.searchParams.get('code');
  const requestedNext = url.searchParams.get('next');
  const next = requestedNext?.startsWith('/') && !requestedNext.startsWith('//') ? requestedNext : '/account';
  const oauthError = url.searchParams.get('error_description') || url.searchParams.get('error');
  if (!code) {
    const message = oauthError ? oauthError.slice(0, 180) : 'Google authentication did not return a valid authorization code.';
    return NextResponse.redirect(new URL(`/login?error=${encodeURIComponent(message)}`, publicOrigin));
  }
  const supabase = await createClient();
  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) return NextResponse.redirect(new URL(`/login?error=${encodeURIComponent('Authentication callback failed. Please try again.')}`, publicOrigin));
  return NextResponse.redirect(new URL(next, publicOrigin));
}

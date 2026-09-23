import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const requestedNext = url.searchParams.get('next');
  const next = requestedNext?.startsWith('/') && !requestedNext.startsWith('//') ? requestedNext : '/account';
  const oauthError = url.searchParams.get('error_description') || url.searchParams.get('error');
  if (!code) {
    const message = oauthError ? oauthError.slice(0, 180) : 'Google authentication did not return a valid authorization code.';
    return NextResponse.redirect(new URL(`/login?error=${encodeURIComponent(message)}`, url.origin));
  }
  const supabase = await createClient();
  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) return NextResponse.redirect(new URL(`/login?error=${encodeURIComponent('Authentication callback failed. Please try again.')}`, url.origin));
  return NextResponse.redirect(new URL(next, url.origin));
}

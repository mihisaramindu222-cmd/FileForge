'use client';

import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';

export default function AuthNav() {
  const [email, setEmail] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    let supabase: ReturnType<typeof createClient>;

    try {
      supabase = createClient();
    } catch (error) {
      console.error('Supabase client is not configured for the public site.', error);
      return;
    }

    supabase.auth.getUser().then(({ data }) => {
      if (active) setEmail(data.user?.email ?? null);
    }).catch((error) => {
      console.error('Could not load the current auth session.', error);
    });

    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      if (active) setEmail(session?.user?.email ?? null);
    });

    return () => {
      active = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  async function logout() {
    try {
      await createClient().auth.signOut();
    } catch (error) {
      console.error('Could not sign out.', error);
    } finally {
      window.location.href = '/';
    }
  }

  return email ? (
    <div className="nav-user">
      <a href="/account">Account</a>
      <button className="nav-link-button" onClick={logout} type="button">Log out</button>
    </div>
  ) : (
    <div className="nav-user">
      <a href="/pricing">Plans</a>
      <a className="nav-cta" href="/login">Log in</a>
    </div>
  );
}

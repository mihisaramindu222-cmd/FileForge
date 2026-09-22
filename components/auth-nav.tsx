'use client';

import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';

export default function AuthNav() {
  const [email, setEmail] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    const supabase = createClient();
    supabase.auth.getUser().then(({ data }) => {
      if (active) setEmail(data.user?.email ?? null);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      setEmail(session?.user?.email ?? null);
    });
    return () => { active = false; sub.subscription.unsubscribe(); };
  }, []);

  async function logout() {
    await createClient().auth.signOut();
    window.location.href = '/';
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

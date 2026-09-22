'use client';

import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';

type Props = { slot?: string; className?: string; hideForPro?: boolean };

export default function AdSlot({ slot = process.env.NEXT_PUBLIC_ADSENSE_SLOT_ID, className = '', hideForPro = true }: Props) {
  const client = process.env.NEXT_PUBLIC_ADSENSE_CLIENT_ID;
  const [checkedPlan, setCheckedPlan] = useState(!hideForPro);
  const [isPro, setIsPro] = useState(false);

  useEffect(() => {
    if (!hideForPro) return;

    let active = true;
    let supabase: ReturnType<typeof createClient>;

    try {
      supabase = createClient();
    } catch (error) {
      console.error('Supabase client is not configured for AdSlot.', error);
      if (active) setCheckedPlan(true);
      return;
    }

    supabase.auth.getUser().then(async ({ data }) => {
      if (!active) return;
      if (!data.user) {
        setCheckedPlan(true);
        return;
      }

      try {
        const { data: profile } = await supabase
          .from('profiles')
          .select('plan')
          .eq('id', data.user.id)
          .single();

        if (active) {
          setIsPro(profile?.plan === 'pro');
          setCheckedPlan(true);
        }
      } catch (error) {
        console.error('Could not load the user plan for AdSlot.', error);
        if (active) setCheckedPlan(true);
      }
    }).catch((error) => {
      console.error('Could not load the current auth session for AdSlot.', error);
      if (active) setCheckedPlan(true);
    });

    return () => {
      active = false;
    };
  }, [hideForPro]);

  useEffect(() => {
    if (!client || !slot || !checkedPlan || isPro) return;
    try {
      // @ts-expect-error adsbygoogle is provided by Google AdSense at runtime.
      (window.adsbygoogle = window.adsbygoogle || []).push({});
    } catch {
      // AdSense may not be approved/loaded yet.
    }
  }, [checkedPlan, client, slot, isPro]);

  if (hideForPro && !checkedPlan) return null;
  if (isPro) return null;
  if (!client || !slot) return <div className={'ad-placeholder ' + className} aria-hidden="true">Advertisement</div>;

  return (
    <div className={'ad-wrap ' + className}>
      <ins className="adsbygoogle" style={{ display: 'block' }} data-ad-client={client} data-ad-slot={slot} data-ad-format="auto" data-full-width-responsive="true" />
    </div>
  );
}

import crypto from 'node:crypto';
import { createAdminClient } from '@/lib/supabase/admin';

export async function allowSharedRateLimit(scope: string, ip: string, maxRequests: number, windowSeconds: number) {
  const bucket = crypto.createHash('sha256').update(`${scope}:${ip}`).digest('hex');
  try {
    const admin = createAdminClient();
    const { data, error } = await admin.rpc('check_rate_limit', {
      p_bucket: bucket,
      p_max_requests: maxRequests,
      p_window_seconds: windowSeconds,
    });
    if (error) {
      console.error('Shared rate limit check failed.', error);
      return true;
    }
    return Boolean(data?.allowed);
  } catch (error) {
    console.error('Shared rate limit check failed.', error);
    return true;
  }
}

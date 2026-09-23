import crypto from 'node:crypto';
import { createAdminClient } from '@/lib/supabase/admin';

type LocalBucket = {
  startedAt: number;
  count: number;
};

const localBuckets = new Map<string, LocalBucket>();

function localRateLimit(scope: string, ip: string, maxRequests: number, windowSeconds: number) {
  const bucket = crypto.createHash('sha256').update(scope + ':' + ip).digest('hex');
  const now = Date.now();
  const existing = localBuckets.get(bucket);

  if (!existing || now - existing.startedAt >= windowSeconds * 1000) {
    localBuckets.set(bucket, { startedAt: now, count: 1 });
  } else {
    existing.count += 1;
    if (existing.count > maxRequests) return false;
  }

  // Best-effort pruning so a long-lived container does not retain old IP buckets forever.
  if (localBuckets.size > 5000) {
    for (const [key, value] of localBuckets) {
      if (now - value.startedAt >= windowSeconds * 1000) localBuckets.delete(key);
      if (localBuckets.size <= 4000) break;
    }
  }

  return true;
}

export async function allowSharedRateLimit(scope: string, ip: string, maxRequests: number, windowSeconds: number) {
  const serverSecret = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;

  // The database-backed limiter is preferred when the private Supabase server secret
  // is configured. One-click deployments can still protect public endpoints with a
  // per-container fallback instead of generating a repeated configuration error.
  if (!serverSecret) return localRateLimit(scope, ip, maxRequests, windowSeconds);

  const bucket = crypto.createHash('sha256').update(scope + ':' + ip).digest('hex');

  try {
    const admin = createAdminClient();
    const { data, error } = await admin.rpc('check_rate_limit', {
      p_bucket: bucket,
      p_max_requests: maxRequests,
      p_window_seconds: windowSeconds,
    });
    if (error) {
      console.error('Shared rate limit check failed; using local fallback.', error);
      return localRateLimit(scope, ip, maxRequests, windowSeconds);
    }
    return Boolean(data?.allowed);
  } catch (error) {
    console.error('Shared rate limit check failed; using local fallback.', error);
    return localRateLimit(scope, ip, maxRequests, windowSeconds);
  }
}

import crypto from 'node:crypto';

function secret() {
  // Prefer the dedicated signing secret. For one-click deployments, fall back
  // to a private server secret already required by the app.
  const value =
    process.env.DOWNLOAD_SIGNING_SECRET ||
    process.env.BLOB_READ_WRITE_TOKEN ||
    process.env.SUPABASE_SECRET_KEY ||
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    '';

  if (value.length < 32) {
    throw new Error('A server-side signing secret is not configured.');
  }
  return value;
}

function payload(pathname: string, filename: string, expiresAt: number) {
  return `${pathname}\n${filename}\n${expiresAt}`;
}

export function signDownload(pathname: string, filename: string, expiresAt: number) {
  return crypto.createHmac('sha256', secret()).update(payload(pathname, filename, expiresAt)).digest('base64url');
}

export function verifyDownload(pathname: string, filename: string, expiresAt: number, signature: string) {
  if (!Number.isSafeInteger(expiresAt) || expiresAt <= Date.now()) return false;
  const expected = signDownload(pathname, filename, expiresAt);
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
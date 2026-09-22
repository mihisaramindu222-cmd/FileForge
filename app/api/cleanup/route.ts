import { del, list } from '@vercel/blob';
import { NextResponse } from 'next/server';

export const runtime = 'nodejs';

const FILE_TTL_MS = 60 * 60 * 1000;

export async function GET(request: Request) {
  const expected = process.env.CRON_SECRET;
  const auth = request.headers.get('authorization');
  if (!expected || auth !== `Bearer ${expected}`) {
    return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });
  }

  let cursor: string | undefined;
  let scanned = 0;
  let deleted = 0;
  const cutoff = Date.now() - FILE_TTL_MS;

  do {
    const page = await list({ prefix: 'fileforge/', limit: 1000, cursor });
    scanned += page.blobs.length;
    const expired = page.blobs.filter((blob) => blob.uploadedAt.getTime() < cutoff).map((blob) => blob.pathname);
    if (expired.length) {
      await del(expired);
      deleted += expired.length;
    }
    cursor = page.hasMore ? page.cursor : undefined;
  } while (cursor);

  return NextResponse.json({ ok: true, scanned, deleted });
}

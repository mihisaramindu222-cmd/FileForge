import { get } from '@vercel/blob';
import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { verifyDownload } from '@/lib/download-token';

export const runtime = 'nodejs';
export const maxDuration = 60;

function safeFilename(value: string) {
  const clean = value.replace(/[\\/\r\n"]/g, '_').replace(/[^A-Za-z0-9._ -]/g, '_').trim();
  return clean.slice(0, 180) || 'download';
}

function isOwnedOutput(pathname: string, userId: string) {
  const parts = pathname.split('/');
  return parts.length === 4
    && parts[0] === 'fileforge'
    && parts[1] === userId
    && /^[0-9a-f-]{36}$/i.test(parts[2])
    && /^output\.[A-Za-z0-9]{1,8}$/i.test(parts[3]);
}

export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Please log in to download this file.' }, { status: 401 });

  const pathname = request.nextUrl.searchParams.get('pathname') || '';
  const filename = safeFilename(request.nextUrl.searchParams.get('filename') || 'download');
  const expiresAt = Number(request.nextUrl.searchParams.get('expires') || 0);
  const signature = request.nextUrl.searchParams.get('sig') || '';
  if (!isOwnedOutput(pathname, user.id)) return NextResponse.json({ error: 'Invalid download reference.' }, { status: 403 });
  try {
    if (!verifyDownload(pathname, filename, expiresAt, signature)) return NextResponse.json({ error: 'This download link has expired or is invalid. Please run the conversion again.' }, { status: 410 });
  } catch {
    return NextResponse.json({ error: 'Download links are temporarily unavailable. Please try again later.' }, { status: 503 });
  }

  try {
    const stored = await get(pathname, { access: 'private', useCache: false });
    if (!stored || stored.statusCode !== 200 || !stored.stream) {
      return NextResponse.json({ error: 'This file is no longer available. Please run the conversion again.' }, { status: 404 });
    }

    const asciiFallback = filename.replace(/[^\x20-\x7E]/g, '_').replace(/"/g, '_') || 'download';
    const encodedFilename = encodeURIComponent(filename).replace(/['()]/g, escape);
    const headers = new Headers({
      'Content-Type': stored.blob.contentType || 'application/octet-stream',
      'Content-Length': String(stored.blob.size),
      'Content-Disposition': `attachment; filename="${asciiFallback}"; filename*=UTF-8''${encodedFilename}`,
      'Cache-Control': 'private, no-store, max-age=0',
      'X-Content-Type-Options': 'nosniff',
    });
    return new Response(stored.stream, { status: 200, headers });
  } catch {
    return NextResponse.json({ error: 'The download could not be started. Please run the conversion again.' }, { status: 500 });
  }
}

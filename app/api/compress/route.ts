import { del, get, put } from '@vercel/blob';
import { promises as fs } from 'node:fs';
import { createReadStream } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { compressPdf, ConverterError, MAX_UPLOAD_BYTES, MAX_UPLOAD_MB, parseLevel, parseTarget, type InputStreamFactory } from '@/lib/converters';
import { signDownload } from '@/lib/download-token';

import { allowSharedRateLimit } from '@/lib/rate-limit';

function safeFilename(value: unknown) {
  const raw = typeof value === 'string' ? value : 'download';
  const cleaned = raw.replace(/[\\/\r\n"< >|:*?]/g, '_').replace(/[^A-Za-z0-9._ -]/g, '_').slice(0, 120);
  return cleaned || 'download';
}

export const runtime = 'nodejs';
export const maxDuration = 300;

function isOwnedPath(pathname: string, userId: string) {
  const parts = pathname.split('/');
  return parts.length === 4
    && parts[0] === 'fileforge'
    && parts[1] === userId
    && parts[2].length > 0
    && parts[3] === 'input.pdf';
}

export async function POST(request: Request) {
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
  if (!(await allowSharedRateLimit('compress', ip, 8, 60))) return NextResponse.json({ error: 'Too many compression requests. Please wait one minute and try again.' }, { status: 429, headers: { 'Retry-After': '60' } });

  let inputPathname = '';
  let userId = '';
  let jobStarted = false;
  let outputPathname = '';
  let workDir = '';
  let localOutputPath = '';
  let adminClient: ReturnType<typeof createAdminClient> | null = null;

  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Please log in to compress a PDF.' }, { status: 401 });
    userId = user.id;
    adminClient = createAdminClient();

    const body = await request.json() as { pathname?: unknown; filename?: unknown; level?: unknown; target?: unknown };
    inputPathname = typeof body.pathname === 'string' ? body.pathname : '';
    if (!inputPathname || !isOwnedPath(inputPathname, user.id)) {
      return NextResponse.json({ error: 'Invalid upload reference.' }, { status: 400 });
    }

    const level = parseLevel(typeof body.level === 'string' ? body.level : null);
    const target = parseTarget(typeof body.target === 'string' ? body.target : null);
    const originalFilename = typeof body.filename === 'string' ? body.filename : 'document.pdf';

    const { data: startJob, error: startError } = await adminClient.rpc('start_compression_job', { p_user_id: user.id });
    if (startError) return NextResponse.json({ error: 'Could not start your compression job.' }, { status: 500 });
    if (startJob?.reason === 'busy') {
      return NextResponse.json({ error: 'A compression job is already running for your account. Please wait for it to finish.' }, { status: 409 });
    }
    jobStarted = true;

    const stored = await get(inputPathname, { access: 'private', useCache: false });
    if (!stored || stored.statusCode !== 200 || !stored.stream || !Number.isSafeInteger(stored.blob.size) || stored.blob.size < 1) {
      throw new ConverterError('The uploaded PDF is no longer available. Please upload it again.', 410);
    }

    if (stored.blob.size > MAX_UPLOAD_BYTES) {
      throw new ConverterError(`This PDF exceeds the ${MAX_UPLOAD_MB} MB FileForge limit.`, 413);
    }

    const inputSize = stored.blob.size;
    await stored.stream.cancel().catch(() => undefined);
    const inputStreamFactory: InputStreamFactory = async () => {
      const fresh = await get(inputPathname, { access: 'private', useCache: false });
      if (!fresh || fresh.statusCode !== 200 || !fresh.stream) {
        throw new ConverterError('The uploaded PDF is no longer available. Please upload it again.', 410);
      }
      return fresh.stream;
    };

    workDir = await fs.mkdtemp(path.join(os.tmpdir(), 'fileforge-'));
    const output = await compressPdf(inputSize, inputStreamFactory, workDir, level, target);
    localOutputPath = output.outputPath;
    outputPathname = `fileforge/${user.id}/${crypto.randomUUID()}/output.pdf`;

    const outputSource = localOutputPath
      ? createReadStream(/* turbopackIgnore: true */ localOutputPath)
      : (await inputStreamFactory());
    const outputBlob = await put(outputPathname, outputSource, {
      access: 'private',
      addRandomSuffix: false,
      contentType: 'application/pdf',
      cacheControlMaxAge: 60,
      multipart: true,
    });

    const downloadExpiresAt = Date.now() + 60 * 60 * 1000;
    const downloadFilename = safeFilename(originalFilename);
    const downloadSignature = signDownload(outputBlob.pathname, downloadFilename, downloadExpiresAt);
    const downloadUrl = `/api/download?pathname=${encodeURIComponent(outputBlob.pathname)}&filename=${encodeURIComponent(downloadFilename)}&expires=${downloadExpiresAt}&sig=${encodeURIComponent(downloadSignature)}`;

    const { data: finishJob, error: finishError } = await adminClient.rpc('finish_compression_job', { p_user_id: user.id });
    if (finishError) {
      await del(outputBlob.pathname);
      try { await del(inputPathname); } catch { /* best-effort cleanup */ }
      try { await adminClient?.rpc('release_compression_job', { p_user_id: user.id }); } catch { /* best effort */ }
      jobStarted = false;
      return NextResponse.json({ error: 'Could not record your compression usage.' }, { status: 500 });
    }
    if (!finishJob?.allowed) {
      await del(outputBlob.pathname);
      await del(inputPathname);
      jobStarted = false;
      return NextResponse.json({ error: 'The compression job could not be recorded. Please try again.' }, { status: 500 });
    }
    jobStarted = false;

    try { await del(inputPathname); } catch { /* best-effort cleanup */ }
    if (workDir) await fs.rm(workDir, { recursive: true, force: true }).catch(() => undefined);

    return NextResponse.json({
      downloadUrl,
      inputBytes: output.inputBytes,
      outputBytes: output.outputBytes,
      outputFilename: downloadFilename,
      targetReached: output.targetReached,
      level: output.level,
      expiresAt: downloadExpiresAt,
    }, {
      headers: {
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  } catch (error) {
    if (userId && jobStarted) {
      try {
        await adminClient?.rpc('release_compression_job', { p_user_id: userId });
      } catch {
        // Expiring DB locks prevent a failed request from blocking a user forever.
      }
    }

    if (outputPathname) {
      try { await del(outputPathname); } catch { /* best-effort cleanup */ }
    }

    if (inputPathname) {
      try { await del(inputPathname); } catch { /* best-effort cleanup */ }
    }
    if (workDir) await fs.rm(workDir, { recursive: true, force: true }).catch(() => undefined);

    if (error instanceof ConverterError) return NextResponse.json({ error: error.message }, { status: error.status });
    return NextResponse.json({ error: 'Compression could not be completed. Your original file is unchanged; please try again.' }, { status: 500 });
  }
}

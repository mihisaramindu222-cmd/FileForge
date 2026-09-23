import { del, get, put } from '@vercel/blob';
import { promises as fs, createReadStream } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { convertFile, downloadInput, getConversion, ConverterError, MAX_UPLOAD_BYTES, MAX_UPLOAD_MB } from '@/lib/converters';
import type { ConversionId } from '@/lib/converters/types';
import { signDownload } from '@/lib/download-token';

import { allowSharedRateLimit } from '@/lib/rate-limit';
export const runtime = 'nodejs';
export const maxDuration = 300;

function isOwnedInput(pathname: string, userId: string) {
  const parts = pathname.split('/');
  return parts.length === 4
    && parts[0] === 'fileforge'
    && parts[1] === userId
    && parts[2].length > 0
    && /^input\.[A-Za-z0-9]{1,8}$/i.test(parts[3]);
}

function safeOutputFilename(input: unknown, outputFilename: string) {
  const raw = typeof input === 'string' ? input : 'file';
  const stem = raw.replace(/\.[^.]+$/, '').replace(/[^A-Za-z0-9._ -]/g, '_').slice(0, 90) || 'file';
  const ext = outputFilename.toLowerCase().endsWith('.zip') ? '.zip' : path.extname(outputFilename);
  return `${stem}${ext}`;
}

export async function POST(request: Request) {
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
  if (!(await allowSharedRateLimit('convert', ip, 8, 60))) return NextResponse.json({ error: 'Too many conversion requests. Please wait one minute and try again.' }, { status: 429, headers: { 'Retry-After': '60' } });

  let inputPathname = '';
  let outputPathname = '';
  let workDir = '';
  let jobStarted = false;

  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Please log in to use FileForge converters.' }, { status: 401 });

    const admin = createAdminClient();
    const body = await request.json() as { pathname?: unknown; filename?: unknown; conversionId?: unknown };
    inputPathname = typeof body.pathname === 'string' ? body.pathname : '';
    const filename = typeof body.filename === 'string' ? body.filename : 'file';
    const conversionId = typeof body.conversionId === 'string' ? body.conversionId : '';
    if (!inputPathname || !isOwnedInput(inputPathname, user.id)) return NextResponse.json({ error: 'Invalid upload reference.' }, { status: 400 });
    const spec = getConversion(conversionId);
    const pathnameParts = inputPathname.split('/');
    const pathnameExtension = pathnameParts.length === 4 ? path.extname(pathnameParts[3]).toLowerCase() : '';
    const filenameExtension = path.extname(filename).toLowerCase();
    if (!spec.fromExtensions.includes(pathnameExtension) || !spec.fromExtensions.includes(filenameExtension) || pathnameExtension !== filenameExtension) {
      return NextResponse.json({ error: 'The uploaded file does not match the selected converter.' }, { status: 400 });
    }

    const start = await admin.rpc('start_compression_job', { p_user_id: user.id });
    if (start.error) return NextResponse.json({ error: 'Could not check your usage limit.' }, { status: 500 });
    if (!start.data?.allowed) {
      const message = start.data?.reason === 'busy'
        ? 'A FileForge job is already running for your account. Please wait for it to finish.'
        : 'Free accounts are limited to 3 successful jobs per day. Upgrade to Pro for higher usage.';
      return NextResponse.json({ error: message }, { status: start.data?.reason === 'busy' ? 409 : 402 });
    }
    jobStarted = true;

    const stored = await get(inputPathname, { access: 'private', useCache: false });
    if (!stored || stored.statusCode !== 200 || !stored.stream || !Number.isSafeInteger(stored.blob.size) || stored.blob.size < 1) throw new ConverterError('The uploaded file is no longer available. Please upload it again.', 410);
    if (stored.blob.size > MAX_UPLOAD_BYTES) throw new ConverterError(`This file exceeds the ${MAX_UPLOAD_MB} MB FileForge limit.`, 413);
    const inputSize = stored.blob.size;
    await stored.stream.cancel().catch(() => undefined);
    const getFreshStream = async () => {
      const fresh = await get(inputPathname, { access: 'private', useCache: false });
      if (!fresh || fresh.statusCode !== 200 || !fresh.stream) throw new ConverterError('The uploaded file is no longer available. Please upload it again.', 410);
      return fresh.stream;
    };

    workDir = await fs.mkdtemp(path.join(os.tmpdir(), 'fileforge-convert-'));
    const extension = path.extname(filename).toLowerCase();
    const inputPath = path.join(workDir, `input${extension || '.bin'}`);
    await downloadInput(getFreshStream, inputPath, inputSize);
    const result = await convertFile(inputPath, filename, conversionId as ConversionId, workDir);

    const resultExtension = path.extname(result.outputFilename || spec.outputExtension).toLowerCase() || spec.outputExtension;
    outputPathname = `fileforge/${user.id}/${crypto.randomUUID()}/output${resultExtension}`;
    const outputBlob = await put(outputPathname, createReadStream(result.outputPath), {
      access: 'private',
      addRandomSuffix: false,
      contentType: result.outputMime,
      cacheControlMaxAge: 60,
      multipart: true,
    });

    const downloadExpiresAt = Date.now() + 60 * 60 * 1000;
    const downloadFilename = safeOutputFilename(filename, result.outputFilename || spec.outputExtension);
    const downloadSignature = signDownload(outputBlob.pathname, downloadFilename, downloadExpiresAt);
    const downloadUrl = `/api/download?pathname=${encodeURIComponent(outputBlob.pathname)}&filename=${encodeURIComponent(downloadFilename)}&expires=${downloadExpiresAt}&sig=${encodeURIComponent(downloadSignature)}`;

    const finish = await admin.rpc('finish_compression_job', { p_user_id: user.id });
    if (finish.error || !finish.data?.allowed) {
      await del(outputBlob.pathname).catch(() => undefined);
      await del(inputPathname).catch(() => undefined);
      try { await createAdminClient().rpc('release_compression_job', { p_user_id: user.id }); } catch { /* best-effort cleanup */ }
      jobStarted = false;
      return NextResponse.json({ error: finish.error ? 'Could not record your FileForge usage.' : 'Your daily usage limit has been reached.' }, { status: 402 });
    }
    jobStarted = false;
    await del(inputPathname).catch(() => undefined);
    await fs.rm(workDir, { recursive: true, force: true }).catch(() => undefined);

    return NextResponse.json({ downloadUrl, inputBytes: result.inputBytes, outputBytes: result.outputBytes, outputFilename: downloadFilename, conversion: spec.label, expiresAt: downloadExpiresAt }, { headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } });
  } catch (error) {
    if (jobStarted) {
      try { const client = await createClient(); await client.rpc('release_compression_job'); } catch { /* best-effort cleanup */ }
    }
    if (outputPathname) await del(outputPathname).catch(() => undefined);
    if (inputPathname) await del(inputPathname).catch(() => undefined);
    if (workDir) await fs.rm(workDir, { recursive: true, force: true }).catch(() => undefined);
    if (error instanceof ConverterError) return NextResponse.json({ error: error.message }, { status: error.status });
    return NextResponse.json({ error: 'Conversion could not be completed. Please try another file or converter.' }, { status: 500 });
  }
}

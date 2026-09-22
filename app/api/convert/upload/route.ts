import { handleUpload, type HandleUploadBody } from '@vercel/blob/client';
import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { MAX_UPLOAD_BYTES } from '@/lib/converters';
import { CONVERSIONS } from '@/lib/converters/catalog';

import { allowSharedRateLimit } from '@/lib/rate-limit';
export const runtime = 'nodejs';

const ALLOWED_CONTENT_TYPES = [
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'text/csv',
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/heic',
  'image/heif',
];

function cleanFilename(value: unknown) {
  const raw = typeof value === 'string' ? value : 'document';
  return raw.replace(/[\\/\r\n"]/g, '_').replace(/[^A-Za-z0-9._ -]/g, '_').slice(0, 120) || 'document';
}

function extensionFromFilename(filename: string) {
  const match = filename.toLowerCase().match(/\.[a-z0-9]{1,8}$/);
  return match?.[0] ?? '';
}

const supportedExtensions = new Set(CONVERSIONS.flatMap((spec) => spec.fromExtensions));

export async function POST(request: Request): Promise<NextResponse> {
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
  if (!(await allowSharedRateLimit('upload', ip, 12, 60))) return NextResponse.json({ error: 'Too many upload attempts. Please wait one minute and try again.' }, { status: 429, headers: { 'Retry-After': '60' } });
  try {
    const body = (await request.json()) as HandleUploadBody;
    const jsonResponse = await handleUpload({
      body,
      request,
      onBeforeGenerateToken: async (_pathname, clientPayload) => {
        const supabase = await createClient();
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) throw new Error('Please log in to use FileForge converters.');

        let filename = 'document';
        let conversionId = '';
        try {
          const payload = JSON.parse(clientPayload || '{}') as { filename?: unknown; conversionId?: unknown };
          filename = cleanFilename(payload.filename);
          conversionId = typeof payload.conversionId === 'string' ? payload.conversionId : '';
        } catch {
          throw new Error('Invalid converter upload metadata.');
        }

        const extension = extensionFromFilename(filename);
        if (!supportedExtensions.has(extension)) throw new Error('Unsupported file type.');
        const spec = CONVERSIONS.find((item) => item.id === conversionId);
        if (!spec || !spec.fromExtensions.includes(extension)) throw new Error('This file type does not match the selected converter.');

        const contentTypesByExtension: Record<string, string[]> = {
          '.pdf': ['application/pdf'],
          '.doc': ['application/msword'],
          '.docx': ['application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
          '.xls': ['application/vnd.ms-excel'],
          '.xlsx': ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
          '.ppt': ['application/vnd.ms-powerpoint'],
          '.pptx': ['application/vnd.openxmlformats-officedocument.presentationml.presentation'],
          '.csv': ['text/csv'],
          '.jpg': ['image/jpeg'],
          '.jpeg': ['image/jpeg'],
          '.png': ['image/png'],
          '.webp': ['image/webp'],
          '.heic': ['image/heic'],
          '.heif': ['image/heif'],
        };

        return {
          pathname: `fileforge/${user.id}/${crypto.randomUUID()}/input${extension}`,
          allowedContentTypes: contentTypesByExtension[extension] ?? ALLOWED_CONTENT_TYPES,
          maximumSizeInBytes: MAX_UPLOAD_BYTES,
          validUntil: Date.now() + 60 * 60 * 1000,
          addRandomSuffix: false,
          cacheControlMaxAge: 60,
          tokenPayload: JSON.stringify({ userId: user.id, filename, conversionId, extension }),
        };
      },
      onUploadCompleted: async ({ blob, tokenPayload }) => {
        try {
          const payload = JSON.parse(tokenPayload || '{}') as { userId?: string; extension?: string; conversionId?: string };
          if (!payload.userId || !payload.extension || !payload.conversionId) throw new Error('Invalid upload metadata.');
          const spec = CONVERSIONS.find((item) => item.id === payload.conversionId);
          if (!spec || !spec.fromExtensions.includes(payload.extension)) throw new Error('Invalid converter metadata.');
          const expectedPrefix = `fileforge/${payload.userId}/`;
          const parts = blob.pathname.split('/');
          const valid = parts.length === 4
            && parts[0] === 'fileforge'
            && parts[1] === payload.userId
            && parts[2].length > 0
            && parts[3] === `input${payload.extension}`
            && blob.pathname.startsWith(expectedPrefix);
          if (!valid) throw new Error('Invalid upload metadata.');
        } catch {
          throw new Error('Invalid upload metadata.');
        }
      },
    });
    return NextResponse.json(jsonResponse);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Upload authorization failed.';
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

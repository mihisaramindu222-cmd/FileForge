import { handleUpload, type HandleUploadBody } from '@vercel/blob/client';
import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { CONVERSIONS, MAX_UPLOAD_BYTES } from '@/lib/converters';
import { allowSharedRateLimit } from '@/lib/rate-limit';

export const runtime = 'nodejs';

const SUPPORTED_EXTENSIONS = new Set(
  CONVERSIONS.flatMap((conversion) =>
    conversion.fromExtensions.map((extension) => extension.toLowerCase())
  )
);

const CONTENT_TYPES = [
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
  const raw = typeof value === 'string' ? value : 'document.pdf';
  return raw
    .replace(/[\\/\r\n"]/g, '_')
    .replace(/[^A-Za-z0-9._ -]/g, '_')
    .slice(0, 120) || 'document.pdf';
}

function getExtension(filename: string) {
  const match = /\.([A-Za-z0-9]{1,8})$/.exec(filename);
  return match ? `.${match[1].toLowerCase()}` : '';
}

function contentTypeMatchesExtension(contentType: string, extension: string) {
  const normalized = contentType.toLowerCase();
  if (extension === '.pdf') return normalized === 'application/pdf';
  if (extension === '.doc') return normalized === 'application/msword';
  if (extension === '.docx') return normalized === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  if (extension === '.xls') return normalized === 'application/vnd.ms-excel';
  if (extension === '.xlsx') return normalized === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
  if (extension === '.ppt') return normalized === 'application/vnd.ms-powerpoint';
  if (extension === '.pptx') return normalized === 'application/vnd.openxmlformats-officedocument.presentationml.presentation';
  if (extension === '.csv') return normalized === 'text/csv' || normalized === 'application/csv';
  if (extension === '.jpg' || extension === '.jpeg') return normalized === 'image/jpeg';
  if (extension === '.png') return normalized === 'image/png';
  if (extension === '.webp') return normalized === 'image/webp';
  if (extension === '.heic') return normalized === 'image/heic' || normalized === 'image/heif';
  if (extension === '.heif') return normalized === 'image/heif' || normalized === 'image/heic';
  return false;
}

export async function POST(request: Request): Promise<NextResponse> {
  const ip =
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';

  if (!(await allowSharedRateLimit('upload', ip, 12, 60))) {
    return NextResponse.json(
      { error: 'Too many upload attempts. Please wait one minute and try again.' },
      { status: 429, headers: { 'Retry-After': '60' } }
    );
  }

  try {
    const body = (await request.json()) as HandleUploadBody;

    const jsonResponse = await handleUpload({
      body,
      request,
      onBeforeGenerateToken: async (_pathname, clientPayload) => {
        const supabase = await createClient();
        const {
          data: { user },
        } = await supabase.auth.getUser();

        if (!user) {
          throw new Error('Please log in to upload a file.');
        }

        let filename = 'document.pdf';
        let requestedPathname = '';
        try {
          const payload = JSON.parse(clientPayload || '{}') as {
            filename?: unknown;
            pathname?: unknown;
          };
          filename = cleanFilename(payload.filename);
          requestedPathname =
            typeof payload.pathname === 'string' ? payload.pathname : '';
        } catch {
          // Fall back to the safe default filename.
        }

        const extension = getExtension(filename);

        if (!SUPPORTED_EXTENSIONS.has(extension)) {
          throw new Error('This file type is not supported by FileForge.');
        }

        const parts = requestedPathname.split('/');
        const validPathname =
          parts.length === 4 &&
          parts[0] === 'fileforge' &&
          parts[1] === user.id &&
          /^[0-9a-f-]{36}$/i.test(parts[2]) &&
          parts[3] === `input${extension}`;

        if (!validPathname) {
          throw new Error('Invalid upload path.');
        }

        return {
          pathname: requestedPathname,
          allowedContentTypes: CONTENT_TYPES,
          maximumSizeInBytes: MAX_UPLOAD_BYTES,
          validUntil: Date.now() + 60 * 60 * 1000,
          addRandomSuffix: false,
          cacheControlMaxAge: 60,
          tokenPayload: JSON.stringify({
            userId: user.id,
            filename,
            extension,
          }),
        };
      },

      onUploadCompleted: async ({ blob, tokenPayload }) => {
        try {
          const payload = JSON.parse(tokenPayload || '{}') as {
            userId?: string;
            extension?: string;
          };

          if (
            !payload.userId ||
            !payload.extension ||
            !SUPPORTED_EXTENSIONS.has(payload.extension) ||
            !blob.pathname.startsWith(`fileforge/${payload.userId}/`) ||
            !blob.pathname.endsWith(`/input${payload.extension}`)
          ) {
            throw new Error('Invalid upload metadata.');
          }
        } catch {
          throw new Error('Invalid upload metadata.');
        }
      },
    });

    return NextResponse.json(jsonResponse);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : 'Upload authorization failed.';

    return NextResponse.json({ error: message }, { status: 400 });
  }
}

import { handleUpload, type HandleUploadBody } from '@vercel/blob/client';
import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { MAX_UPLOAD_BYTES } from '@/lib/converters';
import { allowSharedRateLimit } from '@/lib/rate-limit';

export const runtime = 'nodejs';

function cleanFilename(value: unknown) {
  const raw = typeof value === 'string' ? value : 'document.pdf';
  return raw.replace(/[\\/\r\n"]/g, '_').replace(/[^A-Za-z0-9._ -]/g, '_').slice(0, 120) || 'document.pdf';
}

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
        if (!user) throw new Error('Please log in to upload a PDF.');

        let filename = 'document.pdf';
        try {
          const payload = JSON.parse(clientPayload || '{}') as { filename?: unknown };
          filename = cleanFilename(payload.filename);
        } catch {
          // Fall back to the safe default filename.
        }

        return {
          pathname: `fileforge/${user.id}/${crypto.randomUUID()}/input.pdf`,
          allowedContentTypes: ['application/pdf'],
          maximumSizeInBytes: MAX_UPLOAD_BYTES,
          validUntil: Date.now() + 60 * 60 * 1000,
          addRandomSuffix: false,
          cacheControlMaxAge: 60,
          tokenPayload: JSON.stringify({ userId: user.id, filename }),
        };
      },
      onUploadCompleted: async ({ blob, tokenPayload }) => {
        // This callback is invoked by Vercel Blob, not the browser, so do not rely
        // on the user's cookie/session here. The signed token payload binds the job
        // to the authenticated user that was checked before the upload token was issued.
        try {
          const payload = JSON.parse(tokenPayload || '{}') as { userId?: string };
          if (!payload.userId || !blob.pathname.startsWith(`fileforge/${payload.userId}/`)) {
            throw new Error('Invalid upload metadata.');
          }
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

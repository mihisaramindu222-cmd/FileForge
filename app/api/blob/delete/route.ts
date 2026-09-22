import { del } from '@vercel/blob';
import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export const runtime = 'nodejs';

export async function DELETE(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 });

  try {
    const body = await request.json() as { pathname?: unknown };
    const pathname = typeof body.pathname === 'string' ? body.pathname : '';
    if (!pathname.startsWith(`fileforge/${user.id}/`)) {
      return NextResponse.json({ error: 'Invalid file reference.' }, { status: 403 });
    }
    await del(pathname);
    return new Response(null, { status: 204 });
  } catch {
    return NextResponse.json({ error: 'Cleanup could not be completed.' }, { status: 400 });
  }
}

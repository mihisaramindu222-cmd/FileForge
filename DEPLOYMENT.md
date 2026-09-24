# FileForge deployment notes

## Required environment variables

Set these in Vercel before deploying:

- `NEXT_PUBLIC_SITE_URL` — the real production URL of FileForge.
- `NEXT_PUBLIC_CONTACT_EMAIL` — the real support/privacy email.
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`
- `BLOB_READ_WRITE_TOKEN`
- `DOWNLOAD_SIGNING_SECRET` — a random secret of at least 32 characters. Keep it server-only.
- `CRON_SECRET`
- Stripe variables if billing is enabled.

## Supabase

Run the current `supabase/schema.sql` in the Supabase SQL editor. It keeps the authenticated job RPCs and shared rate-limit function in sync with the application. Stripe billing still requires the server secret when billing is enabled.

## Vercel container deployment

Keep `Dockerfile.vercel` at the repository root. Vercel now supports root Dockerfile deployments as containerized Functions, which is why the native conversion tools can stay in the same deployment. The container listens on the runtime `PORT` environment variable (default 3000). Vercel can override `PORT` for the container runtime.

## Vercel Hobby plan

The cleanup cron is configured once daily (`0 3 * * *`) so it is compatible with Hobby cron limits. It removes temporary blobs older than one hour. Conversion and compression routes are capped at 300 seconds; Vercel's current Hobby maximum with Fluid compute is 300 seconds.

## File size

The upload limit remains **500 MB**. This change does not reduce the limit.

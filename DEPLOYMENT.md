# FileForge deployment notes

## Required environment variables

Set these in Vercel before deploying:

- `NEXT_PUBLIC_SITE_URL` — the real production URL of FileForge.
- `NEXT_PUBLIC_CONTACT_EMAIL` — the real support/privacy email.
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`
- `SUPABASE_SECRET_KEY` (or `SUPABASE_SERVICE_ROLE_KEY`)
- `BLOB_READ_WRITE_TOKEN`
- `DOWNLOAD_SIGNING_SECRET` — a random secret of at least 32 characters. Keep it server-only.
- `CRON_SECRET`
- Stripe variables if billing is enabled.

## Supabase

Run the current `supabase/schema.sql` in the Supabase SQL editor. It adds the shared rate-limit table/function and billing-event user linkage in addition to the existing FileForge tables/functions.

## Vercel Hobby plan

The cleanup cron is configured once daily (`0 3 * * *`) so it is compatible with Hobby cron limits. It removes temporary blobs older than one hour.

## File size

The upload limit remains **500 MB**. This change does not reduce the limit.

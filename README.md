# FileForge

FileForge is a single-deployment Next.js file utility site with PDF compression, file conversion, Supabase authentication, Vercel Blob storage, Stripe billing and optional AdSense.

## Supported conversions

- PDF → Word, Excel, PowerPoint, JPG, PNG
- Word/Excel/PowerPoint → PDF
- JPG/PNG → PDF
- JPG/PNG/WebP/HEIC/HEIF image conversions
- Excel ↔ CSV

## Deployment

This project is designed for Vercel's `Dockerfile.vercel` container deployment so Ghostscript, LibreOffice, Poppler, ImageMagick, libheif, Python and zip are packaged with the application.

1. Import the repository into Vercel.
2. Connect a private Vercel Blob store.
3. Run `supabase/schema.sql` in Supabase.
4. Add the variables listed in `.env.example`.
5. Configure the Stripe webhook as `/api/stripe/webhook`.
6. Deploy.

Large uploads are sent directly from the browser to private Vercel Blob storage. They do not pass through a normal Function request body. Downloads are streamed back through an authenticated same-origin route so Office, image, PDF and ZIP files receive explicit attachment headers.

## Local checks

Use Node 24 and pnpm 10.15.1.

```bash
corepack enable
corepack prepare pnpm@10.15.1 --activate
pnpm install --frozen-lockfile
pnpm typecheck
pnpm build
```

The runtime container installs the native conversion tools required by FileForge.

## Notes

The public upload limit is 500 MB. Some disk-heavy Office/PDF conversions are additionally constrained by the runtime's writable temporary storage and conversion timeout. PDF compression streams the source PDF from private Blob storage directly into Ghostscript to minimize local disk usage.

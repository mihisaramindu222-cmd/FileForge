## 2026-09-22 — V12 complete reliability + UI pass

- Refreshed the entire visual system with a colorful purple/magenta/cyan theme, glass cards, stronger hierarchy, responsive states, polished buttons and mobile spacing.
- Added a branded App Router favicon (`app/icon.svg`).
- Added Word → PowerPoint and PowerPoint → Word conversion paths through LibreOffice + the existing PDF/Office bridge, with honest page-preserving/editability descriptions in the UI.
- Added generated Office-file validation: DOCX/PPTX outputs are unzipped and round-tripped through LibreOffice before success is returned.
- Made ImageMagick command detection runtime-safe (`magick`/`convert`) instead of relying on a build-time availability probe.
- Hardened the single-deployment Vercel container with deterministic locale/fonts, explicit port/host defaults and a smaller Docker build context via `.dockerignore`.
- Added friendly App Router 404/error pages.
- Expanded the converter selector to expose the complete conversion catalog instead of truncating the UI to a subset.
- Added clearer Office ↔ Office fidelity messaging so users are not promised fully editable layout when the source format cannot guarantee it.
- Verified Python syntax, TypeScript/TSX parser diagnostics, converter catalog uniqueness and native conversion smoke tests in the available environment.
- Full `pnpm install` / production Docker build could not be executed in this environment because registry/network access and the Docker CLI are unavailable; deployment still requires Vercel to perform the real dependency install/build.


## 2026-09-18 — Conversion/download reliability patch
- Added authenticated same-origin `/api/download` streaming for converted and compressed files.
- Added explicit `Content-Disposition: attachment` and MIME/length headers for reliable browser downloads.
- Added output container/PDF/image/CSV validation before a conversion is marked successful.
- Updated converter and compressor APIs to return the new download route.
- Extended download availability to the temporary-file retention window.

## Final client/runtime audit (2026-09-18)

- Hardened client result validation for byte counts and download expiry metadata.
- Added ImageMagick v6/v7 command detection with `FILEFORGE_IMAGE_COMMAND` override.
- Documented the supported `SUPABASE_SERVICE_ROLE_KEY` environment-variable alias.
- Verified a single canonical conversion catalog is shared by UI and server conversion logic.
- Verified accessibility states for tool tabs, progress feedback, and file selection controls.
- Verified temporary private Blob uploads use a 60-minute upload-token window and short-lived download links.
- Re-ran source, Python, ZIP/archive, and native conversion smoke checks after the audit patches.
## 2026-09-18 — Final deployment hardening
- Repaired the project archive's Windows-style path separators so the final ZIP extracts into a normal Next.js directory tree.
- Made Docker dependency installation lockfile-frozen and reproducible.
- Explicitly copied `scripts/pdf_office.py` into the runtime image so PDF → Word/PowerPoint converters are available after standalone packaging.
- Tightened converter upload completion and job-reference validation so the selected conversion, filename extension and Blob path must agree.
- Tightened compression/conversion Blob path ownership checks to an exact four-segment FileForge path.
- Removed generated TypeScript build cache from the final deployment package.

## 2026-09-18 — Monetization and upload abuse hardening
- Added a lightweight rate limit to converter upload-token issuance to reduce Blob-storage abuse from repeated unsigned upload attempts.
- Restricted converter upload tokens to the selected extension's expected content type.
- Prevented Pro access from being granted for a Stripe Checkout Session whose payment status is still `unpaid`; delayed payments are activated on `checkout.session.async_payment_succeeded`.
- Kept the 500 MB upload limit unchanged.

## 2026-09-18 — Full bug hardening pass
- Fixed converter Blob completion validation path mismatch that could reject every converter upload.
- Fixed Debian ImageMagick command mismatch (`magick` → `convert`).
- Fixed single-page PDF→JPG/PNG Blob extension and MIME mismatch.
- Restricted converter upload tokens to content types appropriate for the selected extension.
- Added HSTS response header.
- Made auth callback failures explicit instead of silently redirecting.
- Hardened pricing JSON parsing and admin billing display handling.
- Kept the 500 MB upload limit unchanged.

# Changelog

## 2026-09-18 — 500 MB single-deployment hardening

- Kept the public upload limit at 500 MB.
- Changed PDF processing to stream private Vercel Blob input directly into Ghostscript instead of copying the original PDF into `/tmp`.
- Kept only one generated Ghostscript candidate on local disk at a time, with best-candidate regeneration when needed.
- Added a no-reduction path that copies the original PDF directly from Blob to a private result Blob without using local input storage.
- Added a configurable public contact email via `NEXT_PUBLIC_CONTACT_EMAIL`.
- Updated deployment documentation for the large-file storage strategy and AdSense consent requirements.

## Ghostscript single-deployment update

- Replaced `pdf-lib` compression with Ghostscript.
- Added `Dockerfile.vercel` so Ghostscript is packaged inside the same Vercel deployment.
- Added disk-based processing to avoid duplicating large PDFs in JS memory.
- Added progressive target-size attempts.
- Added `pdfinfo` page-count validation.
- Kept private Blob uploads, signed downloads, quota locking, cleanup cron, Supabase and Stripe flows.
- Updated Node.js target to 24.x.

- Increased the single-deployment PDF upload limit from 200 MB to 500 MB across client validation, Blob upload tokens, API validation, pricing copy, and documentation.

## 2026-09-18 — File conversion tools

- Added a unified File Converter workspace alongside PDF Compressor.
- Added PDF → Word, PDF → Excel, PDF → PowerPoint, PDF → JPG/PNG.
- Added Word/Excel/PowerPoint → PDF and JPG/PNG → PDF.
- Added common JPG/PNG/WebP/HEIC image conversions plus Excel/CSV conversion.
- Added private Blob upload tokens and the existing quota/cleanup path to conversion jobs.
- Kept the 500 MB upload limit unchanged.
- Added LibreOffice, ImageMagick, Python 3 and zip to the Vercel container image.

## 2026-09-18 — pnpm deployment update

- Switched dependency installation from npm to pnpm 10.15.1.
- Added `packageManager` metadata to `package.json`.
- Updated `Dockerfile.vercel` to use Corepack + pnpm.
- Removed unsupported/duplicated Vercel memory override from `vercel.json`; `maxDuration` remains 300s.
- Kept the 500 MB upload limit unchanged.
- Kept the existing converter/compressor functionality unchanged.

## 2026-09-18 — Final converter hardening

- Fixed HEIC/HEIF → JPG to use the native `heif-convert` utility instead of relying on an ImageMagick HEIC delegate.
- Added `libheif-examples` to the production Vercel container.
- Kept generated-output validation and authenticated downloads unchanged.

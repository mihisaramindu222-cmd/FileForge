import type { MetadataRoute } from 'next';

const FALLBACK_SITE_URL = 'https://fileforge-final-deploy.vercel.app';

function getSiteUrl() {
  const configured = process.env.NEXT_PUBLIC_SITE_URL?.trim();
  if (configured && !/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?\/?$/i.test(configured) && !/\.example(?:\.com)?\/?$/i.test(configured)) return configured.replace(/\/$/, '');
  const vercelHost = process.env.VERCEL_PROJECT_PRODUCTION_URL || process.env.VERCEL_URL;
  if (vercelHost && !/^(localhost|127\.0\.0\.1)(:\d+)?$/i.test(vercelHost)) return `https://${vercelHost.replace(/^https?:\/\//, '').replace(/\/$/, '')}`;
  return FALLBACK_SITE_URL;
}

export default function sitemap(): MetadataRoute.Sitemap {
  const siteUrl = getSiteUrl();
  const base = siteUrl.replace(/\/$/, '');
  return [
    { url: base, lastModified: new Date() },
    { url: `${base}/pricing`, lastModified: new Date() },
    { url: `${base}/login`, lastModified: new Date() },
    { url: `${base}/privacy`, lastModified: new Date() },
    { url: `${base}/terms`, lastModified: new Date() },
  ];
}

import type { MetadataRoute } from 'next';

const FALLBACK_SITE_URL = 'https://fileforge-final-deploy.vercel.app';

function getSiteUrl() {
  const configured = process.env.NEXT_PUBLIC_SITE_URL?.trim();
  if (configured && !/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?\/?$/i.test(configured) && !/\.example(?:\.com)?\/?$/i.test(configured)) return configured.replace(/\/$/, '');
  const vercelHost = process.env.VERCEL_PROJECT_PRODUCTION_URL || process.env.VERCEL_URL;
  if (vercelHost && !/^(localhost|127\.0\.0\.1)(:\d+)?$/i.test(vercelHost)) return `https://${vercelHost.replace(/^https?:\/\//, '').replace(/\/$/, '')}`;
  return FALLBACK_SITE_URL;
}

export default function robots(): MetadataRoute.Robots {
  const siteUrl = getSiteUrl();
  return {
    rules: [{ userAgent: '*', allow: '/' }],
    sitemap: `${siteUrl.replace(/\/$/, '')}/sitemap.xml`,
  };
}

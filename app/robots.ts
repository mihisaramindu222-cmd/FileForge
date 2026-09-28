import type { MetadataRoute } from 'next';

const FALLBACK_SITE_URL = 'https://fileforge-final-deploy.vercel.app';

function getSiteUrl() {
  const configured = process.env.NEXT_PUBLIC_SITE_URL?.trim();
  if (configured) {
    try {
      const url = new URL(configured);
      const host = url.hostname.toLowerCase();
      if ((url.protocol === 'https:' || url.protocol === 'http:') && host !== 'localhost' && host !== '127.0.0.1' && !host.endsWith('.example.com')) {
        return url.origin;
      }
    } catch {}
  }
  const productionHost = process.env.VERCEL_PROJECT_PRODUCTION_URL || process.env.VERCEL_URL;
  if (productionHost && !/^(localhost|127\.0\.0\.1)(:\d+)?$/i.test(productionHost)) {
    return `https://${productionHost.replace(/^https?:\/\//, '').replace(/\/$/, '')}`;
  }
  return FALLBACK_SITE_URL;
}

export default function robots(): MetadataRoute.Robots {
  const siteUrl = getSiteUrl();
  return {
    rules: [{
      userAgent: '*',
      allow: '/',
      disallow: ['/api/', '/admin/', '/account/', '/auth/', '/login', '/reset-password'],
    }],
    sitemap: `${siteUrl.replace(/\/$/, '')}/sitemap.xml`,
  };
}

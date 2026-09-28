import './globals.css';
import type { Metadata, Viewport } from 'next';
import Script from 'next/script';

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

const siteUrl = getSiteUrl();

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: 'FileForge — Free Online File Converter & PDF Compressor',
  description: 'Free online file converter and PDF compressor. Convert PDF, Word, PowerPoint, Excel, JPG, PNG and more with private temporary processing.',
  applicationName: 'FileForge',
  alternates: { canonical: '/' },
  openGraph: {
    title: 'FileForge — Free Online File Converter & PDF Compressor',
    description: 'Free online file conversion and PDF compression for PDF, Word, PowerPoint, Excel and common image formats.',
    type: 'website',
    url: siteUrl,
    siteName: 'FileForge',
  },
  twitter: {
    card: 'summary',
    title: 'FileForge — PDF Compressor & File Converter',
    description: 'Compress PDFs and convert common file formats online with private temporary processing.',
  },
  robots: { index: true, follow: true },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  colorScheme: 'light',
  themeColor: '#f7f5ff',
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const adsClient = process.env.NEXT_PUBLIC_ADSENSE_CLIENT_ID;
  return (
    <html lang="en">
      <body>
        {children}
        {adsClient && (
          <Script
            async
            src={`https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${adsClient}`}
            crossOrigin="anonymous"
          />
        )}
        <Script src="/_vercel/insights/script.js" strategy="afterInteractive" />
      </body>
    </html>
  );
}

import './globals.css';
import type { Metadata, Viewport } from 'next';
import Script from 'next/script';

function getSiteUrl() {
  const configured = process.env.NEXT_PUBLIC_SITE_URL?.trim();
  if (configured) return configured.replace(/\/$/, '');
  const productionHost = process.env.VERCEL_PROJECT_PRODUCTION_URL || process.env.VERCEL_URL;
  if (productionHost) {
    return `https://${productionHost.replace(/^https?:\/\//, '').replace(/\/$/, '')}`;
  }
  return 'http://localhost:3000';
}

const siteUrl = getSiteUrl();

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: 'FileForge — PDF Compressor & File Converter',
  description: 'Compress PDFs and convert common PDF, Office, image and spreadsheet files online with private temporary processing.',
  keywords: ['PDF compressor', 'file converter', 'PDF converter', 'Word to PDF', 'PDF to Word', 'JPG to PNG', 'PNG to JPG', 'PDF to Excel'],
  applicationName: 'FileForge',
  alternates: { canonical: '/' },
  openGraph: {
    title: 'FileForge — PDF Compressor & File Converter',
    description: 'Compress PDFs and convert common file formats online with private temporary processing.',
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
      </body>
    </html>
  );
}

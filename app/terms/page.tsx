import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Terms of Use — FileForge',
  description: 'FileForge terms of use for PDF compression and file conversion.',
  alternates: { canonical: '/terms' },
  robots: { index: true, follow: true },
};

export default function TermsPage() {
  return <main className="legal-page"><article className="legal-card shell"><a className="brand" href="/">FileForge</a><span className="section-kicker">Terms</span><h1>Terms of use</h1><p>FileForge is provided for lawful PDF compression and file-conversion use. You are responsible for the files you upload and for having the rights to process them.</p><h2>Service limits</h2><p>FileForge is currently free to use. The service may apply normal anti-abuse, concurrency and infrastructure protections, including temporary rate limits, to keep processing available for users.</p><h2>Uploads</h2><p>Do not upload malware, illegal material, or content you are not authorized to process. We may apply rate limits or suspend abusive access.</p><h2>Service</h2><p>FileForge is currently free to use. No payment is required to use the available tools.</p><h2>Availability</h2><p>The service may be updated, rate-limited or temporarily unavailable for maintenance, security or infrastructure reasons.</p><a className="back-link" href="/">← Back to FileForge</a></article></main>;
}

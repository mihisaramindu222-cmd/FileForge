import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Support — FileForge',
  description: 'Get help with FileForge uploads, compression, conversion, accounts and billing.',
  alternates: { canonical: '/support' },
  robots: { index: true, follow: true },
};

const SUPPORT_URL = 'https://github.com/mihisaramindu222-cmd/FileForge/issues/new';

export default function SupportPage() {
  return (
    <main className="legal-page">
      <article className="legal-card shell">
        <a className="brand" href="/">FileForge</a>
        <span className="section-kicker">Support</span>
        <h1>FileForge support</h1>
        <p>Need help with an upload, compression, conversion, account, or billing issue?</p>
        <p>
          The fastest support channel is the FileForge GitHub issue form. Please do not include passwords,
          API keys, payment card details, or private document contents in a support request.
        </p>
        <p>
          <a className="primary inline-cta" href={SUPPORT_URL} target="_blank" rel="noopener noreferrer">
            Contact FileForge support
          </a>
        </p>
        <p className="privacy">For privacy questions, you can use the same support channel and mark the request as a privacy question.</p>
        <a className="back-link" href="/">← Back to FileForge</a>
      </article>
    </main>
  );
}

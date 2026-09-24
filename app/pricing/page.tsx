import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Pricing — FileForge',
  description: 'FileForge pricing and service availability.',
  alternates: { canonical: '/pricing' },
  robots: { index: true, follow: true },
};

export default function PricingPage() {
  return (
    <main className="legal-page">
      <article className="legal-card shell">
        <a className="brand" href="/">FileForge</a>
        <span className="section-kicker">Pricing</span>
        <h1>Simple pricing</h1>
        <p>FileForge is currently free to use. You can compress PDFs and convert supported files without purchasing a plan.</p>
        <h2>Free</h2>
        <p>Access the available FileForge tools with normal anti-abuse, concurrency and infrastructure protections.</p>
        <p>Paid plans are not currently active on this deployment, so there is no payment required to use the available tools.</p>
        <a className="primary inline-cta" href="/">Start using FileForge →</a>
        <a className="back-link" href="/">← Back to FileForge</a>
      </article>
    </main>
  );
}

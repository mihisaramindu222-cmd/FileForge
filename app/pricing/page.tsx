'use client';

export default function PricingPage() {
  return (
    <main className="pricing-page">
      <div className="pricing-shell shell">
        <div className="dashboard-top">
          <a className="brand" href="/" aria-label="FileForge home">
            <span className="brand-mark">F</span><span>FileForge</span>
          </a>
          <a className="back-link" href="/">← Home</a>
        </div>

        <div className="pricing-head">
          <span className="section-kicker">Free forever</span>
          <h1>All FileForge tools are free to use.</h1>
          <p>No Pro plan, no paid upgrade, and no subscription required.</p>
        </div>

        <div className="pricing-grid pricing-grid-single">
          <article className="price-card featured">
            <span className="plan-tag">FREE</span>
            <h2>$0 <small>forever</small></h2>
            <p className="price-note">Everything available to every account</p>
            <ul>
              <li>Unlimited daily jobs</li>
              <li>Up to 500 MB upload size</li>
              <li>PDF compression with all optimization levels</li>
              <li>All FileForge file converters</li>
              <li>Private temporary file processing</li>
              <li>Short-lived private download links</li>
            </ul>
            <a className="primary inline-cta" href="/#tools">Start using FileForge</a>
          </article>
        </div>

        <p className="fine-print">FileForge is currently offered completely free. No subscription or payment is required. The service may apply short anti-abuse protections to keep processing available for everyone.</p>
      </div>
    </main>
  );
}

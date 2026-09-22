import Link from 'next/link';

export default function NotFound() {
  return (
    <main className="system-page">
      <div className="system-card">
        <span className="brand-mark">F</span>
        <span className="section-kicker">404</span>
        <h1>That page took a wrong turn.</h1>
        <p>The link may be outdated, or the page may have moved. Your files are still safe.</p>
        <Link className="primary inline-cta" href="/">Back to FileForge</Link>
      </div>
    </main>
  );
}

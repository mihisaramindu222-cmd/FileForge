'use client';

import { useEffect } from 'react';

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('FileForge page error:', error);
  }, [error]);

  return (
    <main className="system-page">
      <div className="system-card">
        <span className="brand-mark">F</span>
        <span className="section-kicker">Something went wrong</span>
        <h1>FileForge hit an unexpected error.</h1>
        <p>
          Nothing was changed on your original file. You can retry the page or
          return to the converter.
        </p>
        <div className="button-row system-actions">
          <button
            className="primary inline-cta"
            onClick={() => reset()}
            type="button"
          >
            Try again
          </button>
          <a className="secondary inline-cta" href="/">
            Back home
          </a>
        </div>
      </div>
    </main>
  );
}

import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { CONVERSIONS, type ConversionSpec } from '@/lib/converters/catalog';

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

function getSpec(slug: string): ConversionSpec | undefined {
  return CONVERSIONS.find((item) => item.id === slug);
}

function displayExtension(value: string) {
  return value.replace(/^\./, '').toUpperCase();
}

function getCategory(spec: ConversionSpec) {
  switch (spec.kind) {
    case 'pdf-to-office': return 'PDF to Office';
    case 'pdf-to-images': return 'PDF to Images';
    case 'office-to-pdf': return 'Office to PDF';
    case 'office-to-office': return 'Office conversions';
    case 'spreadsheet': return 'Spreadsheet tools';
    default: return 'Image conversions';
  }
}

function getExactnessNote(spec: ConversionSpec) {
  if (spec.id === 'pdf-word') return 'Text-based PDFs produce editable DOCX content. Scanned PDFs may use page images so the visual appearance is preserved without claiming OCR accuracy.';
  if (spec.id === 'pdf-excel') return 'PDF text positioning is used to build workbook rows and columns. Complex or scanned tables may need manual cleanup.';
  if (spec.id === 'pdf-powerpoint') return 'PDF pages are turned into PowerPoint slides, with source-page appearance prioritized over fully editable page structure.';
  if (spec.kind === 'pdf-to-images') return 'Each PDF page is rendered as an image. Multi-page results are packaged into a ZIP file.';
  if (spec.id === 'word-powerpoint') return 'Word pages are converted into a page-based PowerPoint presentation, with layout preserved as slide images.';
  if (spec.id === 'powerpoint-word') return 'PowerPoint text is extracted into an editable Word document, with page-image fallback for slide fidelity.';
  return 'Conversion output can vary with the source document, fonts, layout, and embedded content. Review the result before using it for important work.';
}

export const dynamicParams = false;

export function generateStaticParams() {
  return CONVERSIONS.map((spec) => ({ slug: spec.id }));
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const spec = getSpec(slug);
  if (!spec) return {};

  const base = getSiteUrl();
  const url = `${base}/convert/${spec.id}`;
  const description = `${spec.description} Use FileForge online to convert ${spec.fromExtensions.map(displayExtension).join(', ')} to ${displayExtension(spec.outputExtension)}.`;

  return {
    title: `${spec.label} Online | FileForge`,
    description,
    alternates: { canonical: `/convert/${spec.id}` },
    robots: { index: true, follow: true },
    openGraph: {
      title: `${spec.label} Online | FileForge`,
      description,
      type: 'website',
      url,
      siteName: 'FileForge',
    },
    twitter: {
      card: 'summary',
      title: `${spec.label} Online | FileForge`,
      description,
    },
  };
}

export default async function ConversionPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const spec = getSpec(slug);
  if (!spec) notFound();

  const base = getSiteUrl();
  const url = `${base}/convert/${spec.id}`;
  const related = CONVERSIONS.filter((item) => item.id !== spec.id && item.kind === spec.kind).slice(0, 4);
  const inputFormats = spec.fromExtensions.map(displayExtension).join(', ');
  const outputFormat = displayExtension(spec.outputExtension);
  const faq = [
    {
      question: `How do I use the ${spec.label}?`,
      answer: `Open the FileForge converter, choose the ${spec.label} tool, upload a supported file, and start the conversion. The result is provided as a short-lived private download link.`,
    },
    {
      question: `What files does ${spec.label} support?`,
      answer: `The input formats for this tool are ${inputFormats}. The expected output format is ${outputFormat}.`,
    },
    {
      question: 'Are my files permanently stored?',
      answer: 'No. FileForge is designed around temporary processing. Input files are removed after processing, and result links expire after a limited period.',
    },
    {
      question: 'Will every conversion have identical formatting?',
      answer: getExactnessNote(spec),
    },
  ];

  const jsonLd = [
    {
      '@context': 'https://schema.org',
      '@type': 'WebPage',
      name: `${spec.label} Online | FileForge`,
      description: `${spec.description} Use FileForge online to convert ${inputFormats} to ${outputFormat}.`,
      url,
      isPartOf: { '@type': 'WebSite', name: 'FileForge', url: base },
    },
    {
      '@context': 'https://schema.org',
      '@type': 'BreadcrumbList',
      itemListElement: [
        { '@type': 'ListItem', position: 1, name: 'FileForge', item: base },
        { '@type': 'ListItem', position: 2, name: 'Converters', item: `${base}/#tools` },
        { '@type': 'ListItem', position: 3, name: spec.label, item: url },
      ],
    },
  ];

  return (
    <main className="seo-page">
      <header className="seo-topbar">
        <div className="shell seo-topbar-inner">
          <Link className="brand" href="/"><span className="brand-mark">F</span><span>FileForge</span></Link>
          <Link className="seo-back" href="/">Back to FileForge</Link>
        </div>
      </header>

      <article className="shell seo-content">
        <nav className="seo-breadcrumbs" aria-label="Breadcrumb">
          <Link href="/">FileForge</Link><span>/</span><Link href="/#tools">Converters</Link><span>/</span><span>{spec.label}</span>
        </nav>

        <section className="seo-hero">
          <div className="eyebrow">{getCategory(spec)}</div>
          <h1>{spec.label} Online</h1>
          <p>{spec.description} FileForge lets you run this conversion in your browser without installing desktop software.</p>
          <div className="seo-actions">
            <Link className="primary inline-cta" href={`/?converter=${spec.id}#tools`}>Use {spec.label}</Link>
            <Link className="secondary inline-cta" href="/">View all FileForge tools</Link>
          </div>
        </section>

        <div className="seo-grid">
          <section className="seo-card">
            <span className="section-kicker">Conversion details</span>
            <h2>{inputFormats} → {outputFormat}</h2>
            <div className="seo-facts">
              <div><span>Input formats</span><strong>{inputFormats}</strong></div>
              <div><span>Output format</span><strong>{outputFormat}</strong></div>
              <div><span>File size limit</span><strong>500 MB</strong></div>
              <div><span>Processing</span><strong>Temporary private storage</strong></div>
            </div>
          </section>

          <section className="seo-card">
            <span className="section-kicker">How it works</span>
            <ol className="seo-steps">
              <li><strong>Choose the tool.</strong><span>Select {spec.label} in the FileForge workspace.</span></li>
              <li><strong>Upload your file.</strong><span>Use a supported {inputFormats} file up to 500 MB.</span></li>
              <li><strong>Download the result.</strong><span>Review the generated {outputFormat} file and download it while the private link is active.</span></li>
            </ol>
          </section>
        </div>

        <section className="seo-card seo-explanation">
          <span className="section-kicker">About this converter</span>
          <h2>What to expect from {spec.label}</h2>
          <p>{getExactnessNote(spec)}</p>
          <p>FileForge is built for practical, everyday document and image conversions. The service uses temporary processing and short-lived result links instead of asking you to keep uploaded files online indefinitely.</p>
        </section>

        <section className="seo-card">
          <div className="section-head seo-section-head"><span className="section-kicker">FAQ</span><h2>Common {spec.label} questions</h2></div>
          <div className="faq-list seo-faq">
            {faq.map((item) => <details key={item.question}><summary>{item.question}</summary><p>{item.answer}</p></details>)}
          </div>
        </section>

        {related.length > 0 && (
          <section className="seo-card">
            <div className="section-head seo-section-head"><span className="section-kicker">Related tools</span><h2>More FileForge converters</h2></div>
            <div className="seo-related">
              {related.map((item) => <Link href={`/convert/${item.id}`} key={item.id}><strong>{item.label}</strong><span>{item.description}</span></Link>)}
            </div>
          </section>
        )}
      </article>

      <script dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, '\\u003c') }} />
    </main>
  );
}

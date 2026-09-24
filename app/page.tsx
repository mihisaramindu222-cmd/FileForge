'use client';

import { upload } from '@vercel/blob/client';
import { useEffect, useMemo, useRef, useState, type DragEvent, type KeyboardEvent } from 'react';
import AuthNav from '@/components/auth-nav';
import { createClient as createSupabaseClient } from '@/lib/supabase/client';
import { CONVERSIONS } from '@/lib/converters/catalog';

const MAX_UPLOAD_MB = 500;
const MAX_BYTES = MAX_UPLOAD_MB * 1024 * 1024;

type Mode = 'compress' | 'convert';
type Result = { downloadUrl: string; inputBytes: number; outputBytes: number; outputFilename: string; conversion: string; expiresAt: number };

function formatBytes(bytes: number) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

const pdfToOtherTools = CONVERSIONS.filter((item) => ['pdf-word', 'pdf-excel', 'pdf-powerpoint', 'pdf-jpg', 'pdf-png'].includes(item.id));
const officeToPdfTools = CONVERSIONS.filter((item) => ['word-pdf', 'excel-pdf', 'powerpoint-pdf'].includes(item.id));
const imageToPdfTools = CONVERSIONS.filter((item) => ['jpg-pdf', 'png-pdf'].includes(item.id));
const imageToImageTools = CONVERSIONS.filter((item) => ['jpg-png', 'jpg-webp', 'png-jpg', 'png-webp', 'webp-jpg', 'webp-png', 'heic-jpg'].includes(item.id));
const officeToOfficeTools = CONVERSIONS.filter((item) => ['word-powerpoint', 'powerpoint-word'].includes(item.id));
const spreadsheetTools = CONVERSIONS.filter((item) => ['xlsx-csv', 'csv-xlsx'].includes(item.id));

export default function Home() {
  const [mode, setMode] = useState<Mode>('compress');
  const [toolId, setToolId] = useState('pdf-word');
  const [file, setFile] = useState<File | null>(null);
  const [target, setTarget] = useState('best');
  const [level, setLevel] = useState('balanced');
  const [busy, setBusy] = useState(false);
  const [phase, setPhase] = useState<'idle' | 'uploading' | 'processing'>('idle');
  const [progress, setProgress] = useState(0);
  const [message, setMessage] = useState('');
  const [error, setError] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const [clock, setClock] = useState(() => Date.now());
  const inputRef = useRef<HTMLInputElement>(null);
  const requestRef = useRef<AbortController | null>(null);

  useEffect(() => {
    return () => requestRef.current?.abort();
  }, []);

  useEffect(() => {
    if (!result?.expiresAt) return;
    const timer = window.setInterval(() => setClock(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [result?.expiresAt]);

  const tool = useMemo(() => CONVERSIONS.find((item) => item.id === toolId) ?? CONVERSIONS[0], [toolId]);
  const accept = tool.fromExtensions.join(',');

  function clearResult() { setResult(null); }
  function choose(candidate?: File) {
    if (busy) return;
    clearResult(); setMessage(''); setError(false); setProgress(0);
    if (!candidate) return;
    const extension = `.${candidate.name.split('.').pop()?.toLowerCase() || ''}`;
    if (mode === 'compress') {
      if (candidate.type !== 'application/pdf' && extension !== '.pdf') { setFile(null); setError(true); setMessage('Please select a PDF file.'); return; }
    } else if (!tool.fromExtensions.includes(extension)) {
      setFile(null); setError(true); setMessage(`Please select ${tool.fromExtensions.join(' / ')} for this converter.`); return;
    }
    if (!candidate.size) { setFile(null); setError(true); setMessage('The selected file is empty.'); return; }
    if (candidate.size > MAX_BYTES) { setFile(null); setError(true); setMessage(`This file exceeds the ${MAX_UPLOAD_MB} MB FileForge limit.`); return; }
    setFile(candidate);
  }
  function changeMode(next: Mode) {
    if (busy) return;
    setMode(next); setFile(null); clearResult(); setMessage(''); setError(false); setProgress(0); setPhase('idle');
    if (inputRef.current) inputRef.current.value = '';
  }
  function changeTool(nextId: string) {
    if (busy) return;
    setToolId(nextId); setFile(null); clearResult(); setMessage(''); setError(false); setProgress(0); setPhase('idle');
    if (inputRef.current) inputRef.current.value = '';
  }
  function resetWorkspace() {
    if (busy) return;
    setFile(null); clearResult(); setMessage(''); setError(false); setProgress(0); setPhase('idle');
    if (inputRef.current) inputRef.current.value = '';
  }
  function removeFile() { resetWorkspace(); }
  function onDrop(event: DragEvent<HTMLDivElement>) { event.preventDefault(); event.currentTarget.classList.remove('dragging'); choose(event.dataTransfer.files?.[0]); }
  function onDropZoneKeyDown(event: KeyboardEvent<HTMLDivElement>) { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); inputRef.current?.click(); } }

  const contentTypeByExtension: Record<string, string> = {
    '.pdf': 'application/pdf',
    '.doc': 'application/msword',
    '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    '.xls': 'application/vnd.ms-excel',
    '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    '.ppt': 'application/vnd.ms-powerpoint',
    '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    '.csv': 'text/csv',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.png': 'image/png',
    '.webp': 'image/webp',
    '.heic': 'image/heic',
    '.heif': 'image/heif',
  };

  async function runJob() {
    if (!file || busy) return;
    try {
      const supabase = createSupabaseClient();
      let { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        const { data: anonymous, error: anonymousError } = await supabase.auth.signInAnonymously();
        if (anonymousError || !anonymous.user) {
          setError(true);
          setMessage('FileForge could not start a temporary session. Please try again.');
          return;
        }
        user = anonymous.user;
      }
      clearResult(); setBusy(true); setPhase('uploading'); setError(false); setProgress(0); setMessage(mode === 'compress' ? 'Uploading your PDF securely…' : `Uploading your file for ${tool.label}…`);
      const controller = new AbortController(); requestRef.current = controller;
      const extension = `.${file.name.split('.').pop()?.toLowerCase() || ''}`;
      const uploadId = crypto.randomUUID();
      const uploadPathname = `fileforge/${user.id}/${uploadId}/input${extension}`;
      const blob = await upload(uploadPathname, file, {
        access: 'private',
        contentType: contentTypeByExtension[`.${file.name.split('.').pop()?.toLowerCase() || ''}`] || file.type || undefined,
        handleUploadUrl: mode === 'compress' ? '/api/blob/upload' : '/api/convert/upload',
        clientPayload: JSON.stringify({
          filename: file.name,
          conversionId: mode === 'convert' ? tool.id : undefined,
          pathname: uploadPathname,
        }),
        multipart: file.size > 10 * 1024 * 1024,
        abortSignal: controller.signal,
        onUploadProgress: ({ percentage }) => {
          const percent = Math.min(90, Math.round(percentage * 0.9));
          setProgress(percent);
          setMessage(percent >= 88 ? 'Upload complete. Processing and validating…' : `Uploading… ${Math.round(percentage)}%`);
        },
      });
      if (!blob.pathname) throw new Error('The upload did not return a valid file reference.');
      const inputPathname = blob.pathname;
      setPhase('processing');
      setProgress(92); setMessage(mode === 'compress' ? 'Optimizing and validating your PDF…' : `Converting with ${tool.label}…`);
      const endpoint = mode === 'compress' ? '/api/compress' : '/api/convert';
      const body = mode === 'compress'
        ? { pathname: inputPathname, filename: file.name, level, target }
        : { pathname: inputPathname, filename: file.name, conversionId: tool.id };
      const response = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: controller.signal });
      const responseBody = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(typeof responseBody.error === 'string' ? responseBody.error : 'The job failed. Please try again.');
      const inputBytes = Number(responseBody.inputBytes);
      const outputBytes = Number(responseBody.outputBytes);
      const expiresAt = Number(responseBody.expiresAt || 0);
      if (!responseBody.downloadUrl || !Number.isFinite(inputBytes) || inputBytes < 1 || !Number.isFinite(outputBytes) || outputBytes < 1 || (expiresAt > 0 && !Number.isFinite(expiresAt))) {
        throw new Error('The server returned an invalid result.');
      }
      setResult({ downloadUrl: String(responseBody.downloadUrl), inputBytes, outputBytes, outputFilename: String(responseBody.outputFilename || `${file.name}-output`), conversion: String(responseBody.conversion || 'PDF Compressor'), expiresAt });
      setProgress(100); setMessage(mode === 'compress' ? 'Your compressed PDF is ready.' : `${tool.label} is ready to download.`);
    } catch (caught) {
      const errorMessage = caught instanceof DOMException && caught.name === 'AbortError'
        ? 'Upload cancelled. Your original file is unchanged.'
        : caught instanceof Error
          ? caught.message
          : 'The job failed. Please try again.';
      setError(true);
      setMessage(
        errorMessage.includes('Failed to retrieve the client token')
          ? 'File upload service is not connected correctly. Please check the Vercel Blob store configuration.'
          : errorMessage
      );
    } finally {
      requestRef.current = null; setBusy(false); setPhase('idle');
    }
  }
  function cancelUpload() {
    if (phase === 'uploading') requestRef.current?.abort();
  }

  const saved = result ? result.inputBytes - result.outputBytes : 0;
  const percent = result && saved > 0 && result.inputBytes > 0 ? (saved / result.inputBytes) * 100 : 0;
  const downloadExpired = Boolean(result?.expiresAt && clock >= result.expiresAt);

  return <main>
    <section className="ff-hero-shell">
      <header className="ff-hero-nav shell">
        <a className="ff-logo" href="#top" aria-label="FileForge home">
          <span className="ff-logo-mark">F</span>
          <span>FileForge</span>
        </a>
        <nav className="ff-main-nav" aria-label="Main navigation">
          <a className="ff-nav-active" href="#top">Home</a>
          <a href="#tools">Converters <span className="ff-chevron">⌄</span></a>
          <a href="#tools">Tools <span className="ff-chevron">⌄</span></a>
          <a href="/pricing">Pricing</a>
          <a href="/support">About</a>
        </nav>
        <div className="ff-nav-actions">
          <span className="ff-theme-dot" aria-hidden="true">☾</span>
          <AuthNav />
        </div>
      </header>

      <section id="top" className="ff-hero-content shell">
        <div className="ff-hero-copy">
          <div className="ff-pill"><span>✦</span> Fast · Secure · Easy to Use</div>
          <h1>Convert, Compress<br />and Manage <span>Your Files</span><br />All in One Place</h1>
          <p>FileForge is a powerful and easy-to-use online file converter that helps you convert, compress and manage your files in seconds. No installation. No hassle.</p>
          <div className="ff-hero-buttons">
            <button className="ff-gradient-btn" type="button" onClick={() => document.getElementById('tools')?.scrollIntoView({ behavior: 'smooth' })}>Start Converting <span>→</span></button>
            <a className="ff-outline-btn" href="#tools">View All Tools</a>
          </div>
          <div className="ff-trust-items">
            <span><b>◉</b><em>No Registration</em><small>Required</small></span>
            <span><b>♢</b><em>Your Files</em><small>Are Safe</small></span>
            <span><b>▣</b><em>Works on</em><small>Any Device</small></span>
          </div>
        </div>

        <div className="ff-studio-wrap">
          <div className="ff-orbit ff-orbit-one" />
          <div className="ff-orbit ff-orbit-two" />
          <div className="ff-file-float ff-pdf-float">PDF</div>
          <div className="ff-file-float ff-image-float">▧</div>
          <div className="ff-file-float ff-zip-float">ZIP</div>
          <div className="ff-file-float ff-doc-float">▤</div>

          <div className="ff-studio-card">
            <div className="ff-studio-tabs">
              <button className={mode === 'convert' ? 'active' : ''} type="button" onClick={() => changeMode('convert')}><span>◫</span>Convert</button>
              <button className={mode === 'compress' ? 'active' : ''} type="button" onClick={() => changeMode('compress')}><span>↘</span>Compress</button>
              <button type="button" onClick={() => setMode('convert')}><span>▧</span>Image Tools</button>
              <button type="button" onClick={() => document.getElementById('tools')?.scrollIntoView({ behavior: 'smooth' })}><span>⋮⋮</span>More</button>
            </div>

            <input ref={inputRef} type="file" accept={mode === 'compress' ? '.pdf,application/pdf' : accept} hidden onChange={(event) => choose(event.target.files?.[0])} />
            <div className={`ff-upload-box ${file ? 'has-file' : ''}`} onDragOver={(event) => { event.preventDefault(); event.currentTarget.classList.add('dragging'); }} onDragLeave={(event) => event.currentTarget.classList.remove('dragging')} onDrop={onDrop} onKeyDown={onDropZoneKeyDown} onClick={() => !busy && inputRef.current?.click()} role="button" tabIndex={busy ? -1 : 0} aria-label="Choose a file or drag and drop one here">
              <div className="ff-cloud-icon">⇧</div>
              <strong>{file ? 'File selected' : 'Drop your files here'}</strong>
              <span>{file ? 'Ready to process' : 'or click to browse'}</span>
              <small>Supports: PDF, JPG, PNG, DOC, XLS, PPT and more...</small>
              {!file && <button className="ff-studio-upload-btn" type="button" onClick={(event) => { event.stopPropagation(); inputRef.current?.click(); }}>Choose File</button>}
            </div>

            {file && <div className="ff-selected-file"><span className="ff-mini-file">{file.name.split('.').pop()?.slice(0,4).toUpperCase()}</span><div><strong title={file.name}>{file.name}</strong><small>{formatBytes(file.size)}</small></div><button type="button" onClick={(event) => { event.stopPropagation(); removeFile(); }} disabled={busy}>×</button></div>}

            {mode === 'compress' && <div className="ff-studio-settings">
              <div className="field"><label htmlFor="target-size">Target size</label><select id="target-size" value={target} onChange={(event) => setTarget(event.target.value)} disabled={busy}><option value="best">Best possible size</option>{['400','300','200','100','50','20','10','5','1'].map((value) => <option value={value} key={value}>{value} MB</option>)}</select></div>
              <div className="field"><label htmlFor="compression-level">Compression</label><select id="compression-level" value={level} onChange={(event) => setLevel(event.target.value)} disabled={busy}><option value="light">Light</option><option value="balanced">Balanced</option><option value="strong">Strong</option><option value="maximum">Maximum</option></select></div>
            </div>}

            {mode === 'convert' && <div className="ff-studio-settings"><div className="field"><label htmlFor="conversion-tool">Conversion</label><select id="conversion-tool" value={toolId} onChange={(event) => changeTool(event.target.value)} disabled={busy}><optgroup label="PDF → Office / Images">{pdfToOtherTools.map((item) => <option value={item.id} key={item.id}>{item.label}</option>)}</optgroup><optgroup label="Office → PDF">{officeToPdfTools.map((item) => <option value={item.id} key={item.id}>{item.label}</option>)}</optgroup><optgroup label="Image → PDF">{imageToPdfTools.map((item) => <option value={item.id} key={item.id}>{item.label}</option>)}</optgroup><optgroup label="Image → Image">{imageToImageTools.map((item) => <option value={item.id} key={item.id}>{item.label}</option>)}</optgroup><optgroup label="Office ↔ Office">{officeToOfficeTools.map((item) => <option value={item.id} key={item.id}>{item.label}</option>)}</optgroup><optgroup label="Spreadsheet">{spreadsheetTools.map((item) => <option value={item.id} key={item.id}>{item.label}</option>)}</optgroup></select></div></div>}

            <button className="ff-studio-action" disabled={!file || busy} onClick={runJob} type="button">{busy ? <><span className="spinner" /> Processing…</> : <>{mode === 'compress' ? 'Compress PDF' : `Convert ${tool.label}`} <span>→</span></>}</button>
            {phase === 'uploading' && <button className="ff-cancel" type="button" onClick={cancelUpload}>Cancel upload</button>}
            {busy && <div className="progress-track ff-progress" role="progressbar" aria-label="Processing progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress}><span style={{ width: `${progress}%` }} /></div>}
            {message && <div className={`ff-studio-result ${error ? 'error' : ''}`} role="status" aria-live="polite"><span className="result-icon">{error ? '!' : '✓'}</span><div><strong>{message}</strong>{result && <span>{formatBytes(result.inputBytes)} → {formatBytes(result.outputBytes)}{mode === 'compress' ? ` · ${saved > 0 ? `${formatBytes(saved)} saved (${percent.toFixed(1)}%)` : 'No size reduction was possible.'}` : ` · ${result.conversion}`}</span>}</div></div>}
            {result && <div className="ff-result-actions">{downloadExpired ? <button type="button" className="ff-outline-btn" onClick={() => { clearResult(); setMessage('The download link expired. Start another job to create a fresh link.'); setError(true); }}>Expired — start another</button> : <a className="ff-studio-action ff-download" href={result.downloadUrl} download={result.outputFilename} target="_blank" rel="noopener noreferrer">Download {mode === 'compress' ? 'compressed PDF' : result.outputFilename}</a>}<button type="button" className="ff-dark-btn" onClick={resetWorkspace}>Start another</button></div>}
          </div>
          <div className="ff-studio-caption">Private temporary files · 500 MB max · short-lived downloads</div>
        </div>
      </section>
    </section>

    <section className="ff-tool-section shell" id="tools">
      <div className="ff-section-heading"><span>✦ Popular Conversions</span><h2>Everything You Need</h2><p>Quickly convert, compress and edit your files with our powerful tools.</p></div>
      <div className="ff-tool-grid">
        {[
          ['▤','PDF Converter','Convert between PDF and other formats.','pdf-word'],
          ['▧','Image Converter','JPG, PNG, WEBP and more.','jpg-png'],
          ['▥','Document Converter','DOC, DOCX, XLS, PPT and more.','word-pdf'],
          ['⇩','Compress Files','Reduce file size without losing quality.','compress'],
          ['◫','JPG to PDF','Turn your images into PDF files.','jpg-pdf'],
          ['W','PDF to Word','Edit your PDF as a Word file.','pdf-word'],
          ['▧','WebP Converter','Convert WebP to JPG/PNG and more.','webp-jpg'],
          ['…','More Tools','Explore all available tools and features.','pdf-word'],
        ].map(([icon,title,desc,id], index) => <button key={title} type="button" className={`ff-tool-card ff-tool-${index + 1}`} onClick={() => { if(id === 'compress') changeMode('compress'); else { changeMode('convert'); changeTool(id); } document.getElementById('tools')?.scrollIntoView({ behavior: 'smooth' }); }}><span className="ff-tool-icon">{icon}</span><span className="ff-tool-copy"><strong>{title}</strong><small>{desc}</small></span><b>→</b></button>)}
      </div>
    </section>

    <section className="ff-why-section">
      <div className="shell ff-why-inner">
        <div className="ff-why-copy"><span>✦ Why Choose FileForge?</span><h2>Built for Speed.<br />Designed for You.</h2><p>We focus on giving you a better file conversion experience with powerful features, high security and a clean interface.</p><a className="ff-gradient-btn ff-small-btn" href="#tools">Learn More <span>→</span></a></div>
        <div className="ff-why-grid">
          <article><span>ϟ</span><strong>Lightning Fast</strong><small>Convert and process your files in seconds.</small></article>
          <article><span>♢</span><strong>Secure & Private</strong><small>Your files are never shared with anyone.</small></article>
          <article><span>☁</span><strong>No Installation</strong><small>Works directly in your browser.</small></article>
          <article><span>▣</span><strong>Fully Responsive</strong><small>Use it on any device, anywhere.</small></article>
        </div>
      </div>
    </section>

    <footer className="ff-site-footer">
      <div className="shell ff-footer-inner">
        <div className="ff-footer-brand"><a className="ff-logo" href="#top"><span className="ff-logo-mark">F</span><span>FileForge</span></a><small>Convert · Compress · Simplify</small></div>
        <nav><a href="#top">Home</a><a href="#tools">Converters</a><a href="#tools">Tools</a><a href="/pricing">Pricing</a><a href="/support">About</a><a href="/support">Contact</a></nav>
        <div className="ff-footer-social"><span>◉</span><span>◎</span><span>◍</span><span>↗</span><small>© {new Date().getFullYear()} FileForge. All rights reserved.</small></div>
      </div>
    </footer>
  </main>;
}

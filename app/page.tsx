'use client';

import { upload } from '@vercel/blob/client';
import { useEffect, useMemo, useRef, useState, type DragEvent, type KeyboardEvent } from 'react';
import AuthNav from '@/components/auth-nav';
import { createClient as createSupabaseClient } from '@/lib/supabase/client';
import AdSlot from '@/components/ad-slot';
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
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        setError(true);
        setMessage('Please log in before uploading a file.');
        return;
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
    <header className="site-header"><div className="shell nav-inner"><a className="brand" href="#top" aria-label="FileForge home"><span className="brand-mark">F</span><span>FileForge</span></a><nav aria-label="Main navigation"><a href="#how-it-works">How it works</a><a href="#tools">Converters</a><a href="#faq">FAQ</a><AuthNav /></nav></div></header>

    <section id="top" className="hero shell"><div className="eyebrow">✦ Private file tools in one place</div><h1>Compress, convert,<br /><span>then download.</span></h1><p className="hero-copy">PDF compression plus practical PDF, Office, image and spreadsheet converters in one simple workspace.</p><div className="trust-row"><span>🔒 Private temporary files</span><span>⚡ Up to 500 MB</span><span>📥 Short-lived downloads</span></div><AdSlot className="hero-ad" hideForPro /></section>

    <section id="tools" className="shell workspace" aria-labelledby="workspace-heading">
      <div className="mode-tabs" role="tablist" aria-label="FileForge tools">
        <button role="tab" aria-selected={mode === 'compress'} aria-controls="workspace-panel" type="button" className={mode === 'compress' ? 'active' : ''} onClick={() => changeMode('compress')}>PDF Compressor</button>
        <button role="tab" aria-selected={mode === 'convert'} aria-controls="workspace-panel" type="button" className={mode === 'convert' ? 'active' : ''} onClick={() => changeMode('convert')}>File Converter</button>
      </div>
      <div id="workspace-panel" role="tabpanel" className="compress-card">
        <div className="card-heading"><div><span className="section-kicker">{mode === 'compress' ? 'PDF compressor' : 'File converter'}</span><h2 id="workspace-heading">{mode === 'compress' ? 'Shrink your file' : 'Choose a conversion'}</h2><p>{mode === 'compress' ? 'Large PDFs upload directly to private storage, then the built-in Ghostscript engine compresses and validates them.' : 'Convert common PDF, Office, image and spreadsheet formats. Complex PDF-to-Office files may prioritize editable text or page fidelity depending on the source.'}</p></div><span className="limit-badge">500 MB max</span></div>

        {mode === 'convert' && <div className="field tool-picker"><label htmlFor="conversion-tool">Conversion</label><select id="conversion-tool" value={toolId} onChange={(event) => changeTool(event.target.value)} disabled={busy}><optgroup label="PDF → Office / Images">{pdfToOtherTools.map((item) => <option value={item.id} key={item.id}>{item.label}</option>)}</optgroup><optgroup label="Office → PDF">{officeToPdfTools.map((item) => <option value={item.id} key={item.id}>{item.label}</option>)}</optgroup><optgroup label="Image → PDF">{imageToPdfTools.map((item) => <option value={item.id} key={item.id}>{item.label}</option>)}</optgroup><optgroup label="Image → Image">{imageToImageTools.map((item) => <option value={item.id} key={item.id}>{item.label}</option>)}</optgroup><optgroup label="Office ↔ Office">{officeToOfficeTools.map((item) => <option value={item.id} key={item.id}>{item.label}</option>)}</optgroup><optgroup label="Spreadsheet">{spreadsheetTools.map((item) => <option value={item.id} key={item.id}>{item.label}</option>)}</optgroup></select><small>{tool.description}</small></div>}

        <input ref={inputRef} type="file" accept={mode === 'compress' ? '.pdf,application/pdf' : accept} hidden onChange={(event) => choose(event.target.files?.[0])} />
        <div className={`drop ${file ? 'has-file' : ''}`} onDragOver={(event) => { event.preventDefault(); event.currentTarget.classList.add('dragging'); }} onDragLeave={(event) => event.currentTarget.classList.remove('dragging')} onDrop={onDrop} onKeyDown={onDropZoneKeyDown} onClick={() => !busy && inputRef.current?.click()} role="button" tabIndex={busy ? -1 : 0} aria-label="Choose a file or drag and drop one here"><div className="upload-icon">↥</div><strong>{file ? 'File selected' : 'Drop your file here'}</strong><span>{file ? 'Ready to process' : 'or click to browse your device'}</span><small>{mode === 'compress' ? 'PDF only' : tool.fromExtensions.join(' · ')} · maximum 500 MB</small>{!file && <span className="secondary choose-file-button" aria-hidden="true">Choose file</span>}</div>
        {file && <div className="file-row"><div className="file-icon">{file.name.split('.').pop()?.slice(0,4).toUpperCase()}</div><div className="file-meta"><strong title={file.name}>{file.name}</strong><span>{formatBytes(file.size)}</span></div><button type="button" className="text-button" onClick={removeFile} disabled={busy}>Remove</button></div>}

        {mode === 'compress' && <div className="grid"><div className="field"><label htmlFor="target-size">Target size</label><select id="target-size" value={target} onChange={(event) => setTarget(event.target.value)} disabled={busy}><option value="best">Best possible size</option>{['400','300','200','100','50','20','10','5','1'].map((value) => <option value={value} key={value}>{value} MB</option>)}</select><small>Target is best-effort; the actual result is always reported.</small></div><div className="field"><label htmlFor="compression-level">Optimization level</label><select id="compression-level" value={level} onChange={(event) => setLevel(event.target.value)} disabled={busy}><option value="light">Light — preserve more quality</option><option value="balanced">Balanced — recommended</option><option value="strong">Strong — compact</option><option value="maximum">Maximum — most aggressive</option></select><small>Ghostscript adjusts image resolution and JPEG quality for each level.</small></div></div>}

        <button className="primary" disabled={!file || busy} onClick={runJob} type="button">{busy ? <><span className="spinner" /> Processing…</> : <>{mode === 'compress' ? 'Compress PDF' : `Convert ${tool.label}`} <span>→</span></>}</button>
        {phase === 'uploading' && <button className="text-button cancel-button" type="button" onClick={cancelUpload}>Cancel upload</button>}
        {busy && <div className="progress-track" role="progressbar" aria-label="Processing progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress}><span style={{ width: `${progress}%` }} /></div>}
        {message && <div className={`result ${error ? 'error' : ''}`} role="status" aria-live="polite"><span className="result-icon">{error ? '!' : '✓'}</span><div><strong>{message}</strong>{result && <span>{formatBytes(result.inputBytes)} → {formatBytes(result.outputBytes)}{mode === 'compress' ? ` · ${saved > 0 ? `${formatBytes(saved)} saved (${percent.toFixed(1)}%)` : 'No size reduction was possible.'}` : ` · ${result.conversion}`}</span>}</div></div>}
        {result && <div className="result-actions">{downloadExpired ? <button type="button" className="secondary" onClick={() => { clearResult(); setMessage('The download link expired. Start another job to create a fresh link.'); setError(true); }}>Download link expired — start another</button> : <a className="primary inline-cta" href={result.downloadUrl} download={result.outputFilename} target="_blank" rel="noopener noreferrer">Download {mode === 'compress' ? 'compressed PDF' : result.outputFilename}</a>}<button type="button" className="secondary" onClick={resetWorkspace}>Start another</button></div>}
        <p className="privacy">Free accounts get 3 successful jobs per day. Input files are deleted after processing; results use a short-lived private download link. Office ↔ Office conversions are page-preserving where editable layout cannot be guaranteed.</p>
      </div>
    </section>

    <section id="how-it-works" className="shell feature-section"><div className="section-head"><span className="section-kicker">How it works</span><h2>One workspace, two jobs</h2></div><div className="steps"><article><span>01</span><h3>Choose a tool</h3><p>Compress a PDF or select a file conversion from the menu.</p></article><article><span>02</span><h3>Upload securely</h3><p>Your file uploads directly to private temporary storage, up to 500 MB.</p></article><article><span>03</span><h3>Review and download</h3><p>FileForge reports the resulting size and gives you a short-lived download.</p></article></div></section>

    <section className="shell converter-grid"><div className="section-head"><span className="section-kicker">All converters</span><h2>Everyday file conversions</h2></div><div className="converter-cards">{CONVERSIONS.map((item) => <button type="button" key={item.id} onClick={() => { changeMode('convert'); changeTool(item.id); document.getElementById('tools')?.scrollIntoView({ behavior: 'smooth' }); }}><strong>{item.label}</strong><span>{item.description}</span></button>)}</div></section>

    <section id="faq" className="shell faq-section"><div className="section-head"><span className="section-kicker">FAQ</span><h2>Common questions</h2></div><div className="faq-list"><details open><summary>What is the maximum file size?</summary><p>500 MB for FileForge uploads. Large conversions can take longer, and actual processing time depends on the Vercel plan and the complexity of the source file.</p></details><details><summary>Does FileForge permanently store my files?</summary><p>Input files are deleted after processing. Output files are private and accessed with short-lived signed download links.</p></details><details><summary>Will PDF → Word preserve the exact layout?</summary><p>Text-based PDFs are converted into editable DOCX text. Scanned PDFs fall back to page images, which preserves appearance but is not the same as OCR.</p></details><details><summary>Will PDF → Excel detect tables perfectly?</summary><p>FileForge uses PDF text positioning to create rows and columns. Complex or scanned tables may need manual cleanup after conversion.</p></details></div></section>

    <section className="shell pricing-callout"><div><span className="section-kicker">Free + Pro</span><h2>Compress and convert more when you need it.</h2><p>Create a free account for 3 successful daily jobs, or upgrade to Pro for higher usage and an ad-free experience.</p></div><a className="primary inline-cta" href="/pricing">View plans</a></section>
    <footer className="site-footer"><div className="shell footer-inner"><span>© {new Date().getFullYear()} FileForge</span><span>Private PDF compression and practical file conversion.</span><span><a href="/privacy">Privacy</a> · <a href="/terms">Terms</a> · <a href="/support">Support</a></span></div></footer>
  </main>;
}

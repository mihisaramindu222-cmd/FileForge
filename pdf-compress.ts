import { spawn } from 'node:child_process';
import { promises as fs } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import path from 'node:path';
import { CompressionLevel, CompressionTarget, ConverterError, MAX_PAGE_COUNT, type ConverterResult } from './types';

const GS_TIMEOUT_MS = 270_000;
const PDFINFO_TIMEOUT_MS = 20_000;
const GS_VALIDATE_TIMEOUT_MS = 60_000;
const levels: readonly CompressionLevel[] = ['light', 'balanced', 'strong', 'maximum'];

type Profile = {
  name: string;
  pdfSettings: string;
  colorDpi: number;
  grayDpi: number;
  monoDpi: number;
  jpegQuality: number;
};

export type InputStreamFactory = () => Promise<ReadableStream<Uint8Array>>;

const profiles: Record<CompressionLevel, Profile> = {
  light: {
    name: 'Light',
    pdfSettings: '/printer',
    colorDpi: 150,
    grayDpi: 150,
    monoDpi: 300,
    jpegQuality: 88,
  },
  balanced: {
    name: 'Balanced',
    pdfSettings: '/ebook',
    colorDpi: 120,
    grayDpi: 120,
    monoDpi: 240,
    jpegQuality: 80,
  },
  strong: {
    name: 'Strong',
    pdfSettings: '/screen',
    colorDpi: 96,
    grayDpi: 96,
    monoDpi: 180,
    jpegQuality: 72,
  },
  maximum: {
    name: 'Maximum',
    pdfSettings: '/screen',
    colorDpi: 72,
    grayDpi: 72,
    monoDpi: 144,
    jpegQuality: 60,
  },
};

export function parseLevel(value: string | null): CompressionLevel {
  return levels.includes(value as CompressionLevel) ? (value as CompressionLevel) : 'balanced';
}

export function parseTarget(value: string | null): CompressionTarget {
  if (!value || value === 'best') return 'best';
  const megabytes = Number(value);
  if (!Number.isFinite(megabytes) || megabytes < 0.1 || megabytes > 500) {
    throw new ConverterError('Choose a target between 0.1 MB and 500 MB, or Best possible size.', 400);
  }
  return megabytes;
}

async function ensureGhostscript() {
  try {
    const result = await runCommand('gs', ['--version'], { timeoutMs: 10_000, maxStdoutBytes: 64 * 1024 });
    if (result.exitCode !== 0 || result.timedOut || !result.stdout.trim()) throw new Error('Ghostscript check failed');
  } catch {
    throw new ConverterError('The PDF compressor is temporarily unavailable because Ghostscript is not installed.', 503);
  }
}

function collectLimited(stream: Readable, maxBytes: number, label: string) {
  return new Promise<string>((resolve, reject) => {
    const chunks: Buffer[] = [];
    let total = 0;
    stream.on('data', (chunk: Buffer | string) => {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      total += buffer.length;
      if (total <= maxBytes) chunks.push(buffer);
    });
    stream.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    stream.on('error', (error) => reject(new Error(`${label} output could not be read: ${error instanceof Error ? error.message : String(error)}`)));
  });
}

async function runCommand(
  command: string,
  args: string[],
  options: { timeoutMs: number; maxStdoutBytes?: number; maxStderrBytes?: number } = { timeoutMs: 30_000 },
) {
  const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] });
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    child.kill('SIGKILL');
  }, options.timeoutMs);

  try {
    const stdoutPromise = collectLimited(child.stdout, options.maxStdoutBytes ?? 256 * 1024, `${command} stdout`);
    const stderrPromise = collectLimited(child.stderr, options.maxStderrBytes ?? 256 * 1024, `${command} stderr`);
    const exitCode = await new Promise<number>((resolve, reject) => {
      child.once('error', reject);
      child.once('close', (code) => resolve(code ?? -1));
    });
    const [stdout, stderr] = await Promise.all([stdoutPromise, stderrPromise]);
    return { exitCode, stdout, stderr, timedOut };
  } finally {
    clearTimeout(timer);
  }
}

async function runCommandWithInput(
  command: string,
  args: string[],
  inputStream: ReadableStream<Uint8Array>,
  timeoutMs: number,
) {
  const child = spawn(command, args, { stdio: ['pipe', 'ignore', 'pipe'] });
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    child.kill('SIGKILL');
  }, timeoutMs);

  child.stdin.on('error', () => {
    // pipeline() observes the stream failure; avoid an unhandled child-stdin error.
  });

  const stderrPromise = collectLimited(child.stderr, 512 * 1024, `${command} stderr`);
  const exitPromise = new Promise<number>((resolve, reject) => {
    child.once('error', reject);
    child.once('close', (code) => resolve(code ?? -1));
  });

  let pipelineError: unknown = null;
  try {
    await pipeline(Readable.fromWeb(inputStream as never), child.stdin);
  } catch (error) {
    pipelineError = error;
  }

  try {
    const [exitCode, stderr] = await Promise.all([exitPromise, stderrPromise]);
    return { exitCode, stderr, timedOut, pipelineError };
  } finally {
    clearTimeout(timer);
  }
}

async function inspectPdf(inputStreamFactory: InputStreamFactory) {
  const inputStream = await inputStreamFactory();
  const child = spawn('pdfinfo', ['-'], { stdio: ['pipe', 'pipe', 'pipe'] });
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    child.kill('SIGKILL');
  }, PDFINFO_TIMEOUT_MS);
  child.stdin.on('error', () => undefined);
  const stdoutPromise = collectLimited(child.stdout, 256 * 1024, 'pdfinfo stdout');
  const stderrPromise = collectLimited(child.stderr, 256 * 1024, 'pdfinfo stderr');
  const exitPromise = new Promise<number>((resolve, reject) => {
    child.once('error', reject);
    child.once('close', (code) => resolve(code ?? -1));
  });

  let pipeError: unknown = null;
  try {
    await pipeline(Readable.fromWeb(inputStream as never), child.stdin);
  } catch (error) {
    pipeError = error;
  }

  const [exitCode, stdout] = await Promise.all([exitPromise, stdoutPromise]);
  await stderrPromise;
  clearTimeout(timer);
  if (timedOut || exitCode !== 0 || pipeError) {
    throw new ConverterError('This file is not a supported, readable PDF. Encrypted or damaged PDFs are not accepted.', 422);
  }
  const pagesMatch = stdout.match(/^Pages:\s+(\d+)/m);
  const pages = pagesMatch ? Number(pagesMatch[1]) : NaN;
  if (!Number.isInteger(pages) || pages < 1) {
    throw new ConverterError('This file is not a supported, readable PDF. Encrypted or damaged PDFs are not accepted.', 422);
  }
  if (pages > MAX_PAGE_COUNT) {
    throw new ConverterError(`This PDF has too many pages. FileForge supports up to ${MAX_PAGE_COUNT.toLocaleString()} pages per job.`, 422);
  }
  return pages;
}

function gsArgs(profile: Profile) {
  return [
    '-dSAFER',
    '-dBATCH',
    '-dNOPAUSE',
    '-dQUIET',
    '-sDEVICE=pdfwrite',
    '-dCompatibilityLevel=1.7',
    '-dEmbedAllFonts=true',
    '-dSubsetFonts=true',
    '-dCompressFonts=true',
    '-dCompressPages=true',
    '-dDetectDuplicateImages=true',
    `-dPDFSETTINGS=${profile.pdfSettings}`,
    '-dDownsampleColorImages=true',
    '-dDownsampleGrayImages=true',
    '-dDownsampleMonoImages=true',
    '-dColorImageDownsampleType=/Bicubic',
    '-dGrayImageDownsampleType=/Bicubic',
    '-dMonoImageDownsampleType=/Subsample',
    `-dColorImageResolution=${profile.colorDpi}`,
    `-dGrayImageResolution=${profile.grayDpi}`,
    `-dMonoImageResolution=${profile.monoDpi}`,
    '-dAutoFilterColorImages=false',
    '-dAutoFilterGrayImages=false',
    '-dColorImageFilter=/DCTEncode',
    '-dGrayImageFilter=/DCTEncode',
    `-dJPEGQ=${profile.jpegQuality}`,
    '-dPreserveEPSInfo=false',
  ];
}

async function runGhostscript(inputStreamFactory: InputStreamFactory, destinationPath: string, profile: Profile) {
  await fs.rm(destinationPath, { force: true }).catch(() => undefined);
  const result = await runCommandWithInput(
    'gs',
    [...gsArgs(profile), `-sOutputFile=${destinationPath}`, '-'],
    await inputStreamFactory(),
    GS_TIMEOUT_MS,
  );
  if (result.timedOut) {
    await fs.rm(destinationPath, { force: true }).catch(() => undefined);
    throw new ConverterError('Compression took too long for this PDF. Please try a simpler PDF or a lower-complexity document.', 504);
  }
  if (result.exitCode !== 0) {
    await fs.rm(destinationPath, { force: true }).catch(() => undefined);
    const detail = result.stderr.trim().replace(/\s+/g, ' ');
    throw new ConverterError(`Ghostscript could not process this PDF safely. ${detail.slice(0, 180) || 'Processing failed.'}`, 422);
  }

  const stat = await fs.stat(/* turbopackIgnore: true */ destinationPath).catch(() => null);
  if (!stat || stat.size < 5) {
    throw new ConverterError('Ghostscript produced an invalid PDF. Your original file is unchanged.', 422);
  }

  const header = Buffer.alloc(5);
  const handle = await fs.open(destinationPath, 'r');
  try {
    await handle.read(header, 0, 5, 0);
  } finally {
    await handle.close();
  }
  if (header.toString('ascii') !== '%PDF-') {
    throw new ConverterError('Ghostscript produced an invalid PDF. Your original file is unchanged.', 422);
  }

  const validation = await runCommand('gs', [
    '-dSAFER',
    '-dBATCH',
    '-dNOPAUSE',
    '-dQUIET',
    '-sDEVICE=nullpage',
    destinationPath,
  ], { timeoutMs: GS_VALIDATE_TIMEOUT_MS, maxStdoutBytes: 64 * 1024, maxStderrBytes: 256 * 1024 });
  if (validation.timedOut || validation.exitCode !== 0) {
    throw new ConverterError('The generated PDF did not pass validation. Your original file is unchanged.', 422);
  }

  return stat.size;
}

/**
 * Ghostscript-backed PDF compression for the single-deployment Vercel container.
 *
 * Large inputs are streamed directly from private Blob storage into Ghostscript.
 * This avoids writing the original 500 MB input into /tmp and keeps only one
 * candidate output on disk at a time.
 */
export async function compressPdf(
  inputSize: number,
  inputStreamFactory: InputStreamFactory,
  workDir: string,
  level: CompressionLevel,
  target: CompressionTarget,
): Promise<ConverterResult> {
  await ensureGhostscript();
  if (!Number.isSafeInteger(inputSize) || inputSize < 1) {
    throw new ConverterError('The uploaded PDF size could not be determined.', 422);
  }
  await inspectPdf(inputStreamFactory);

  const requested = target === 'best' ? null : target * 1024 * 1024;
  const startIndex = levels.indexOf(level);
  const candidateProfiles = levels.slice(startIndex).map((name) => ({ profile: profiles[name], level: name }));
  const outPath = path.join(workDir, `candidate-${crypto.randomUUID()}.pdf`);

  let bestSize = inputSize;
  let bestLevel = level;
  let bestExists = false;
  let lastGeneratedLevel: CompressionLevel | null = null;

  for (const candidate of candidateProfiles) {
    let size: number;
    try {
      size = await runGhostscript(inputStreamFactory, outPath, candidate.profile);
    } catch (error) {
      await fs.rm(outPath, { force: true }).catch(() => undefined);
      if (error instanceof ConverterError && bestExists) continue;
      throw error;
    }
    lastGeneratedLevel = candidate.level;

    if (size < bestSize) {
      bestSize = size;
      bestLevel = candidate.level;
      bestExists = true;
    } else {
      await fs.rm(outPath, { force: true }).catch(() => undefined);
    }

    if (requested !== null && size <= requested && size < inputSize) {
      bestSize = size;
      bestLevel = candidate.level;
      bestExists = true;
      break;
    }
  }

  if (!bestExists) {
    return {
      outputPath: '',
      inputBytes: inputSize,
      outputBytes: inputSize,
      targetReached: requested === null ? null : inputSize <= requested,
      level,
    };
  }

  // Only one candidate is kept on disk at a time. If a later profile was larger
  // than the best profile, regenerate the best one into the same path.
  if (lastGeneratedLevel !== bestLevel) {
    await runGhostscript(inputStreamFactory, outPath, profiles[bestLevel]);
  }

  return {
    outputPath: outPath,
    inputBytes: inputSize,
    outputBytes: bestSize,
    targetReached: requested === null ? null : bestSize <= requested,
    level: bestLevel,
  };
}

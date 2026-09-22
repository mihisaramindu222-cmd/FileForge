import { promises as fs, createWriteStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { ConversionId, ConverterResult, ConverterError, MAX_PAGE_COUNT, MAX_UPLOAD_BYTES } from './types';
import { CONVERSIONS, type ConversionSpec } from './catalog';
export type { ConversionSpec } from './catalog';

const COMMAND_TIMEOUT_MS = 270_000;
const PDF_RENDER_TIMEOUT_MS = 180_000;
const MAX_RENDER_PAGES = 100;
let resolvedImageCommand: string | undefined;

function imageCommand() {
  if (resolvedImageCommand) return resolvedImageCommand;
  const configured = process.env.FILEFORGE_IMAGE_COMMAND;
  if (configured) {
    resolvedImageCommand = configured;
    return configured;
  }
  for (const candidate of ['magick', 'convert']) {
    const probe = spawnSync('sh', ['-lc', `command -v ${candidate}`], { stdio: 'ignore' });
    if (probe.status === 0) {
      resolvedImageCommand = candidate;
      return candidate;
    }
  }
  throw new ConverterError('Image conversion is temporarily unavailable because ImageMagick is not installed.', 503);
}

const conversionMap = new Map(CONVERSIONS.map((spec) => [spec.id, spec]));

export function getConversion(id: string): ConversionSpec {
  const spec = conversionMap.get(id as ConversionId);
  if (!spec) throw new ConverterError('Unknown conversion tool.', 400);
  return spec;
}

function commandResult(args: { command: string; argv: string[]; cwd?: string; env?: NodeJS.ProcessEnv; timeoutMs?: number }) {
  return new Promise<{ exitCode: number; stdout: string; stderr: string; timedOut: boolean }>((resolve, reject) => {
    const child = spawn(args.command, args.argv, { cwd: args.cwd, env: { ...process.env, ...args.env }, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    const timeout = setTimeout(() => { timedOut = true; child.kill('SIGKILL'); }, args.timeoutMs ?? COMMAND_TIMEOUT_MS);
    child.stdout.on('data', (chunk: Buffer) => { if (stdout.length < 64 * 1024) stdout += chunk.toString('utf8'); });
    child.stderr.on('data', (chunk: Buffer) => { if (stderr.length < 256 * 1024) stderr += chunk.toString('utf8'); });
    child.on('error', (error) => { clearTimeout(timeout); reject(error); });
    child.on('close', (code) => { clearTimeout(timeout); resolve({ exitCode: code ?? 1, stdout, stderr, timedOut }); });
  });
}

async function runOrThrow(command: string, argv: string[], cwd: string, env?: NodeJS.ProcessEnv, timeoutMs = COMMAND_TIMEOUT_MS) {
  let result: Awaited<ReturnType<typeof commandResult>>;
  try {
    result = await commandResult({ command, argv, cwd, env, timeoutMs });
  } catch (error) {
    throw new ConverterError(`${command} is not available in the deployment image.`, 500);
  }
  if (result.timedOut) throw new ConverterError('The conversion took too long. Please try a smaller or simpler file.', 504);
  if (result.exitCode !== 0) {
    const detail = (result.stderr || result.stdout).trim().replace(/\s+/g, ' ');
    throw new ConverterError(`${command} could not convert this file. ${detail.slice(0, 220) || 'Processing failed.'}`, 422);
  }
  return result;
}

async function saveBlobStream(inputStream: ReadableStream<Uint8Array>, destination: string) {
  await pipeline(Readable.fromWeb(inputStream as never), createWriteStream(destination));
}

export async function downloadInput(getStream: () => Promise<ReadableStream<Uint8Array>>, destination: string, size: number) {
  if (size < 1 || size > MAX_UPLOAD_BYTES) throw new ConverterError('The uploaded file exceeds the 500 MB FileForge limit.', 413);
  const stream = await getStream();
  await saveBlobStream(stream, destination);
  const stat = await fs.stat(destination);
  if (stat.size !== size) throw new ConverterError('The uploaded file could not be read completely. Please upload it again.', 422);
}

async function commandOutputPath(directory: string, expectedExtension: string) {
  const entries = await fs.readdir(directory);
  const match = entries.find((entry) => entry.toLowerCase().endsWith(expectedExtension.toLowerCase()));
  if (!match) throw new ConverterError(`The conversion did not create a ${expectedExtension.replace('.', '').toUpperCase()} file.`, 422);
  return path.join(directory, match);
}

function assertWorkspacePath(workDir: string, candidate: string) {
  const root = path.resolve(workDir);
  const resolved = path.resolve(candidate);
  if (resolved !== root && !resolved.startsWith(`${root}${path.sep}`)) {
    throw new ConverterError('The converter generated an unsafe temporary file path.', 500);
  }
  return resolved;
}

async function pdfPageCount(inputPath: string, cwd: string) {
  const result = await runOrThrow('pdfinfo', [inputPath], cwd, undefined, 20_000);
  const match = result.stdout.match(/^Pages:\s+(\d+)$/m);
  const pages = match ? Number(match[1]) : 0;
  if (!Number.isInteger(pages) || pages < 1) throw new ConverterError('Could not determine the PDF page count.', 422);
  if (pages > MAX_PAGE_COUNT) throw new ConverterError(`This PDF has too many pages. FileForge supports up to ${MAX_PAGE_COUNT.toLocaleString()} pages per job.`, 422);
  return pages;
}

async function renderPdfPages(inputPath: string, directory: string, format: 'png' | 'jpeg') {
  const pages = await pdfPageCount(inputPath, directory);
  if (pages > MAX_RENDER_PAGES) throw new ConverterError(`This conversion renders PDF pages as images and is limited to ${MAX_RENDER_PAGES} pages. Use PDF Compressor or split the PDF first for larger documents.`, 422);
  const prefix = path.join(directory, 'page');
  const args = format === 'png'
    ? ['-r', '110', '-png', inputPath, prefix]
    : ['-r', '110', '-jpeg', '-jpegopt', 'quality=85', inputPath, prefix];
  await runOrThrow('pdftoppm', args, directory, undefined, PDF_RENDER_TIMEOUT_MS);
  const entries = (await fs.readdir(directory)).filter((entry) => entry.startsWith('page-') && entry.toLowerCase().endsWith(`.${format === 'png' ? 'png' : 'jpg'}`)).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  if (entries.length !== pages) throw new ConverterError('Not all PDF pages could be rendered.', 422);
  return entries.map((entry) => path.join(directory, entry));
}

async function zipFiles(files: string[], outputPath: string, cwd: string) {
  const relativeFiles = files.map((file) => path.basename(file));
  await runOrThrow('zip', ['-q', '-j', outputPath, ...relativeFiles], cwd, undefined, 180_000);
}

async function validateGeneratedOutput(spec: ConversionSpec, outputPath: string) {
  const ext = path.extname(outputPath).toLowerCase();
  if (['.docx', '.pptx', '.xlsx', '.zip'].includes(ext)) {
    await runOrThrow('unzip', ['-t', outputPath], path.dirname(outputPath), undefined, 30_000);
    if (ext === '.docx' || ext === '.pptx') {
      const validationDir = path.join(path.dirname(outputPath), 'office-validation');
      await fs.mkdir(validationDir, { recursive: true });
      await runOrThrow('libreoffice', [
        '--headless', '--nologo', '--nodefault', '--nofirststartwizard', '--norestore', '--nolockcheck',
        '-env:UserInstallation=file://' + path.join(validationDir, 'profile'),
        '--convert-to', 'pdf', '--outdir', validationDir, outputPath,
      ], validationDir, { ...process.env, HOME: validationDir }, 90_000);
      const renderedPdf = await commandOutputPath(validationDir, '.pdf');
      await runOrThrow('pdfinfo', [renderedPdf], validationDir, undefined, 30_000);
    }
    return;
  }
  if (ext === '.pdf') {
    await runOrThrow('pdfinfo', [outputPath], path.dirname(outputPath), undefined, 30_000);
    return;
  }
  if (spec.kind === 'image') {
    const header = Buffer.alloc(32);
    const handle = await fs.open(outputPath, 'r');
    try {
      await handle.read(header, 0, header.length, 0);
    } finally {
      await handle.close();
    }
    const isJpeg = header[0] === 0xff && header[1] === 0xd8 && header[2] === 0xff;
    const isPng = header.subarray(0, 8).equals(Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]));
    const isWebp = header.subarray(0, 4).toString('ascii') === 'RIFF' && header.subarray(8, 12).toString('ascii') === 'WEBP';
    if ((ext === '.jpg' && !isJpeg) || (ext === '.png' && !isPng) || (ext === '.webp' && !isWebp)) {
      throw new ConverterError('The conversion produced an invalid image file.', 422);
    }
  }
  if (ext === '.csv') {
    const sample = await fs.readFile(outputPath, { encoding: 'utf8' });
    if (!sample.trim()) throw new ConverterError('The conversion produced an empty CSV file.', 422);
  }
}


async function convertOfficeDocumentToPdf(inputPath: string, workDir: string) {
  const outputDir = path.join(workDir, 'office-intermediate-pdf');
  const profileDir = path.join(workDir, 'lo-profile-intermediate-pdf');
  await fs.mkdir(outputDir, { recursive: true });
  await fs.mkdir(profileDir, { recursive: true });
  await runOrThrow('libreoffice', [
    '--headless', '--nologo', '--nodefault', '--nofirststartwizard', '--norestore', '--nolockcheck',
    `-env:UserInstallation=file://${profileDir}`,
    '--convert-to', 'pdf', '--outdir', outputDir, inputPath,
  ], workDir, { ...process.env, HOME: workDir }, 240_000);
  return commandOutputPath(outputDir, '.pdf');
}

function baseName(filename: string) {
  return filename.replace(/\.[^.]+$/, '').replace(/[^A-Za-z0-9._ -]/g, '_').slice(0, 90) || 'file';
}

function escapeXml(value: string) {
  return value.replace(/[<>&'"]/g, (char) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' }[char] || char));
}

export async function convertFile(inputPath: string, filename: string, conversionId: ConversionId, workDir: string): Promise<ConverterResult> {
  const spec = getConversion(conversionId);
  const ext = path.extname(filename).toLowerCase();
  if (!spec.fromExtensions.includes(ext)) throw new ConverterError(`This tool expects ${spec.fromExtensions.join(', ')} files.`, 422);

  const stem = baseName(filename);
  let outputPath = path.join(/* turbopackIgnore: true */ workDir, `${stem}${spec.outputExtension}`);
  let outputFilename = path.basename(outputPath);
  let outputMime = spec.outputMime;

  if (spec.kind === 'office-to-pdf' || spec.kind === 'spreadsheet') {
    const profileDir = path.join(workDir, 'lo-profile');
    const outputDir = path.join(workDir, 'office-output');
    await fs.mkdir(profileDir, { recursive: true });
    await fs.mkdir(outputDir, { recursive: true });
    const convertTo = spec.id === 'xlsx-csv' ? 'csv' : spec.id === 'csv-xlsx' ? 'xlsx' : 'pdf';
    await runOrThrow('libreoffice', [
      '--headless', '--nologo', '--nodefault', '--nofirststartwizard', '--norestore', '--nolockcheck',
      `-env:UserInstallation=file://${profileDir}`,
      '--convert-to', convertTo,
      '--outdir', outputDir,
      inputPath,
    ], workDir, { ...process.env, HOME: workDir }, 240_000);
    outputPath = await commandOutputPath(outputDir, `.${convertTo}`);
  } else if (spec.kind === 'image') {
    if (['jpg-pdf', 'png-pdf'].includes(spec.id)) {
      const outputDir = path.join(workDir, 'image-pdf-output');
      const profileDir = path.join(workDir, 'lo-profile-image-pdf');
      await fs.mkdir(outputDir, { recursive: true });
      await fs.mkdir(profileDir, { recursive: true });
      await runOrThrow('libreoffice', ['--headless', '--nologo', '--nodefault', '--nofirststartwizard', '--norestore', '--nolockcheck', `-env:UserInstallation=file://${profileDir}`, '--convert-to', 'pdf', '--outdir', outputDir, inputPath], workDir, { ...process.env, HOME: workDir }, 120_000);
      const generated = await commandOutputPath(outputDir, '.pdf');
      await fs.copyFile(generated, outputPath);
    } else if (spec.id === 'heic-jpg') {
      // Use libheif's native decoder instead of relying on the distro ImageMagick
      // build having HEIC/HEIF delegates enabled. This keeps HEIC conversion
      // deterministic across the Vercel container image.
      await runOrThrow('heif-convert', [inputPath, outputPath], workDir, undefined, 120_000);
    } else if (spec.id === 'png-jpg' || spec.id === 'webp-jpg') {
      await runOrThrow(imageCommand(), [inputPath, '-auto-orient', '-background', 'white', '-alpha', 'remove', '-alpha', 'off', '-strip', '-quality', '88', outputPath], workDir);
    } else if (spec.id === 'jpg-png') {
      await runOrThrow(imageCommand(), [inputPath, '-auto-orient', '-strip', outputPath], workDir);
    } else if (spec.id === 'jpg-webp' || spec.id === 'png-webp') {
      await runOrThrow(imageCommand(), [inputPath, '-auto-orient', '-strip', '-quality', '86', outputPath], workDir);
    } else if (spec.id === 'webp-png') {
      await runOrThrow(imageCommand(), [inputPath, '-auto-orient', '-strip', outputPath], workDir);
    } else {
      throw new ConverterError('Unsupported image conversion.', 422);
    }
  } else if (spec.kind === 'pdf-to-images') {
    const renderDir = path.join(workDir, 'rendered');
    await fs.mkdir(renderDir, { recursive: true });
    const isPng = spec.id === 'pdf-png';
    const files = await renderPdfPages(inputPath, renderDir, isPng ? 'png' : 'jpeg');
    if (files.length === 1) {
      outputPath = files[0];
      outputFilename = `${stem}${isPng ? '.png' : '.jpg'}`;
      outputMime = isPng ? 'image/png' : 'image/jpeg';
    } else {
      outputPath = path.join(workDir, `${stem}-${isPng ? 'png' : 'jpg'}-pages.zip`);
      await zipFiles(files, outputPath, renderDir);
      outputFilename = path.basename(outputPath);
      outputMime = 'application/zip';
    }
  } else if (spec.kind === 'pdf-to-office') {
    await pdfPageCount(inputPath, workDir);
    if (spec.id === 'pdf-word') {
      await runOrThrow('python3', [path.join(process.cwd(), 'scripts', 'pdf_office.py'), 'word', inputPath, outputPath, workDir], workDir, { ...process.env, HOME: workDir }, 240_000);
    } else if (spec.id === 'pdf-powerpoint') {
      await runOrThrow('python3', [path.join(process.cwd(), 'scripts', 'pdf_office.py'), 'powerpoint', inputPath, outputPath, workDir], workDir, { ...process.env, HOME: workDir }, 240_000);
    } else if (spec.id === 'pdf-excel') {
      const textPath = path.join(workDir, 'extracted.txt');
      await runOrThrow('pdftotext', ['-layout', inputPath, textPath], workDir, undefined, 60_000);
      const textStat = await fs.stat(textPath);
      if (textStat.size > 100 * 1024 * 1024) throw new ConverterError('The PDF contains too much extracted text for a safe Excel conversion. Please split the PDF and try again.', 413);
      const raw = await fs.readFile(textPath, 'utf8');
      const rows = raw.split(/\r?\n/).map((line) => line.trimEnd()).filter((line) => line.trim().length > 0).map((line) => line.split(/\s{2,}/).map((cell) => cell.trim()));
      const tsv = rows.length ? rows.map((row) => row.map((cell) => cell.replace(/\t/g, ' ')).join('\t')).join('\n') : 'No extractable table text found.';
      const tsvPath = path.join(workDir, `${stem}.tsv`);
      await fs.writeFile(tsvPath, tsv, 'utf8');
      const outputDir = path.join(workDir, 'excel-output');
      await fs.mkdir(outputDir, { recursive: true });
      const profileDir = path.join(workDir, 'lo-profile-excel');
      await fs.mkdir(profileDir, { recursive: true });
      await runOrThrow('libreoffice', ['--headless', '--nologo', '--nodefault', '--nofirststartwizard', '--norestore', '--nolockcheck', `-env:UserInstallation=file://${profileDir}`, '--convert-to', 'xlsx', '--outdir', outputDir, tsvPath], workDir, { ...process.env, HOME: workDir }, 120_000);
      outputPath = await commandOutputPath(outputDir, '.xlsx');
    }
  } else if (spec.kind === 'office-to-office') {
    const intermediatePdf = await convertOfficeDocumentToPdf(inputPath, workDir);
    if (spec.id === 'word-powerpoint') {
      await runOrThrow('python3', [path.join(process.cwd(), 'scripts', 'pdf_office.py'), 'powerpoint', intermediatePdf, outputPath, workDir], workDir, { ...process.env, HOME: workDir }, 240_000);
    } else if (spec.id === 'powerpoint-word') {
      await runOrThrow('python3', [path.join(process.cwd(), 'scripts', 'pdf_office.py'), 'word', intermediatePdf, outputPath, workDir], workDir, { ...process.env, HOME: workDir }, 240_000);
    }
  } else {
    throw new ConverterError('Unsupported conversion tool.', 422);
  }

  outputPath = assertWorkspacePath(workDir, outputPath);
  const stat = await fs.stat(/* turbopackIgnore: true */ outputPath).catch(() => null);
  if (!stat || stat.size < 1) throw new ConverterError('The conversion produced an empty output file.', 422);
  await validateGeneratedOutput(spec, outputPath);

  return {
    outputPath,
    inputBytes: (await fs.stat(/* turbopackIgnore: true */ assertWorkspacePath(workDir, inputPath))).size,
    outputBytes: stat.size,
    outputFilename,
    outputMime,
    conversion: spec.label,
  };
}

export function conversionManifest() {
  return CONVERSIONS.map((spec) => ({
    id: spec.id,
    label: spec.label,
    description: spec.description,
    fromExtensions: spec.fromExtensions,
    outputExtension: spec.outputExtension,
  }));
}

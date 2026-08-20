/**
 * Convert a DOCX buffer to PDF using Microsoft Word (Windows) or LibreOffice.
 * Returns null when neither engine is available so callers can fall back.
 */
import { spawn, spawnSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { randomUUID } from 'crypto';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WORD_TO_PDF_SCRIPT = path.join(__dirname, 'wordToPdf.ps1');

const LIBRE_CANDIDATES = [
  process.env.LIBREOFFICE_PATH,
  process.env.SOFFICE_PATH,
  'C:\\Program Files\\LibreOffice\\program\\soffice.exe',
  'C:\\Program Files (x86)\\LibreOffice\\program\\soffice.exe',
  '/usr/bin/soffice',
  '/usr/bin/libreoffice',
  'soffice',
  'libreoffice',
].filter(Boolean);

export const WINWORD_CANDIDATES = [
  process.env.WINWORD_PATH,
  'C:\\Program Files\\Microsoft Office\\root\\Office16\\WINWORD.EXE',
  'C:\\Program Files\\Microsoft Office\\Office16\\WINWORD.EXE',
  'C:\\Program Files (x86)\\Microsoft Office\\root\\Office16\\WINWORD.EXE',
  'C:\\Program Files (x86)\\Microsoft Office\\Office16\\WINWORD.EXE',
  'C:\\Program Files\\Microsoft Office\\root\\Office15\\WINWORD.EXE',
  'C:\\Program Files (x86)\\Microsoft Office\\Office15\\WINWORD.EXE',
].filter(Boolean);

let cachedLibre = undefined;
let cachedWord = undefined;
let convertChain = Promise.resolve();

function probeBinary(bin) {
  if (!bin) return false;
  if (path.isAbsolute(bin) || /^[A-Za-z]:[\\/]/.test(bin)) {
    return fs.existsSync(bin);
  }
  try {
    const result = spawnSync(bin, ['--version'], {
      windowsHide: true,
      timeout: 8000,
      encoding: 'utf8',
    });
    return result.status === 0 || /LibreOffice|OpenOffice/i.test(String(result.stdout || result.stderr || ''));
  } catch {
    return false;
  }
}

export function resolveLibreOfficeBinary() {
  if (cachedLibre !== undefined) return cachedLibre;
  for (const candidate of LIBRE_CANDIDATES) {
    if (probeBinary(candidate)) {
      cachedLibre = candidate;
      return cachedLibre;
    }
  }
  cachedLibre = null;
  return null;
}

export function microsoftWordAvailable() {
  if (cachedWord !== undefined) return cachedWord;
  if (process.platform !== 'win32') {
    cachedWord = false;
    return false;
  }
  if (String(process.env.WORD_PDF_CONVERT || '').toLowerCase() === 'false') {
    cachedWord = false;
    return false;
  }
  cachedWord = WINWORD_CANDIDATES.some((p) => fs.existsSync(p));
  return cachedWord;
}

/** Force re-resolve (tests / after install). */
export function resetLibreOfficeBinaryCache() {
  cachedLibre = undefined;
  cachedWord = undefined;
}

function runCommand(bin, args, { timeoutMs = 120_000, cwd } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, {
      cwd,
      env: {
        ...process.env,
        HOME: process.env.HOME || os.tmpdir(),
        SAL_DISABLE_OPENCL: '1',
        SAL_NOOPENGL: '1',
      },
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stderr = '';
    let stdout = '';
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error(`PDF convert timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    child.stdout?.on('data', (d) => {
      stdout += String(d);
    });
    child.stderr?.on('data', (d) => {
      stderr += String(d);
    });
    child.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(`PDF convert exited ${code}: ${(stderr || stdout).slice(0, 500)}`));
    });
  });
}

function pathToFileUri(absPath) {
  const normalized = path.resolve(absPath).replace(/\\/g, '/');
  if (/^[A-Za-z]:/.test(normalized)) {
    return `file:///${normalized}`;
  }
  return `file://${normalized.startsWith('/') ? '' : '/'}${normalized}`;
}

async function convertWithMicrosoftWord(docxBuffer, timeoutMs) {
  if (!microsoftWordAvailable() || !fs.existsSync(WORD_TO_PDF_SCRIPT)) return null;
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tylo-word2pdf-'));
  const inFile = path.join(workDir, `input-${randomUUID()}.docx`);
  const outFile = path.join(workDir, `output-${randomUUID()}.pdf`);
  fs.writeFileSync(inFile, docxBuffer);
  try {
    await runCommand(
      'powershell.exe',
      [
        '-NoProfile',
        '-STA',
        '-NonInteractive',
        '-ExecutionPolicy',
        'Bypass',
        '-File',
        WORD_TO_PDF_SCRIPT,
        '-InputPath',
        inFile,
        '-OutputPath',
        outFile,
      ],
      { timeoutMs, cwd: workDir }
    );
    if (!fs.existsSync(outFile)) throw new Error('Microsoft Word produced no PDF');
    const pdf = fs.readFileSync(outFile);
    if (pdf.length < 64) throw new Error('Microsoft Word PDF empty');
    return pdf;
  } finally {
    try {
      fs.rmSync(workDir, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  }
}

async function convertWithLibreOffice(docxBuffer, timeoutMs) {
  const bin = resolveLibreOfficeBinary();
  if (!bin) return null;
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tylo-docx2pdf-'));
  const profileDir = path.join(workDir, 'profile');
  fs.mkdirSync(profileDir, { recursive: true });
  const inName = `input-${randomUUID()}.docx`;
  const inFile = path.join(workDir, inName);
  fs.writeFileSync(inFile, docxBuffer);
  try {
    const profileUri = pathToFileUri(profileDir);
    await runCommand(
      bin,
      [
        `-env:UserInstallation=${profileUri}`,
        '--headless',
        '--nologo',
        '--nofirststartwizard',
        '--norestore',
        '--invisible',
        '--convert-to',
        'pdf:writer_pdf_Export',
        '--outdir',
        workDir,
        inFile,
      ],
      { timeoutMs, cwd: workDir }
    );
    const expected = path.join(workDir, inName.replace(/\.docx$/i, '.pdf'));
    let outFile = expected;
    if (!fs.existsSync(outFile)) {
      const pdfs = fs.readdirSync(workDir).filter((f) => f.toLowerCase().endsWith('.pdf'));
      if (!pdfs.length) throw new Error('LibreOffice produced no PDF');
      outFile = path.join(workDir, pdfs[0]);
    }
    const pdf = fs.readFileSync(outFile);
    if (pdf.length < 64) throw new Error('LibreOffice PDF empty');
    return pdf;
  } finally {
    try {
      fs.rmSync(workDir, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  }
}

/**
 * @param {Buffer} docxBuffer
 * @param {{ timeoutMs?: number }} [opts]
 * @returns {Promise<{ buffer: Buffer, engine: 'msword'|'libreoffice' }|null>}
 */
export async function convertDocxBufferToPdf(docxBuffer, opts = {}) {
  if (!Buffer.isBuffer(docxBuffer) || docxBuffer.length < 64) return null;
  const timeoutMs = Number(opts.timeoutMs) > 0 ? Number(opts.timeoutMs) : 120_000;

  const run = async () => {
    try {
      const wordPdf = await convertWithMicrosoftWord(docxBuffer, timeoutMs);
      if (wordPdf) return { buffer: wordPdf, engine: 'msword' };
    } catch (err) {
      console.warn('[docxToPdf] Microsoft Word convert failed:', err?.message || err);
    }
    const loPdf = await convertWithLibreOffice(docxBuffer, timeoutMs);
    if (loPdf) return { buffer: loPdf, engine: 'libreoffice' };
    return null;
  };

  const next = convertChain.then(run, run);
  convertChain = next.then(
    () => undefined,
    () => undefined
  );
  try {
    return await next;
  } catch (err) {
    if (err?.code === 'ENOENT') {
      cachedLibre = null;
      return null;
    }
    console.warn('[docxToPdf] convert failed:', err?.message || err);
    return null;
  }
}

export function docxPdfEngineLabel() {
  if (microsoftWordAvailable()) return 'msword';
  if (resolveLibreOfficeBinary()) return 'libreoffice';
  return 'pdfkit';
}

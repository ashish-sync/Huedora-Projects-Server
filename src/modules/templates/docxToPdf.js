/**
 * Convert a filled DOCX buffer to PDF using LibreOffice (Word-faithful layout).
 * Returns null when soffice is unavailable so callers can fall back to PDFKit.
 */
import { spawn, spawnSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { randomUUID } from 'crypto';

const CANDIDATES = [
  process.env.LIBREOFFICE_PATH,
  process.env.SOFFICE_PATH,
  'C:\\Program Files\\LibreOffice\\program\\soffice.exe',
  'C:\\Program Files (x86)\\LibreOffice\\program\\soffice.exe',
  '/usr/bin/soffice',
  '/usr/bin/libreoffice',
  'soffice',
  'libreoffice',
].filter(Boolean);

let cachedBinary = undefined;
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
  if (cachedBinary !== undefined) return cachedBinary;
  for (const candidate of CANDIDATES) {
    if (probeBinary(candidate)) {
      cachedBinary = candidate;
      return cachedBinary;
    }
  }
  cachedBinary = null;
  return null;
}

/** Force re-resolve (tests / after install). */
export function resetLibreOfficeBinaryCache() {
  cachedBinary = undefined;
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
      reject(new Error(`LibreOffice convert timed out after ${timeoutMs}ms`));
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
      else reject(new Error(`LibreOffice exited ${code}: ${(stderr || stdout).slice(0, 500)}`));
    });
  });
}

/**
 * @param {Buffer} docxBuffer
 * @param {{ timeoutMs?: number }} [opts]
 * @returns {Promise<Buffer|null>} PDF buffer, or null if LibreOffice is not available
 */
export async function convertDocxBufferToPdf(docxBuffer, opts = {}) {
  const bin = resolveLibreOfficeBinary();
  if (!bin || !Buffer.isBuffer(docxBuffer) || docxBuffer.length < 64) return null;

  const timeoutMs = Number(opts.timeoutMs) > 0 ? Number(opts.timeoutMs) : 120_000;

  const run = async () => {
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
        /* ignore cleanup */
      }
    }
  };

  // Serialize conversions — LibreOffice + free-tier RAM do not tolerate parallel soffice.
  const next = convertChain.then(run, run);
  convertChain = next.then(
    () => undefined,
    () => undefined
  );
  try {
    return await next;
  } catch (err) {
    if (err?.code === 'ENOENT') {
      cachedBinary = null;
      return null;
    }
    console.warn('[docxToPdf] LibreOffice convert failed:', err?.message || err);
    return null;
  }
}

function pathToFileUri(absPath) {
  const normalized = path.resolve(absPath).replace(/\\/g, '/');
  if (/^[A-Za-z]:/.test(normalized)) {
    return `file:///${normalized}`;
  }
  return `file://${normalized.startsWith('/') ? '' : '/'}${normalized}`;
}

export function docxPdfEngineLabel() {
  return resolveLibreOfficeBinary() ? 'libreoffice' : 'pdfkit';
}

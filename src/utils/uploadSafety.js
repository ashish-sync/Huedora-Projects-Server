/**
 * Upload content validation — do not trust client MIME alone.
 */

const SIGNATURES = [
  { mime: 'application/pdf', bytes: [0x25, 0x50, 0x44, 0x46] }, // %PDF
  { mime: 'image/png', bytes: [0x89, 0x50, 0x4e, 0x47] },
  { mime: 'image/jpeg', bytes: [0xff, 0xd8, 0xff] },
  { mime: 'image/gif', bytes: [0x47, 0x49, 0x46, 0x38] },
  { mime: 'application/zip', bytes: [0x50, 0x4b, 0x03, 0x04] }, // docx/xlsx/zip
  { mime: 'application/zip', bytes: [0x50, 0x4b, 0x05, 0x06] },
];

const EXECUTABLE_EXT = new Set([
  '.exe',
  '.bat',
  '.cmd',
  '.com',
  '.msi',
  '.scr',
  '.ps1',
  '.sh',
  '.js',
  '.php',
  '.asp',
  '.aspx',
  '.dll',
  '.vbs',
]);

export function fileExtension(name = '') {
  const base = String(name || '').split(/[/\\]/).pop() || '';
  const i = base.lastIndexOf('.');
  return i >= 0 ? base.slice(i).toLowerCase() : '';
}

export function detectMagicMime(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 4) return null;
  for (const sig of SIGNATURES) {
    if (sig.bytes.every((b, i) => buffer[i] === b)) return sig.mime;
  }
  return null;
}

/**
 * @param {{ originalname?: string, mimetype?: string, buffer?: Buffer, size?: number }} file
 * @param {{ allowedExt?: string[], allowedMime?: string[], maxBytes?: number }} rules
 * @returns {{ ok: true } | { ok: false, message: string }}
 */
export function assertSafeUpload(file, rules = {}) {
  const name = String(file?.originalname || '');
  const ext = fileExtension(name);
  const declaredMime = String(file?.mimetype || '').toLowerCase();
  const size = Number(file?.size || file?.buffer?.length || 0);

  if (EXECUTABLE_EXT.has(ext)) {
    return { ok: false, message: 'Executable uploads are not allowed' };
  }
  if (rules.maxBytes && size > rules.maxBytes) {
    return { ok: false, message: `File exceeds ${rules.maxBytes} bytes` };
  }
  if (rules.allowedExt?.length && !rules.allowedExt.includes(ext)) {
    return { ok: false, message: `File extension ${ext || '(none)'} is not allowed` };
  }
  if (rules.allowedMime?.length && declaredMime && !rules.allowedMime.some((m) => declaredMime.includes(m) || m === declaredMime)) {
    // soft: still require magic when buffer present
  }

  const TEXT_EXT = new Set(['.csv', '.txt', '.json', '.xml', '.md']);
  const buf = file?.buffer;
  if (Buffer.isBuffer(buf) && buf.length >= 4 && !TEXT_EXT.has(ext)) {
    const magic = detectMagicMime(buf);
    if (!magic) {
      // Legacy .doc / unknown binaries without a known signature — reject only when
      // extension claims a typed format we can verify.
      if (['.pdf', '.png', '.jpg', '.jpeg', '.gif', '.docx', '.xlsx', '.pptx', '.zip'].includes(ext)) {
        return { ok: false, message: 'File content signature is not recognized' };
      }
      return { ok: true };
    }
    // DOCX/XLSX are zip containers
    const expectsZip = ['.docx', '.xlsx', '.pptx', '.zip'].includes(ext);
    if (expectsZip && magic !== 'application/zip') {
      return { ok: false, message: 'Office document signature mismatch' };
    }
    if (ext === '.pdf' && magic !== 'application/pdf') {
      return { ok: false, message: 'PDF signature mismatch' };
    }
    if (['.png', '.jpg', '.jpeg', '.gif'].includes(ext)) {
      if (ext === '.png' && magic !== 'image/png') return { ok: false, message: 'PNG signature mismatch' };
      if ((ext === '.jpg' || ext === '.jpeg') && magic !== 'image/jpeg') {
        return { ok: false, message: 'JPEG signature mismatch' };
      }
      if (ext === '.gif' && magic !== 'image/gif') return { ok: false, message: 'GIF signature mismatch' };
    }
  }

  return { ok: true };
}

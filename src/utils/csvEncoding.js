import fs from 'fs';

/** UTF-8 BOM — Excel (Windows) needs this to open Unicode CSV correctly. */
export const UTF8_BOM = '\uFEFF';
export const UTF8_BOM_BUFFER = Buffer.from([0xef, 0xbb, 0xbf]);

export function stripUtf8Bom(text) {
  return String(text ?? '').replace(/^\uFEFF/, '');
}

/** Prefix UTF-8 text with BOM unless already present. */
export function withUtf8Bom(text) {
  const body = String(text ?? '');
  return body.startsWith(UTF8_BOM) ? body : `${UTF8_BOM}${body}`;
}

/** Prefix a UTF-8 buffer with BOM unless already present. */
export function withUtf8BomBuffer(buf) {
  const body = Buffer.isBuffer(buf) ? buf : Buffer.from(String(buf ?? ''), 'utf8');
  if (
    body.length >= 3 &&
    body[0] === 0xef &&
    body[1] === 0xbb &&
    body[2] === 0xbf
  ) {
    return body;
  }
  return Buffer.concat([UTF8_BOM_BUFFER, body]);
}

/**
 * Choose Node stream encoding from leading BOM bytes.
 * Defaults to UTF-8 (with or without BOM). Supports UTF-16 LE (Excel "Unicode Text").
 */
export function detectCsvStreamEncoding(filePath) {
  const probe = Buffer.alloc(4);
  let n = 0;
  const fd = fs.openSync(filePath, 'r');
  try {
    n = fs.readSync(fd, probe, 0, 4, 0);
  } finally {
    fs.closeSync(fd);
  }

  if (n >= 2 && probe[0] === 0xff && probe[1] === 0xfe) {
    return 'utf16le';
  }
  return 'utf8';
}

/** Read an entire CSV file as Unicode text (UTF-8 / UTF-16 LE + BOM strip). */
export function readCsvTextSync(filePath) {
  const encoding = detectCsvStreamEncoding(filePath);
  return stripUtf8Bom(fs.readFileSync(filePath, { encoding }));
}

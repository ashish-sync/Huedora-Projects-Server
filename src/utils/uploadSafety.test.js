import test from 'node:test';
import assert from 'node:assert/strict';
import { assertSafeUpload, detectMagicMime, fileExtension } from './uploadSafety.js';

test('detects PDF and PNG magic bytes', () => {
  assert.equal(detectMagicMime(Buffer.from([0x25, 0x50, 0x44, 0x46, 0x2d])), 'application/pdf');
  assert.equal(detectMagicMime(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d])), 'image/png');
});

test('rejects executables by extension', () => {
  const result = assertSafeUpload({ originalname: 'payload.exe', mimetype: 'application/octet-stream' });
  assert.equal(result.ok, false);
});

test('rejects spoofed PDF extension with non-PDF bytes', () => {
  const result = assertSafeUpload({
    originalname: 'invoice.pdf',
    mimetype: 'application/pdf',
    buffer: Buffer.from([0x00, 0x01, 0x02, 0x03, 0x04]),
  });
  assert.equal(result.ok, false);
});

test('accepts real PDF buffer', () => {
  const result = assertSafeUpload({
    originalname: 'invoice.pdf',
    mimetype: 'application/pdf',
    buffer: Buffer.from('%PDF-1.4'),
    size: 8,
  }, { allowedExt: ['.pdf'], maxBytes: 1000 });
  assert.equal(result.ok, true);
});

test('fileExtension normalizes', () => {
  assert.equal(fileExtension('a/B.PNG'), '.png');
});

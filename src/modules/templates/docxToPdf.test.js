import test from 'node:test';
import assert from 'node:assert/strict';
import {
  convertDocxBufferToPdf,
  docxPdfEngineLabel,
  microsoftWordAvailable,
  WINWORD_CANDIDATES,
} from './docxToPdf.js';

test('docxPdfEngineLabel is one of the known engines', () => {
  assert.ok(['msword', 'libreoffice', 'pdfkit'].includes(docxPdfEngineLabel()));
});

test('tiny buffers are not converted', async () => {
  assert.equal(await convertDocxBufferToPdf(Buffer.from('x')), null);
});

test('WINWORD candidates are absolute Windows paths', () => {
  assert.ok(WINWORD_CANDIDATES.length > 0);
  for (const p of WINWORD_CANDIDATES) {
    assert.match(p, /WINWORD\.EXE$/i);
  }
  assert.equal(typeof microsoftWordAvailable(), 'boolean');
});

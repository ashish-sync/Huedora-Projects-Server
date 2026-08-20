import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import JSZip from 'jszip';
import { convertDocxBufferToPdf, microsoftWordAvailable } from './docxToPdf.js';
import { readDocxBuffer } from './docxPlaceholders.js';
import { repackDocxDocumentXml } from './repackDocx.js';
import { pdfLayoutMetrics, assertPdfLayoutMatch } from './pdfLayoutMetrics.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const SERVICE_AGREEMENT_CANDIDATES = [
  process.env.TEST_SERVICE_AGREEMENT_DOCX,
  path.resolve(__dirname, '../../../uploads/templates/49d6c427-dbb4-494f-aac4-a928a7059ce5-Service_Agreement.docx'),
  path.resolve(__dirname, '../../../../client/public/samples/Service_Agreement.docx'),
].filter(Boolean);

function resolveServiceAgreementDocx() {
  for (const candidate of SERVICE_AGREEMENT_CANDIDATES) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

test('repackDocxDocumentXml preserves OOXML payload size (no global DEFLATE shrink)', async () => {
  const file = resolveServiceAgreementDocx();
  if (!file) return;
  const buffer = fs.readFileSync(file);
  const { xml } = await readDocxBuffer(buffer);
  const repacked = await repackDocxDocumentXml(buffer, xml);
  assert.ok(
    repacked.length >= buffer.length * 0.9,
    `repack shrank ${buffer.length} → ${repacked.length} bytes`
  );

  const zip = await JSZip.loadAsync(buffer);
  zip.file('word/document.xml', xml);
  const bad = await zip.generateAsync({
    type: 'nodebuffer',
    compression: 'DEFLATE',
    compressionOptions: { level: 6 },
  });
  assert.ok(
    bad.length < buffer.length * 0.5,
    'sanity: forced DEFLATE should shrink large templates in this fixture'
  );
});

test('Service Agreement PDF layout matches native Word Save as PDF', async (t) => {
  if (!microsoftWordAvailable()) {
    t.skip('Microsoft Word is not installed on this machine');
    return;
  }
  const file = resolveServiceAgreementDocx();
  if (!file) {
    t.skip('Service Agreement.docx fixture not found');
    return;
  }

  const original = fs.readFileSync(file);
  const reference = await convertDocxBufferToPdf(original, { timeoutMs: 180_000 });
  assert.ok(reference?.buffer?.length > 64, 'reference Word PDF missing');
  assert.equal(reference.engine, 'msword');

  // Document One print-preview path: original bytes → Word COM (no merge, no JSZip).
  const pipeline = await convertDocxBufferToPdf(original, { timeoutMs: 180_000 });
  assert.ok(pipeline?.buffer?.length > 64);
  assert.equal(pipeline.engine, 'msword');

  const refMetrics = await pdfLayoutMetrics(reference.buffer);
  const pipeMetrics = await pdfLayoutMetrics(pipeline.buffer);
  assertPdfLayoutMatch(refMetrics, pipeMetrics);

  // Document One fill path: repack document.xml only, then Word COM.
  const { xml } = await readDocxBuffer(original);
  const repacked = await repackDocxDocumentXml(original, xml);
  assert.ok(repacked.length >= original.length * 0.9);
  const repackedPdf = await convertDocxBufferToPdf(repacked, { timeoutMs: 180_000 });
  assert.ok(repackedPdf?.buffer?.length > 64);
  const repackMetrics = await pdfLayoutMetrics(repackedPdf.buffer);
  assertPdfLayoutMatch(refMetrics, repackMetrics);
});

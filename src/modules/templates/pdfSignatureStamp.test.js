import test from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { PDFDocument } from 'pdf-lib';
import { stampSignatureFooterOnPdf } from './pdfSignatureStamp.js';

async function tinyWebpDataUrl() {
  const webp = await sharp({
    create: { width: 80, height: 32, channels: 4, background: { r: 10, g: 20, b: 40, alpha: 1 } },
  })
    .webp()
    .toBuffer();
  return `data:image/webp;base64,${webp.toString('base64')}`;
}

test('stampSignatureFooterOnPdf embeds WebP uploaded signatures as images (not data-URL text)', async () => {
  const blank = await PDFDocument.create();
  blank.addPage([595, 842]);
  const pdfBytes = Buffer.from(await blank.save());

  const dataUrl = await tinyWebpDataUrl();
  const stamped = await stampSignatureFooterOnPdf(pdfBytes, {
    signingType: 'SIGNING',
    senderSignature: {
      status: 'SIGNED',
      name: 'Ashish Sender',
      signatureType: 'UPLOADED',
      signatureData: dataUrl,
      signedAt: new Date().toISOString(),
    },
  });

  assert.ok(Buffer.isBuffer(stamped));
  assert.ok(stamped.length > pdfBytes.length / 2);

  // Re-load and ensure we did not fall back to printing the data URL prefix.
  const reloaded = await PDFDocument.load(stamped);
  const page = reloaded.getPages()[0];
  // pdf-lib does not expose drawn text easily; assert the WebP payload prefix is absent
  // from the raw PDF bytes (it would appear if text-fallback wrote the data URL).
  const asLatin = stamped.toString('latin1');
  assert.equal(asLatin.includes('data:image/webp;base64,'), false);
  assert.ok(page);
});

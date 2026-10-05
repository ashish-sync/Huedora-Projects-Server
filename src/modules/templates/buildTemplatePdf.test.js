import test from 'node:test';
import assert from 'node:assert/strict';
import { buildTemplatePdf } from './buildTemplatePdf.js';
import { PdfEngineUnavailableError } from './pdfEngineErrors.js';

test('falls back to PDFKit when Word/LibreOffice cannot convert DOCX', async () => {
  const prev = process.env.DOCX_PDF_REQUIRE_ENGINE;
  process.env.DOCX_PDF_REQUIRE_ENGINE = 'false';
  try {
    const fakeDocx = Buffer.alloc(128, 1);
    const { buffer, engine } = await buildTemplatePdf({
      title: 'Test Agreement',
      filledDocxBuffer: fakeDocx,
      filledText: 'Hello World placeholder fill',
      allowPdfKitFallback: true,
    });
    assert.equal(engine, 'pdfkit');
    assert.ok(Buffer.isBuffer(buffer) && buffer.length > 64);
    assert.equal(buffer.subarray(0, 4).toString('ascii'), '%PDF');
  } finally {
    if (prev === undefined) delete process.env.DOCX_PDF_REQUIRE_ENGINE;
    else process.env.DOCX_PDF_REQUIRE_ENGINE = prev;
  }
});

test('hard-fails when DOCX_PDF_REQUIRE_ENGINE=true and converter missing', async () => {
  const prev = process.env.DOCX_PDF_REQUIRE_ENGINE;
  process.env.DOCX_PDF_REQUIRE_ENGINE = 'true';
  try {
    await assert.rejects(
      () => buildTemplatePdf({
        title: 'Test',
        filledDocxBuffer: Buffer.alloc(128, 1),
        filledText: 'Hello',
        allowPdfKitFallback: true,
      }),
      (err) => err instanceof PdfEngineUnavailableError,
    );
  } finally {
    if (prev === undefined) delete process.env.DOCX_PDF_REQUIRE_ENGINE;
    else process.env.DOCX_PDF_REQUIRE_ENGINE = prev;
  }
});

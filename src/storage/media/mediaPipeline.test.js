import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import fs from 'fs';
import os from 'os';
import path from 'path';
import sharp from 'sharp';
import { classifyUploadKind } from './mediaKinds.js';
import { optimizeImageToWebp, IMAGE_MAX_LONG_EDGE, WEBP_QUALITY } from './optimizeImage.js';
import { optimizePdfBuffer } from './optimizePdf.js';
import { PDFDocument } from 'pdf-lib';
import { sha256Buffer } from './contentHash.js';

describe('media kinds', () => {
  it('never classifies PDF as image', () => {
    assert.equal(classifyUploadKind({ originalName: 'scan.pdf', mimetype: 'application/pdf' }), 'pdf');
    assert.equal(classifyUploadKind({ originalName: 'scan.pdf', mimetype: 'image/jpeg' }), 'pdf');
    assert.equal(classifyUploadKind({ originalName: 'photo.jpg', mimetype: 'image/jpeg' }), 'image');
    assert.equal(classifyUploadKind({ originalName: 'notes.docx', mimetype: 'application/msword' }), 'other');
  });
});

describe('image optimize', () => {
  it('converts oversized jpeg to smaller webp under max long edge', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tylo-media-'));
    const src = path.join(dir, 'big.jpg');
    await sharp({
      create: {
        width: 3200,
        height: 2000,
        channels: 3,
        background: { r: 180, g: 160, b: 140 },
      },
    })
      .jpeg({ quality: 95 })
      .toFile(src);

    const before = fs.statSync(src).size;
    const result = await optimizeImageToWebp(src);
    assert.equal(result.contentType, 'image/webp');
    assert.equal(result.ext, '.webp');
    assert.ok(result.width <= IMAGE_MAX_LONG_EDGE);
    assert.ok(result.height <= IMAGE_MAX_LONG_EDGE);
    assert.equal(WEBP_QUALITY, 90);
    assert.ok(result.buffer.length > 0);
    assert.ok(
      result.buffer.length < before,
      `expected webp ${result.buffer.length} < jpeg ${before}`,
    );
    // Target ≥50% reduction on synthetic flat image (handwriting photos may vary)
    assert.ok(
      result.buffer.length / before <= 0.5,
      `expected ≥50% reduction, got ratio=${(result.buffer.length / before).toFixed(2)}`,
    );
    fs.rmSync(dir, { recursive: true, force: true });
  });
});

describe('pdf optimize', () => {
  it('keeps pdf bytes and never invents webp', async () => {
    const doc = await PDFDocument.create();
    doc.addPage();
    const input = Buffer.from(await doc.save());
    const result = await optimizePdfBuffer(input);
    assert.ok(Buffer.isBuffer(result.buffer));
    assert.equal(result.pageCount, 1);
    // Must still be a PDF header
    assert.ok(result.buffer.subarray(0, 4).toString('utf8').startsWith('%PDF'));
  });
});

describe('content hash', () => {
  it('hashes buffers stably', () => {
    const a = sha256Buffer(Buffer.from('hello'));
    const b = sha256Buffer(Buffer.from('hello'));
    const c = sha256Buffer(Buffer.from('world'));
    assert.equal(a, b);
    assert.notEqual(a, c);
    assert.equal(a.length, 64);
  });
});

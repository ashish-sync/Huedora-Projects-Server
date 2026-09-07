import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import fs from 'fs';
import os from 'os';
import path from 'path';
import sharp from 'sharp';
import { classifyUploadKind } from './mediaKinds.js';
import {
  optimizeImageToWebp,
  IMAGE_MAX_LONG_EDGE,
  STANDARD_IMAGE_PALETTE_COLORS,
  STANDARD_IMAGE_PALETTE_COLORS_MIN,
} from './optimizeImage.js';
import { materializeOptimizeResult } from './optimizeGpsSelfie.js';
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

describe('standard image optimize (GPS Selfie rule)', () => {
  it('converts color jpeg to indexed full-color lossless WebP under max long edge', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tylo-media-'));
    const src = path.join(dir, 'big.jpg');
    const width = 1600;
    const height = 1200;
    const raw = Buffer.alloc(width * height * 3);
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const i = (y * width + x) * 3;
        if (x < width / 3) {
          raw[i] = 220;
          raw[i + 1] = 60;
          raw[i + 2] = 60;
        } else if (x < (2 * width) / 3) {
          raw[i] = 50;
          raw[i + 1] = 180;
          raw[i + 2] = 70;
        } else {
          raw[i] = 40;
          raw[i + 1] = 90;
          raw[i + 2] = 210;
        }
      }
    }
    await sharp(raw, { raw: { width, height, channels: 3 } })
      .jpeg({ quality: 92 })
      .toFile(src);

    const before = fs.statSync(src).size;
    const result = await materializeOptimizeResult(await optimizeImageToWebp(src));
    assert.equal(result.contentType, 'image/webp');
    assert.equal(result.ext, '.webp');
    assert.equal(result.indexed, true);
    assert.equal(result.encodeMode, 'indexed-webp');
    assert.ok(
      result.paletteColors >= STANDARD_IMAGE_PALETTE_COLORS_MIN
        && result.paletteColors <= STANDARD_IMAGE_PALETTE_COLORS,
    );
    assert.ok(Math.max(result.width, result.height) <= IMAGE_MAX_LONG_EDGE);
    assert.ok(result.buffer.length > 0);
    assert.ok(result.buffer.length < before);

    const meta = await sharp(result.buffer).metadata();
    assert.equal(meta.format, 'webp');
    assert.ok(
      meta.channels >= 3 || meta.space === 'srgb',
      `expected color WebP, got channels=${meta.channels} space=${meta.space}`,
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

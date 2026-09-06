import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import fs from 'fs';
import os from 'os';
import path from 'path';
import sharp from 'sharp';
import {
  EXEC_DOC_LONG_EDGE,
  EXEC_DOC_WEBP_QUALITY,
  EXEC_DOC_WEBP_EFFORT,
  prepareScanPageL,
  optimizeExecutionDocImage,
  optimizeExecutionDocumentFile,
  footprintBandLabel,
} from './optimizeExecutionDoc.js';

describe('execution-doc image optimize', () => {
  it('outputs 8-bit L grayscale lossy WebP Q45 (not color PNG)', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tylo-exec-doc-'));
    const src = path.join(dir, 'scan-with-exif.jpg');

    const width = 2400;
    const height = 1800;
    const raw = Buffer.alloc(width * height * 3);
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const i = (y * width + x) * 3;
        const inStamp = x > 1800 && x < 2200 && y > 200 && y < 500;
        if (inStamp) {
          raw[i] = 40;
          raw[i + 1] = 90;
          raw[i + 2] = 210;
        } else {
          raw[i] = 235;
          raw[i + 1] = 232;
          raw[i + 2] = 228;
        }
      }
    }

    await sharp(raw, { raw: { width, height, channels: 3 } })
      .withMetadata({
        exif: {
          IFD0: { Copyright: 'test-device' },
        },
      })
      .jpeg({ quality: 92 })
      .toFile(src);

    const before = fs.statSync(src).size;
    const pageL = await prepareScanPageL(src);
    assert.equal(pageL.channels, 1, 'prepared page must be 8-bit single-channel L');
    assert.equal(pageL.data.length, pageL.width * pageL.height, 'L buffer is 1 byte per pixel');

    const result = await optimizeExecutionDocImage(src);

    assert.equal(result.contentType, 'image/webp');
    assert.equal(result.ext, '.webp');
    assert.equal(result.channels, 1);
    assert.equal(EXEC_DOC_WEBP_QUALITY, 45);
    assert.equal(EXEC_DOC_WEBP_EFFORT, 6);
    assert.equal(result.encodeQuality, 45);
    assert.ok(Math.max(result.width, result.height) <= EXEC_DOC_LONG_EDGE);
    assert.ok(result.buffer.length > 0);
    assert.ok(
      result.buffer.length < before,
      `expected smaller encode ${result.buffer.length} < ${before}`,
    );
    // Must not be PNG
    assert.notEqual(result.buffer.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');

    // Encode path reports 1 channel (sharp may expand greyscale WebP to sRGB on decode)
    const { info: encInfo } = await sharp(pageL.data, {
      raw: { width: pageL.width, height: pageL.height, channels: 1 },
    })
      .toColourspace('b-w')
      .webp({ quality: 45, effort: 6, lossless: false })
      .toBuffer({ resolveWithObject: true });
    assert.equal(encInfo.channels, 1);
    assert.equal(encInfo.format, 'webp');

    const meta = await sharp(result.buffer).metadata();
    assert.ok(!meta.exif, 'EXIF must be stripped');
    assert.ok(!meta.icc, 'ICC profile must be stripped');
    assert.equal(meta.format, 'webp');

    // Blue stamp darker than paper after red-weighted L convert
    const decoded = await sharp(result.buffer).greyscale().raw().toBuffer({ resolveWithObject: true });
    const { data, info } = decoded;
    const ch = info.channels;
    const paperIdx = (Math.floor(info.height * 0.5) * info.width + Math.floor(info.width * 0.1)) * ch;
    const stampIdx =
      (Math.min(info.height - 1, Math.floor(info.height * 0.2)) * info.width +
        Math.min(info.width - 1, Math.floor(info.width * 0.85))) *
      ch;
    const samplePaper = data[paperIdx];
    const sampleStamp = data[stampIdx];
    assert.ok(
      sampleStamp < samplePaper - 20,
      `blue stamp should be darker than paper (stamp=${sampleStamp}, paper=${samplePaper})`,
    );

    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('footprintBandLabel prefers 250–300 KB', () => {
    assert.equal(footprintBandLabel(200 * 1024), 'in-band');
    assert.equal(footprintBandLabel(270 * 1024), 'preferred');
    assert.equal(footprintBandLabel(100 * 1024), 'below-band');
    assert.equal(footprintBandLabel(400 * 1024), 'above-band');
  });

  it('optimizeExecutionDocumentFile routes images through exec pipeline', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tylo-exec-doc-'));
    const src = path.join(dir, 'df.jpg');
    await sharp({
      create: {
        width: 2000,
        height: 1400,
        channels: 3,
        background: { r: 250, g: 248, b: 245 },
      },
    })
      .jpeg({ quality: 90 })
      .toFile(src);

    const result = await optimizeExecutionDocumentFile(src, {
      originalName: 'df.jpg',
      mimetype: 'image/jpeg',
    });
    assert.ok(result);
    assert.equal(result.kind, 'image');
    assert.equal(result.ext, '.webp');
    assert.equal(result.contentType, 'image/webp');
    assert.ok(result.reductionRatio != null && result.reductionRatio < 1);

    fs.rmSync(dir, { recursive: true, force: true });
  });
});

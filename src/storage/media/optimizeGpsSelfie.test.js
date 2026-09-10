import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import fs from 'fs';
import os from 'os';
import path from 'path';
import sharp from 'sharp';
import {
  GPS_SELFIE_LONG_EDGE,
  GPS_SELFIE_PALETTE_COLORS,
  GPS_SELFIE_PALETTE_COLORS_MIN,
  optimizeGpsSelfieToIndexedWebp,
  optimizeGpsSelfieFile,
  materializeOptimizeResult,
} from './optimizeGpsSelfie.js';

describe('GPS selfie indexed WebP', () => {
  it('encodes color selfie as WebP using 8–16 colour palette (not grayscale L)', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tylo-gps-selfie-'));
    const src = path.join(dir, 'selfie.jpg');

    // Distinct color regions so palette quantization has real work
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
    const rawResult = await optimizeGpsSelfieToIndexedWebp(src);
    const result = await materializeOptimizeResult(rawResult);

    assert.equal(result.contentType, 'image/webp');
    assert.equal(result.ext, '.webp');
    assert.equal(result.indexed, true);
    assert.equal(result.encodeMode, 'indexed-webp');
    assert.ok(
      result.paletteColors >= GPS_SELFIE_PALETTE_COLORS_MIN
        && result.paletteColors <= GPS_SELFIE_PALETTE_COLORS,
    );
    assert.ok(Math.max(result.width, result.height) <= GPS_SELFIE_LONG_EDGE);
    assert.ok(result.buffer.length > 0);
    assert.ok(result.buffer.length < before);

    const meta = await sharp(result.buffer).metadata();
    assert.equal(meta.format, 'webp');
    assert.ok(!meta.exif);
    // Must remain color (not single-channel L grayscale)
    assert.ok(
      meta.channels >= 3 || meta.space === 'srgb',
      `expected color WebP, got channels=${meta.channels} space=${meta.space}`,
    );

    // Spot-check that distinct hues survive palette (not collapsed to gray)
    const { data, info } = await sharp(result.buffer)
      .raw()
      .toBuffer({ resolveWithObject: true });
    const sample = (px, py) => {
      const idx = (py * info.width + px) * info.channels;
      return [data[idx], data[idx + 1], data[idx + 2]];
    };
    const left = sample(Math.floor(info.width * 0.15), Math.floor(info.height * 0.5));
    const mid = sample(Math.floor(info.width * 0.5), Math.floor(info.height * 0.5));
    const right = sample(Math.floor(info.width * 0.85), Math.floor(info.height * 0.5));
    assert.ok(left[0] > left[2], `left should stay reddish, got ${left}`);
    assert.ok(mid[1] > mid[0], `mid should stay greenish, got ${mid}`);
    assert.ok(right[2] > right[0], `right should stay bluish, got ${right}`);

    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('passes through already-suitable WebP without re-encoding', async () => {
    const { data: webpBuf } = await sharp({
      create: {
        width: 640,
        height: 480,
        channels: 3,
        background: { r: 40, g: 120, b: 200 },
      },
    })
      .png({ palette: true, colours: 16 })
      .webp({ lossless: true, effort: 2 })
      .toBuffer({ resolveWithObject: true });

    const result = await optimizeGpsSelfieToIndexedWebp(webpBuf);
    assert.equal(result.encodeMode, 'webp-passthrough');
    assert.equal(result.contentType, 'image/webp');
    const materialized = await materializeOptimizeResult(result);
    assert.ok(Buffer.compare(materialized.buffer, webpBuf) === 0);
  });

  it('passes through large-under-cap WebP without palette decode (OOM guard)', async () => {
    // Noisy source so lossless WebP stays large (> former 900KB passthrough cap).
    const crypto = await import('node:crypto');
    const webpBuf = await sharp(crypto.randomBytes(1100 * 800 * 3), {
      raw: { width: 1100, height: 800, channels: 3 },
    })
      .webp({ lossless: true, effort: 1 })
      .toBuffer();
    assert.ok(webpBuf.length > 900 * 1024, `expected fat webp, got ${webpBuf.length}`);

    const result = await optimizeGpsSelfieToIndexedWebp(webpBuf);
    assert.equal(result.encodeMode, 'webp-passthrough');
    const materialized = await materializeOptimizeResult(result);
    assert.equal(materialized.buffer.length, webpBuf.length);
  });

  it('resize-only for oversized WebP — never palette path', async () => {
    const webpBuf = await sharp({
      create: {
        width: 2000,
        height: 1500,
        channels: 3,
        background: { r: 10, g: 20, b: 30 },
      },
    })
      .webp({ lossless: true, effort: 1 })
      .toBuffer();

    const result = await optimizeGpsSelfieToIndexedWebp(webpBuf);
    assert.equal(result.encodeMode, 'webp-resize');
    assert.ok(Math.max(result.width, result.height) <= GPS_SELFIE_LONG_EDGE);
  });

  it('optimizeGpsSelfieFile returns kind image with reductionRatio', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tylo-gps-selfie-'));
    const src = path.join(dir, 'gs.jpg');
    await sharp({
      create: {
        width: 900,
        height: 1200,
        channels: 3,
        background: { r: 120, g: 90, b: 70 },
      },
    })
      .jpeg({ quality: 90 })
      .toFile(src);

    const result = await optimizeGpsSelfieFile(src);
    assert.equal(result.kind, 'image');
    assert.equal(result.ext, '.webp');
    assert.ok(result.reductionRatio != null && result.reductionRatio < 1);

    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('lightOnly WebP is byte-copy only (no Sharp resize — Render OOM guard)', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tylo-gps-light-'));
    const src = path.join(dir, 'gs.webp');
    await sharp({
      create: {
        width: 640,
        height: 480,
        channels: 3,
        background: { r: 10, g: 20, b: 30 },
      },
    })
      .webp({ lossless: true, effort: 1 })
      .toFile(src);
    const before = fs.statSync(src).size;

    const result = await optimizeGpsSelfieFile(src, { lightOnly: true });
    assert.equal(result.encodeMode, 'webp-passthrough-light');
    assert.equal(fs.statSync(result.filePath).size, before);

    await assert.rejects(
      () => optimizeGpsSelfieFile(path.join(dir, 'missing.jpg'), { lightOnly: true }),
      (err) => err.code === 'UPLOAD_MEMORY_PRESSURE' || err.code === 'ENOENT',
    );

    const jpeg = path.join(dir, 'gs.jpg');
    await sharp({
      create: { width: 100, height: 100, channels: 3, background: { r: 1, g: 2, b: 3 } },
    })
      .jpeg()
      .toFile(jpeg);
    await assert.rejects(
      () => optimizeGpsSelfieFile(jpeg, { lightOnly: true }),
      (err) => err.code === 'UPLOAD_MEMORY_PRESSURE' && err.status === 503,
    );

    fs.rmSync(dir, { recursive: true, force: true });
  });
});

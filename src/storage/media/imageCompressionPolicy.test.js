import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import fs from 'fs';
import os from 'os';
import path from 'path';
import sharp from 'sharp';
import {
  compressImagePolicy,
  IMAGE_MAX_LONG_EDGE,
  COMPRESSION_THRESHOLD_BYTES,
  TARGET_MAX_BYTES,
  INITIAL_QUALITY,
  MIN_QUALITY_FLOOR,
} from './optimizeImage.js';
import { processUploadedMedia } from './processUpload.js';
import { StoredFile } from '../../modules/files/storedFile.model.js';
import { uploadsRoot } from '../../config/paths.js';

describe('System-wide Image Compression Policy', () => {
  it('compresses images > 1 MB to WebP quality 90 targeting <= 500 KB', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tylo-comp-test-'));
    const testFile = path.join(dir, 'large-sample.jpg');

    // Create an uncompressed JPEG > 1 MB (e.g. 2400x1800 with varied pixel values)
    const width = 2400;
    const height = 1800;
    const raw = Buffer.alloc(width * height * 3);
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const i = (y * width + x) * 3;
        raw[i] = (x + y) % 256;
        raw[i + 1] = (x * 2 + y) % 256;
        raw[i + 2] = (y * 3 + x) % 256;
      }
    }
    await sharp(raw, { raw: { width, height, channels: 3 } })
      .jpeg({ quality: 98 })
      .toFile(testFile);

    const initialSize = fs.statSync(testFile).size;
    assert.ok(initialSize > COMPRESSION_THRESHOLD_BYTES, `Expected file > 1MB, got ${initialSize}`);

    const result = await compressImagePolicy(testFile);

    assert.equal(result.contentType, 'image/webp');
    assert.equal(result.ext, '.webp');
    assert.equal(result.skipped, false);
    assert.ok(result.quality >= MIN_QUALITY_FLOOR && result.quality <= INITIAL_QUALITY);
    assert.ok(result.sizeBytes <= TARGET_MAX_BYTES, `Expected <= 500 KB, got ${result.sizeBytes}`);
    assert.ok(result.sizeBytes < initialSize, 'Expected compressed size to be smaller than original');

    const meta = await sharp(result.buffer).metadata();
    assert.equal(meta.format, 'webp');
    assert.ok(Math.max(meta.width, meta.height) <= IMAGE_MAX_LONG_EDGE);

    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('preserves aspect ratio and caps long edge to maximum 2,500 px without enlargement', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tylo-comp-test-'));
    const testFile = path.join(dir, 'oversized-dimension.png');

    // 4000x2000 image (aspect ratio 2:1)
    const width = 4000;
    const height = 2000;
    await sharp({
      create: {
        width,
        height,
        channels: 3,
        background: { r: 50, g: 100, b: 150 },
      },
    })
      .png()
      .toFile(testFile);

    const result = await compressImagePolicy(testFile);

    assert.equal(result.contentType, 'image/webp');
    // Long edge must be capped at exactly 2500 px
    assert.equal(result.width, 2500);
    // Aspect ratio 2:1 must be preserved: 2500 / 2 = 1250 px
    assert.equal(result.height, 1250);

    const meta = await sharp(result.buffer).metadata();
    assert.equal(meta.width, 2500);
    assert.equal(meta.height, 1250);

    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('preserves image orientation via EXIF auto-rotation', async () => {
    // Generate an image with EXIF orientation tag 6 (rotated 90 CW)
    const { data: rotatedWebp } = await sharp({
      create: {
        width: 800,
        height: 600,
        channels: 3,
        background: { r: 255, g: 128, b: 0 },
      },
    })
      .jpeg({ quality: 90 })
      .withMetadata({ orientation: 6 })
      .toBuffer({ resolveWithObject: true });

    const result = await compressImagePolicy(rotatedWebp, { forceCompress: true });
    // After .rotate(), orientation 6 swaps width & height to upright
    assert.equal(result.width, 600);
    assert.equal(result.height, 800);
  });

  it('extracts and preserves GPS metadata before EXIF is stripped', async () => {
    // Build a TIFF EXIF buffer containing GPS tags
    const exifHeader = Buffer.from('Exif\0\0', 'ascii');
    // Little-endian TIFF header: 'II', version 42, IFD0 offset 8
    const tiffHeader = Buffer.from([0x49, 0x49, 0x2A, 0x00, 0x08, 0x00, 0x00, 0x00]);
    // IFD0: 1 tag (GPS IFD Pointer 0x8825), offset 26
    const ifd0 = Buffer.alloc(18);
    ifd0.writeUInt16LE(1, 0); // 1 tag
    ifd0.writeUInt16LE(0x8825, 2); // GPSInfo tag
    ifd0.writeUInt16LE(4, 4); // LONG
    ifd0.writeUInt32LE(1, 6); // count 1
    ifd0.writeUInt32LE(26, 10); // offset to GPS IFD (from TIFF start)
    ifd0.writeUInt32LE(0, 14); // next IFD = 0

    // GPS IFD: 4 tags (GPSLatitudeRef 'N', GPSLatitude 19°4'30" = 19.075, GPSLongitudeRef 'E', GPSLongitude 72°52'30" = 72.875)
    const gpsIfd = Buffer.alloc(50);
    gpsIfd.writeUInt16LE(4, 0); // 4 tags
    // Tag 1: GPSLatitudeRef (0x0001) = 'N'
    gpsIfd.writeUInt16LE(0x0001, 2);
    gpsIfd.writeUInt16LE(2, 4); // ASCII
    gpsIfd.writeUInt32LE(2, 6); // 2 bytes ('N\0')
    gpsIfd.write('N\0', 10, 2, 'ascii');

    // Tag 2: GPSLatitude (0x0002) = 3 RATIONALs (degrees, minutes, seconds)
    gpsIfd.writeUInt16LE(0x0002, 14);
    gpsIfd.writeUInt16LE(5, 16); // RATIONAL
    gpsIfd.writeUInt32LE(3, 18); // 3 items
    gpsIfd.writeUInt32LE(76, 22); // offset from TIFF start = 8 + 18 + 50 = 76

    // Tag 3: GPSLongitudeRef (0x0003) = 'E'
    gpsIfd.writeUInt16LE(0x0003, 26);
    gpsIfd.writeUInt16LE(2, 28); // ASCII
    gpsIfd.writeUInt32LE(2, 30);
    gpsIfd.write('E\0', 34, 2, 'ascii');

    // Tag 4: GPSLongitude (0x0004) = 3 RATIONALs
    gpsIfd.writeUInt16LE(0x0004, 38);
    gpsIfd.writeUInt16LE(5, 40); // RATIONAL
    gpsIfd.writeUInt32LE(3, 42); // 3 items
    gpsIfd.writeUInt32LE(100, 46); // offset from TIFF start = 100

    // Data at offset 76: Latitude rationals: 19/1, 4/1, 30/1 (19.075)
    const latData = Buffer.alloc(24);
    latData.writeUInt32LE(19, 0);
    latData.writeUInt32LE(1, 4);
    latData.writeUInt32LE(4, 8);
    latData.writeUInt32LE(1, 12);
    latData.writeUInt32LE(30, 16);
    latData.writeUInt32LE(1, 20);

    // Data at offset 100: Longitude rationals: 72/1, 52/1, 30/1 (72.875)
    const lngData = Buffer.alloc(24);
    lngData.writeUInt32LE(72, 0);
    lngData.writeUInt32LE(1, 4);
    lngData.writeUInt32LE(52, 8);
    lngData.writeUInt32LE(1, 12);
    lngData.writeUInt32LE(30, 16);
    lngData.writeUInt32LE(1, 20);

    const fullExif = Buffer.concat([
      exifHeader,
      tiffHeader,
      ifd0,
      gpsIfd,
      latData,
      lngData,
    ]);

    // Create valid JPEG with embedded APP1 EXIF segment
    const baseJpeg = await sharp({
      create: {
        width: 1000,
        height: 800,
        channels: 3,
        background: { r: 120, g: 150, b: 180 },
      },
    })
      .jpeg({ quality: 90 })
      .toBuffer();

    const app1Len = fullExif.length + 2;
    const app1Segment = Buffer.concat([
      Buffer.from([0xFF, 0xE1, (app1Len >> 8) & 0xFF, app1Len & 0xFF]),
      fullExif,
    ]);
    const jpegWithExif = Buffer.concat([
      baseJpeg.subarray(0, 2),
      app1Segment,
      baseJpeg.subarray(2),
    ]);

    const result = await compressImagePolicy(jpegWithExif, { forceCompress: true });

    // GPS coordinates must be extracted and returned in policy result
    assert.ok(result.gps, 'GPS metadata must be extracted');
    assert.ok(Math.abs(result.gps.latitude - 19.075) < 0.001, `Expected lat ~19.075, got ${result.gps.latitude}`);
    assert.ok(Math.abs(result.gps.longitude - 72.875) < 0.001, `Expected lng ~72.875, got ${result.gps.longitude}`);

    // Output WebP must strip EXIF for privacy and size optimization
    const outputMeta = await sharp(result.buffer).metadata();
    assert.ok(!outputMeta.exif, 'Output WebP should have EXIF stripped');
  });

  it('passes through compliant WebP <= 1 MB without recompression', async () => {
    const compliantWebp = await sharp({
      create: {
        width: 1200,
        height: 800,
        channels: 3,
        background: { r: 10, g: 200, b: 100 },
      },
    })
      .webp({ quality: 90 })
      .toBuffer();

    assert.ok(compliantWebp.length <= COMPRESSION_THRESHOLD_BYTES);

    const result = await compressImagePolicy(compliantWebp);
    assert.equal(result.skipped, true);
    assert.equal(result.reason, 'already-compliant-webp');
    assert.equal(result.contentType, 'image/webp');
    assert.equal(result.sizeBytes, compliantWebp.length);
  });

  it('never compresses non-image documents or PDFs', async () => {
    const textBuffer = Buffer.from('Tylo One non-image document payload');
    const result = await compressImagePolicy(textBuffer, { originalName: 'sample.txt' });
    assert.equal(result.skipped, true);
    assert.equal(result.reason, 'unreadable-or-non-image');
  });

  it('preserves clarity at quality floor 70 and logs an exception when image cannot reach <= 500 KB', async () => {
    // Generate an image with high-entropy white noise that resists WebP compression
    const crypto = await import('node:crypto');
    const width = 2000;
    const height = 2000;
    const noise = crypto.randomBytes(width * height * 3);
    const noiseJpeg = await sharp(noise, { raw: { width, height, channels: 3 } })
      .jpeg({ quality: 100 })
      .toBuffer();

    let loggedWarning = null;
    const origWarn = console.warn;
    console.warn = (msg) => {
      loggedWarning = msg;
      origWarn(msg);
    };

    try {
      const result = await compressImagePolicy(noiseJpeg, { originalName: 'high-entropy-photo.jpg' });
      assert.equal(result.contentType, 'image/webp');
      assert.equal(result.quality, MIN_QUALITY_FLOOR, 'Must not drop below quality floor 70');
      assert.equal(result.clarityPreserved, true);
      assert.equal(result.exceptionLogged, true);
      assert.ok(loggedWarning && loggedWarning.includes('Image clarity preserved'));
    } finally {
      console.warn = origWarn;
    }
  });

  it('integrates cleanly with processUploadedMedia and persists GPS in registry', async () => {
    const testSubdir = path.join(uploadsRoot, 'test-compression');
    fs.mkdirSync(testSubdir, { recursive: true });
    const uploadPath = path.join(testSubdir, 'selfie-photo.jpg');

    await sharp({
      create: {
        width: 1600,
        height: 1200,
        channels: 3,
        background: { r: 80, g: 140, b: 220 },
      },
    })
      .jpeg({ quality: 95 })
      .toFile(uploadPath);

    const result = await processUploadedMedia(uploadPath, {
      originalName: 'selfie-photo.jpg',
      mimetype: 'image/jpeg',
    });

    assert.equal(result.contentType, 'image/webp');
    assert.ok(result.objectKey.endsWith('.webp'), `Object key must end in .webp: ${result.objectKey}`);
    assert.ok(fs.existsSync(result.absPath), 'Processed file master must exist on disk');

    // Verify database registry entry
    const row = await StoredFile.findOne({ objectKey: result.objectKey, isDeleted: false });
    assert.ok(row, 'StoredFile registry record must exist');
    assert.equal(row.contentType, 'image/webp');
    assert.equal(row.kind, 'image');

    // Clean up test file and registry
    if (fs.existsSync(result.absPath)) {
      try {
        fs.unlinkSync(result.absPath);
      } catch {
        /* ignore */
      }
    }
    if (row) {
      row.isDeleted = true;
      await row.save();
    }
  });
});

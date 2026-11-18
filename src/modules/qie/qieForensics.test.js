import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import sharp from 'sharp';
import {
  QIE_ASSESSMENT,
  QIE_CHECK,
  classifyAiMetadataAndProviders,
  classifySynthId,
  deriveAssessmentOutcome,
  detectAiToolMarkersFromBytes,
  detectCornerSparkleWatermark,
  runVisualForensics,
} from './qieForensics.js';

/** Synthetic certificate page with a faint 4-point sparkle (visual only). */
async function buildSparkleFixture(outPath, { embedGeminiExif = false } = {}) {
  const width = 900;
  const height = 1200;
  const channels = 3;
  const pixels = Buffer.alloc(width * height * channels, 245);

  for (let y = Math.floor(height * 0.82); y < height; y += 1) {
    for (let x = Math.floor(width * 0.82); x < width; x += 1) {
      const i = (y * width + x) * channels;
      pixels[i] = 48;
      pixels[i + 1] = 52;
      pixels[i + 2] = 58;
    }
  }

  const peaks = [
    { x: 820, y: 1080 },
    { x: 845, y: 1095 },
    { x: 860, y: 1070 },
    { x: 835, y: 1110 },
  ];
  for (const peak of peaks) {
    for (let dy = -2; dy <= 2; dy += 1) {
      for (let dx = -2; dx <= 2; dx += 1) {
        const x = peak.x + dx;
        const y = peak.y + dy;
        if (x < 0 || y < 0 || x >= width || y >= height) continue;
        const dist = Math.hypot(dx, dy);
        const v = dist === 0 ? 255 : dist === 1 ? 220 : 190;
        const i = (y * width + x) * channels;
        pixels[i] = v;
        pixels[i + 1] = v;
        pixels[i + 2] = v;
      }
    }
  }

  let pipeline = sharp(pixels, { raw: { width, height, channels } });
  if (embedGeminiExif) {
    pipeline = pipeline.withMetadata({
      exif: {
        IFD0: {
          ImageDescription: 'Diabetes Educator Certificate — Created with Google Gemini',
          Software: 'Google Gemini',
        },
      },
    });
  }
  await pipeline.png().toFile(outPath);
  return outPath;
}

test('Gemini-style sparkle is visual-only and does not attribute Stable Diffusion or Gemini provider', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qie-sparkle-'));
  const fixture = path.join(dir, 'diabetes-educator-certificate.png');
  await buildSparkleFixture(fixture, { embedGeminiExif: false });

  const raster = await sharp(fixture).png().toBuffer();
  const sparkleFindings = await detectCornerSparkleWatermark(raster);
  assert.ok(sparkleFindings.some((f) => f.code === 'VISUAL_WATERMARK_SPARKLE'));
  const sparkle = sparkleFindings.find((f) => f.code === 'VISUAL_WATERMARK_SPARKLE');
  assert.equal(sparkle.evidence.providerAttribution, QIE_CHECK.NOT_ATTRIBUTED);
  assert.ok(!/stable diffusion/i.test(sparkle.message));
  assert.ok(!sparkle.evidence.toolHint);

  const visual = await runVisualForensics(fixture);
  assert.ok(visual.findings.some((f) => f.code === 'VISUAL_WATERMARK_SPARKLE'));
  assert.equal(visual.channels.visualWatermark.status, QIE_CHECK.DETECTED);
  assert.equal(visual.channels.providerAttribution.status, QIE_CHECK.NOT_ATTRIBUTED);
  assert.equal(visual.channels.synthId.status, QIE_CHECK.NOT_CHECKED);
  assert.equal(visual.channels.c2paVerification.status, QIE_CHECK.NOT_CHECKED);
  assert.equal(
    visual.findings.some((f) => f.evidence?.toolId === 'stable_diffusion'),
    false,
    'must not attribute Stable Diffusion from sparkle/binary noise',
  );
  assert.equal(
    visual.findings.some((f) => f.code === 'AI_TOOL_WATERMARK_TEXT'),
    false,
  );

  fs.rmSync(dir, { recursive: true, force: true });
});

test('incidental JPEG binary text does not create Stable Diffusion false positives', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qie-jpeg-'));
  const fixture = path.join(dir, 'camera.jpg');
  await sharp({
    create: {
      width: 640,
      height: 480,
      channels: 3,
      background: { r: 170, g: 165, b: 160 },
    },
  }).jpeg({ quality: 85 }).toFile(fixture);

  // Append incidental entropy tokens that previously false-triggered sdxl / stable diffusion / gemini scans.
  const poisoned = Buffer.concat([
    fs.readFileSync(fixture),
    Buffer.from('\n....sdxl....stable diffusion....gemini....openai....\n'),
  ]);
  fs.writeFileSync(fixture, poisoned);

  const findings = detectAiToolMarkersFromBytes(fixture, await sharp(fixture).metadata().catch(() => ({})));
  assert.equal(findings.length, 0, 'appended JPEG entropy must not drive provider attribution');

  const visual = await runVisualForensics(fixture);
  assert.equal(visual.channels.providerAttribution.status, QIE_CHECK.NOT_ATTRIBUTED);
  assert.equal(visual.findings.some((f) => f.evidence?.toolId === 'stable_diffusion'), false);

  fs.rmSync(dir, { recursive: true, force: true });
});

test('explicit Stable Diffusion metadata attributes provider; SynthID remains NOT_CHECKED', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qie-sd-meta-'));
  const fixture = path.join(dir, 'sd.png');
  await sharp({
    create: {
      width: 500,
      height: 500,
      channels: 3,
      background: { r: 220, g: 220, b: 220 },
    },
  }).withMetadata({
    exif: {
      IFD0: {
        Software: 'Stable Diffusion Automatic1111',
        ImageDescription: 'Generated with Stable Diffusion',
      },
    },
  }).png().toFile(fixture);

  const classified = classifyAiMetadataAndProviders(fixture, await sharp(fixture).metadata());
  assert.equal(classified.providerAttribution.status, QIE_CHECK.DETECTED);
  assert.ok(classified.providerAttribution.providers.includes('stable_diffusion'));
  assert.ok(classified.findings.some((f) => f.code === 'AI_PROVIDER_METADATA'));

  assert.equal(classifySynthId().status, QIE_CHECK.NOT_CHECKED);

  fs.rmSync(dir, { recursive: true, force: true });
});

test('ordinary camera / WhatsApp-like JPEG without AI indicators stays clean on provider channel', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qie-wa-'));
  const fixture = path.join(dir, 'WhatsApp Image 2026-11-13 at 9.25.17 PM.jpeg');
  await sharp({
    create: {
      width: 800,
      height: 1000,
      channels: 3,
      background: { r: 245, g: 245, b: 245 },
    },
  }).jpeg({ quality: 70 }).toFile(fixture);

  const visual = await runVisualForensics(fixture);
  assert.equal(visual.channels.providerAttribution.status, QIE_CHECK.NOT_ATTRIBUTED);
  assert.ok([QIE_CHECK.NOT_DETECTED, QIE_CHECK.NOT_CHECKED].includes(visual.channels.visualWatermark.status));
  assert.equal(visual.channels.synthId.status, QIE_CHECK.NOT_CHECKED);
  assert.equal(visual.findings.some((f) => f.code === 'AI_PROVIDER_METADATA'), false);

  fs.rmSync(dir, { recursive: true, force: true });
});

test('structured Gemini EXIF can attribute Gemini without inventing Stable Diffusion', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qie-gem-meta-'));
  const fixture = path.join(dir, 'gem.png');
  await buildSparkleFixture(fixture, { embedGeminiExif: true });

  const visual = await runVisualForensics(fixture);
  assert.ok(visual.findings.some((f) => f.code === 'VISUAL_WATERMARK_SPARKLE'));
  // EXIF may or may not round-trip depending on sharp/libvips; provider must never be SD.
  assert.equal(visual.findings.some((f) => f.evidence?.toolId === 'stable_diffusion'), false);
  if (visual.channels.providerAttribution.status === QIE_CHECK.DETECTED) {
    assert.ok(visual.channels.providerAttribution.providers.includes('gemini'));
  }

  fs.rmSync(dir, { recursive: true, force: true });
});

test('deriveAssessmentOutcome: AI indicators require review, never automatic fraud', () => {
  assert.equal(
    deriveAssessmentOutcome({
      authenticityScore: 88,
      findings: [{
        code: 'VISUAL_WATERMARK_SPARKLE',
        category: 'visual_watermark',
        severity: 'medium',
      }],
      credentialPassed: true,
      authenticityStatus: 'review',
    }),
    QIE_ASSESSMENT.REVIEW_REQUIRED,
  );

  assert.equal(
    deriveAssessmentOutcome({
      authenticityScore: 30,
      findings: [
        { code: 'FILE_TOO_SMALL', severity: 'high' },
        { code: 'COMPRESSION_INCONSISTENCY', severity: 'high' },
      ],
      credentialPassed: false,
    }),
    QIE_ASSESSMENT.HIGH_RISK,
  );
});

test('blank page does not invent a sparkle watermark', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qie-clean-'));
  const fixture = path.join(dir, 'clean.png');
  await sharp({
    create: {
      width: 800,
      height: 1000,
      channels: 3,
      background: { r: 248, g: 248, b: 248 },
    },
  }).png().toFile(fixture);

  const raster = await sharp(fixture).png().toBuffer();
  const findings = await detectCornerSparkleWatermark(raster);
  assert.equal(findings.length, 0);
  fs.rmSync(dir, { recursive: true, force: true });
});

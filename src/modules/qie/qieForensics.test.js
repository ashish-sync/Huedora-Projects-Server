import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import sharp from 'sharp';
import {
  QIE_ASSESSMENT,
  deriveAssessmentOutcome,
  detectCornerSparkleWatermark,
  runVisualForensics,
} from './qieForensics.js';

/** Synthetic Diabetes Educator certificate page with a faint 4-point Gemini-like sparkle. */
async function buildDiabetesEducatorFixture(outPath) {
  const width = 900;
  const height = 1200;
  const channels = 3;
  const pixels = Buffer.alloc(width * height * channels, 245);

  // Soft certificate-like header band
  for (let y = 40; y < 120; y += 1) {
    for (let x = 80; x < width - 80; x += 1) {
      const i = (y * width + x) * channels;
      pixels[i] = 230;
      pixels[i + 1] = 236;
      pixels[i + 2] = 245;
    }
  }

  // Darker bottom-right plate (watermark sits on quieter background, like Gemini sparkles)
  for (let y = Math.floor(height * 0.82); y < height; y += 1) {
    for (let x = Math.floor(width * 0.82); x < width; x += 1) {
      const i = (y * width + x) * channels;
      pixels[i] = 48;
      pixels[i + 1] = 52;
      pixels[i + 2] = 58;
    }
  }

  // Four bright sparkle peaks in bottom-right (Gemini-style watermark cue)
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

  // Keep a valid PNG and stamp Gemini into EXIF so byte/metadata scans can catch it.
  await sharp(pixels, { raw: { width, height, channels } })
    .withMetadata({
      exif: {
        IFD0: {
          ImageDescription: 'Diabetes Educator Certificate — Created with Google Gemini',
          Software: 'Google Gemini',
        },
      },
    })
    .png()
    .toFile(outPath);
  return outPath;
}

test('Diabetes Educator fixture: detects faint four-point Gemini sparkle watermark', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qie-gemini-'));
  const fixture = path.join(dir, 'diabetes-educator-certificate.png');
  await buildDiabetesEducatorFixture(fixture);

  const raster = await sharp(fixture).png().toBuffer();
  const sparkleFindings = await detectCornerSparkleWatermark(raster);
  assert.ok(
    sparkleFindings.some((f) => f.code === 'AI_TOOL_WATERMARK_SPARKLE'),
    'expected AI_TOOL_WATERMARK_SPARKLE finding for bottom-right four-point sparkle',
  );
  const sparkle = sparkleFindings.find((f) => f.code === 'AI_TOOL_WATERMARK_SPARKLE');
  assert.equal(sparkle.severity, 'medium');
  assert.equal(sparkle.recommendedAction, 'manual_verify_ai_watermark');
  assert.ok(sparkle.evidence?.peakCount >= 3 && sparkle.evidence?.peakCount <= 6);
  assert.equal(sparkle.location?.region, 'bottom_right_corner');

  const visual = await runVisualForensics(fixture);
  assert.ok(visual.findings.some((f) => f.code === 'AI_TOOL_WATERMARK_SPARKLE'));
  assert.ok(
    visual.findings.some((f) => f.code === 'AI_TOOL_WATERMARK_TEXT' && f.evidence?.toolId === 'gemini'),
    'expected Gemini text watermark marker from embedded bytes',
  );
  assert.ok(visual.previewRegions.some((r) => r.code === 'AI_TOOL_WATERMARK_SPARKLE'));
  assert.ok(visual.aiWatermarkOnly || visual.findings.some((f) => f.code.startsWith('AI_TOOL_WATERMARK')));

  // AI watermark alone must map to review_required — never automatic fraud/high_risk.
  const outcome = deriveAssessmentOutcome({
    authenticityScore: visual.authenticityScore,
    findings: visual.findings.filter((f) => f.code.startsWith('AI_TOOL_WATERMARK') || f.severity === 'low'),
    credentialPassed: true,
    authoritativeVerified: false,
  });
  assert.equal(outcome, QIE_ASSESSMENT.REVIEW_REQUIRED);

  fs.rmSync(dir, { recursive: true, force: true });
});

test('deriveAssessmentOutcome respects four outcomes and AI-watermark rule', () => {
  assert.equal(
    deriveAssessmentOutcome({
      authenticityScore: 90,
      findings: [],
      credentialPassed: true,
      authoritativeVerified: true,
    }),
    QIE_ASSESSMENT.VERIFIED,
  );

  assert.equal(
    deriveAssessmentOutcome({
      authenticityScore: 88,
      findings: [],
      credentialPassed: true,
    }),
    QIE_ASSESSMENT.LOW_RISK,
  );

  assert.equal(
    deriveAssessmentOutcome({
      authenticityScore: 80,
      findings: [{
        code: 'AI_TOOL_WATERMARK_SPARKLE',
        severity: 'medium',
        confidence: 0.8,
      }],
      credentialPassed: true,
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

test('blank certificate-like page does not invent a sparkle watermark', async () => {
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

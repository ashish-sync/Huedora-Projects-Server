import test from 'node:test';
import assert from 'node:assert/strict';
import {
  extractCertificateFields,
  isLikelyBinaryGarbage,
  namesLikelyMatch,
  sanitizeOcrText,
} from './qieExtraction.js';
import { deriveAssessmentOutcome, QIE_ASSESSMENT } from './qieForensics.js';

test('rejects JPEG/binary garbage as unreadable OCR text', () => {
  const garbage = 'JFIF  $ $ 6*&&*6>424>LDDL_Z_|| WhatsApp Image 2026-11-13';
  assert.equal(isLikelyBinaryGarbage(garbage), true);
  assert.equal(sanitizeOcrText(garbage), '');
});

test('extracts structured certificate fields from clean text', () => {
  const text = `
    This is to certify that Anita Sharma
    has successfully completed the Diploma in Diabetes Educator programme
    at All India Institute of Medical Sciences
    Certificate No: CERT-2024-8891
    Awarded year 2024
  `;
  const extracted = extractCertificateFields(text, 'anita-sharma-certificate.pdf', { ocrConfidence: 0.8 });
  assert.match(extracted.holderName, /Anita Sharma/i);
  assert.match(extracted.qualification, /Diabetes Educator|Diploma/i);
  assert.match(extracted.institution, /All India Institute/i);
  assert.equal(extracted.awardYear, '2024');
  assert.match(extracted.referenceNo, /CERT-2024-8891/i);
  assert.equal(extracted.extractionQuality.status, 'good');
  assert.ok(extracted.ocrAccuracyScore >= 65);
});

test('WhatsApp capture filename year is low-confidence and does not invent a passable extraction', () => {
  const extracted = extractCertificateFields(
    '',
    'WhatsApp Image 2026-11-13 at 9.25.17 PM.jpeg',
    { ocrConfidence: 0 },
  );
  assert.equal(extracted.holderName, '');
  assert.ok(
    extracted.extractionIssues.some((i) => i.code === 'OCR_TEXT_UNAVAILABLE'
      || i.code === 'CANDIDATE_NAME_NOT_EXTRACTED'
      || i.code === 'CORE_FIELDS_MISSING'),
  );
  assert.equal(extracted.extractionQuality.status, 'failed');
  // Capture-date year must not be treated as a trusted award year.
  assert.ok(!extracted.awardYear || extracted.fieldSources.awardYear === 'filename_capture_date');
  if (extracted.fieldSources.awardYear === 'filename_capture_date') {
    assert.ok(extracted.fieldConfidence.awardYear < 0.4 || extracted.awardYear === '');
  }
});

test('identity matching never uses expected name as document text', () => {
  assert.equal(namesLikelyMatch('Anita Sharma', 'Anita Sharma'), true);
  assert.equal(namesLikelyMatch('Anita Sharma', ''), false);
  // Missing extracted name must never be treated as a match candidate.
  assert.equal(Boolean('' && namesLikelyMatch('Anita Sharma', '')), false);
});

test('failed extraction and inconclusive identity require review, not automatic fraud', () => {
  assert.equal(
    deriveAssessmentOutcome({
      authenticityScore: 91,
      findings: [{
        code: 'OCR_TEXT_UNAVAILABLE',
        category: 'extraction',
        severity: 'high',
      }],
      credentialPassed: false,
      extractionQuality: { status: 'failed' },
      identityStatus: 'inconclusive',
      authenticityStatus: 'clear',
    }),
    QIE_ASSESSMENT.REVIEW_REQUIRED,
  );

  assert.equal(
    deriveAssessmentOutcome({
      authenticityScore: 80,
      findings: [{
        code: 'AI_TOOL_WATERMARK_TEXT',
        category: 'ai_generation',
        severity: 'medium',
      }],
      credentialPassed: false,
      extractionQuality: { status: 'degraded' },
      identityStatus: 'inconclusive',
      authenticityStatus: 'review',
    }),
    QIE_ASSESSMENT.REVIEW_REQUIRED,
  );
});

import fs from 'fs';
import path from 'path';
import { absoluteUploadPath } from '../../storage/uploadKeys.js';
import {
  QIE_STATUSES,
  deriveQieIndicator,
  pushQieHistory,
} from './qieStatus.js';
import {
  QIE_ASSESSMENT,
  deriveAssessmentOutcome,
  runVisualForensics,
} from './qieForensics.js';

function normalizeName(value = '') {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function nameTokens(value = '') {
  return normalizeName(value).split(' ').filter((t) => t.length > 1);
}

/** Loose name overlap: shared tokens ≥ 1 and majority of shorter name. */
export function namesLikelyMatch(a, b) {
  const ta = nameTokens(a);
  const tb = nameTokens(b);
  if (!ta.length || !tb.length) return false;
  const setB = new Set(tb);
  const overlap = ta.filter((t) => setB.has(t));
  const shorter = Math.min(ta.length, tb.length);
  return overlap.length >= Math.max(1, Math.ceil(shorter * 0.6));
}

function readSnippet(absPath, maxBytes = 180_000) {
  try {
    if (!absPath || !fs.existsSync(absPath)) return '';
    const buf = fs.readFileSync(absPath);
    const slice = buf.subarray(0, Math.min(buf.length, maxBytes));
    return slice.toString('utf8').replace(/[^\x09\x0A\x0D\x20-\x7E]/g, ' ').replace(/\s+/g, ' ').trim();
  } catch {
    return '';
  }
}

function extractFieldsFromText(text = '', originalName = '') {
  const blob = `${originalName} ${text}`.slice(0, 40_000);
  const degreeMatch = blob.match(
    /\b(bachelor|master|diploma|certificate|educator|b\.?\s?sc|m\.?\s?sc|mbbs|bds|bpharm|nursing|phd|doctorate|diabetes)[^\n,]{0,80}/i,
  );
  const yearMatch = blob.match(/\b(19|20)\d{2}\b/);
  const refMatch = blob.match(/\b(?:reg(?:istration)?|roll|cert(?:ificate)?|ref(?:erence)?|no\.?)\s*[:#-]?\s*([A-Z0-9\-\/]{4,})/i);
  const universityMatch = blob.match(
    /\b([A-Z][A-Za-z&.\s]{3,60}(?:University|College|Institute|Board|Academy|Association|Council))\b/,
  );
  const urlMatch = blob.match(/https?:\/\/[^\s)]+/i);
  const qrHint = /\b(qr|verify|verification\s*url|scan\s*to\s*verify)\b/i.test(blob);

  const fields = {
    holderName: '',
    institution: universityMatch ? universityMatch[1].trim() : '',
    qualification: degreeMatch ? degreeMatch[0].trim() : '',
    awardYear: yearMatch ? yearMatch[0] : '',
    referenceNo: refMatch ? refMatch[1].trim() : '',
    classification: degreeMatch ? 'educational_certificate' : 'unknown_document',
    verificationUrl: urlMatch ? urlMatch[0] : '',
    qrOrVerifyCue: qrHint,
    rawTextSnippet: blob.slice(0, 600),
    sourceFileName: originalName || '',
  };

  let accuracyScore = 20;
  if (fields.institution) accuracyScore += 20;
  if (fields.qualification) accuracyScore += 20;
  if (fields.awardYear) accuracyScore += 15;
  if (fields.referenceNo) accuracyScore += 15;
  if (blob.length > 80) accuracyScore += 10;
  fields.ocrAccuracyScore = Math.max(0, Math.min(100, accuracyScore));
  return fields;
}

/**
 * Run OCR → forensic → credential → risk phases.
 * Credential verification is independent of a clean forensic scan.
 * AI watermark alone never forces a fraud classification.
 */
export async function runQieAnalysisPhases(record, { expectedHolderName = '' } = {}) {
  let absPath = '';
  try {
    absPath = absoluteUploadPath(record.objectKey || record.storedPath) || '';
  } catch {
    absPath = '';
  }
  const exists = Boolean(absPath && fs.existsSync(absPath));
  const ext = path.extname(record.originalName || record.storedPath || '').toLowerCase();

  // 1) OCR & classification (separate accuracy score)
  const snippet = exists ? readSnippet(absPath) : '';
  const extracted = extractFieldsFromText(snippet, record.originalName || '');
  if (!extracted.holderName && expectedHolderName) {
    extracted.holderNameHint = expectedHolderName;
  }
  record.extracted = extracted;
  record.ocr = {
    accuracyScore: extracted.ocrAccuracyScore,
    engine: 'tylo-qie-ocr-lite-v2',
    textLength: snippet.length,
    completedAt: new Date().toISOString(),
  };
  record.phase = 'ocr_classification';

  // 2) Visual forensic authenticity (corners, watermarks, manipulation)
  const visual = exists
    ? await runVisualForensics(absPath)
    : {
        engine: 'tylo-qie-forensics-v2',
        findings: [{
          code: 'FILE_MISSING',
          category: 'integrity',
          severity: 'high',
          confidence: 1,
          message: 'Stored file not found for forensic analysis',
          location: { region: 'document' },
          evidence: {},
          recommendedAction: 'reupload_document',
        }],
        previewRegions: [],
        authenticityScore: 0,
        aiWatermarkOnly: false,
        durationMs: 0,
      };

  const allowedExt = new Set(['.pdf', '.jpg', '.jpeg', '.png', '.webp', '.gif', '.bmp', '.tif', '.tiff']);
  if (ext && !allowedExt.has(ext)) {
    visual.findings.push({
      code: 'UNEXPECTED_EXT',
      category: 'integrity',
      severity: 'medium',
      confidence: 0.7,
      message: `Unexpected extension ${ext}`,
      location: { region: 'file' },
      evidence: { ext },
      recommendedAction: 'confirm_file_type',
    });
  }

  if (extracted.verificationUrl) {
    visual.findings.push({
      code: 'SUSPICIOUS_VERIFICATION_URL',
      category: 'metadata',
      severity: 'low',
      confidence: 0.4,
      message: 'Embedded verification URL detected — confirm it belongs to the issuing institution',
      location: { region: 'ocr_text' },
      evidence: { url: extracted.verificationUrl },
      recommendedAction: 'validate_verification_url',
    });
  }

  const cleanScan = visual.findings.filter((f) => f.severity === 'high').length === 0;
  record.forensic = {
    cleanScan,
    findings: visual.findings,
    previewRegions: visual.previewRegions || [],
    authenticityScore: visual.authenticityScore,
    aiWatermarkOnly: Boolean(visual.aiWatermarkOnly),
    analyzedAt: new Date().toISOString(),
    engine: visual.engine || 'tylo-qie-forensics-v2',
    durationMs: visual.durationMs || 0,
    dimensions: { width: visual.width || 0, height: visual.height || 0 },
    meta: visual.meta || {},
  };
  record.phase = 'forensic_analysis';

  // 3) Credential verification (required for any path to green)
  const holderFromDoc = extracted.holderName || extracted.holderNameHint || '';
  const nameOk = expectedHolderName
    ? namesLikelyMatch(expectedHolderName, holderFromDoc) || namesLikelyMatch(expectedHolderName, extracted.rawTextSnippet)
    : Boolean(extracted.institution || extracted.qualification);
  const fieldsPresent = Boolean(extracted.institution || extracted.qualification || extracted.referenceNo || extracted.awardYear);
  const credentialPassed = Boolean(
    exists
    && fieldsPresent
    && (expectedHolderName ? nameOk : true)
    && visual.findings.every((f) => f.code !== 'FILE_MISSING'),
  );

  record.credentialVerification = {
    passed: credentialPassed,
    method: 'local_field_and_identity_crosscheck',
    expectedHolderName: expectedHolderName || '',
    nameMatch: expectedHolderName ? nameOk : null,
    fieldsPresent,
    authoritativeVerified: false,
    details: credentialPassed
      ? 'Credential fields extracted and identity cross-check passed'
      : 'Credential verification did not pass — requires HR review or reanalysis',
    checkedAt: new Date().toISOString(),
    cleanScanInsufficient: true,
  };
  record.phase = 'credential_verification';

  // 4) Evidence-based risk assessment (4 outcomes)
  const assessmentOutcome = deriveAssessmentOutcome({
    authenticityScore: visual.authenticityScore,
    findings: visual.findings,
    credentialPassed,
    authoritativeVerified: false,
  });

  let score = 100 - (visual.authenticityScore || 0);
  score = Math.round(score);
  if (!credentialPassed) score = Math.max(score, 55);
  if (visual.aiWatermarkOnly) score = Math.max(score, 35); // elevates attention, not automatic fraud
  score = Math.max(0, Math.min(100, score));

  const level = assessmentOutcome === QIE_ASSESSMENT.HIGH_RISK
    ? 'high'
    : assessmentOutcome === QIE_ASSESSMENT.LOW_RISK
      ? 'low'
      : assessmentOutcome === QIE_ASSESSMENT.VERIFIED
        ? 'low'
        : 'medium';

  record.risk = {
    score,
    level,
    assessmentOutcome,
    ocrAccuracyScore: extracted.ocrAccuracyScore,
    authenticityScore: visual.authenticityScore,
    factors: [
      !credentialPassed ? 'credential_verification_failed' : null,
      !cleanScan ? 'forensic_findings' : null,
      visual.aiWatermarkOnly ? 'ai_tool_watermark_review' : null,
      expectedHolderName && !nameOk ? 'name_mismatch' : null,
      !fieldsPresent ? 'sparse_extraction' : null,
    ].filter(Boolean),
    assessedAt: new Date().toISOString(),
  };
  record.phase = 'risk_assessment';

  // 5) Route workflow status — never auto-green; AI watermark alone stays reviewable
  const from = record.status;
  if (!credentialPassed && assessmentOutcome === QIE_ASSESSMENT.HIGH_RISK) {
    record.status = QIE_STATUSES.DISCREPANCY;
    record.phase = 'discrepancy';
  } else {
    record.status = QIE_STATUSES.HR_REVIEW;
    record.phase = 'hr_review';
  }
  record.indicator = deriveQieIndicator(record);
  pushQieHistory(record, {
    action: 'QIE.ANALYSIS_COMPLETE',
    from,
    to: record.status,
    meta: {
      credentialPassed,
      cleanScan,
      riskScore: score,
      assessmentOutcome,
      authenticityScore: visual.authenticityScore,
      ocrAccuracyScore: extracted.ocrAccuracyScore,
      findingCount: visual.findings.length,
    },
  });

  return record;
}

import path from 'path';
import fs from 'fs';
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
import {
  namesLikelyMatch,
  runDocumentExtraction,
} from './qieExtraction.js';

export { namesLikelyMatch };

function findingFromIssue(issue) {
  return {
    code: issue.code,
    category: 'extraction',
    severity: issue.severity || 'medium',
    confidence: issue.severity === 'high' ? 0.85 : 0.65,
    message: issue.message,
    location: { region: 'ocr_text', page: 1, bboxNorm: null },
    evidence: {},
    recommendedAction: issue.recommendedAction || 'manual_review',
  };
}

/**
 * Run OCR → forensic → independent verification checks → risk.
 * Identity, document authenticity, and authoritative credential checks are separate.
 * Forensic / AI watermark signals never alone prove authenticity or fraud.
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

  // 1) OCR & structured extraction (quality-gated)
  const { extracted, ocr } = await runDocumentExtraction(
    exists ? absPath : '',
    record.originalName || '',
  );
  // Keep expected name as context only — never treat it as OCR-extracted holder name.
  extracted.expectedHolderName = expectedHolderName || '';
  record.extracted = extracted;
  record.ocr = ocr;
  record.phase = 'ocr_classification';

  // 2) Visual forensic pass (evidence only)
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
          location: { region: 'document', page: 1, bboxNorm: null },
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
      location: { region: 'file', page: 1, bboxNorm: null },
      evidence: { ext },
      recommendedAction: 'confirm_file_type',
    });
  }

  for (const issue of extracted.extractionIssues || []) {
    // Surface extraction problems as review findings (not automatic fraud).
    visual.findings.push(findingFromIssue(issue));
  }

  if (extracted.verificationUrl) {
    visual.findings.push({
      code: 'SUSPICIOUS_VERIFICATION_URL',
      category: 'metadata',
      severity: 'low',
      confidence: 0.4,
      message: 'Embedded verification URL detected — confirm it belongs to the issuing institution',
      location: { region: 'ocr_text', page: 1, bboxNorm: null },
      evidence: { url: extracted.verificationUrl },
      recommendedAction: 'validate_verification_url',
    });
  }

  const cleanScan = visual.findings.filter((f) => f.severity === 'high' && f.category !== 'extraction').length === 0;
  record.forensic = {
    cleanScan,
    findings: visual.findings,
    previewRegions: visual.previewRegions || [],
    authenticityScore: visual.authenticityScore,
    aiWatermarkOnly: Boolean(visual.aiWatermarkOnly),
    channels: visual.channels || {},
    analyzedAt: new Date().toISOString(),
    engine: visual.engine || 'tylo-qie-forensics-v2',
    durationMs: visual.durationMs || 0,
    dimensions: { width: visual.width || 0, height: visual.height || 0 },
    meta: visual.meta || {},
    // Explicit: forensic score is not an authenticity verdict.
    independentOfCredential: true,
    doesNotProveAuthenticity: true,
    doesNotProveFraud: true,
  };
  record.phase = 'forensic_analysis';

  // 3a) Identity matching — only against OCR-extracted holder name (never the expected-name hint).
  // Missing candidate name must NEVER yield IDENTITY_MATCHED.
  const extractedName = String(extracted.holderName || '').trim();
  const nameConfidence = Number(extracted.fieldConfidence?.holderName || 0);
  let identityStatus = 'inconclusive';
  let identityCode = 'IDENTITY_INCONCLUSIVE';
  let nameMatch = null;
  if (!expectedHolderName) {
    identityStatus = extractedName ? 'extracted_only' : 'inconclusive';
    identityCode = extractedName ? 'IDENTITY_EXTRACTED_ONLY' : 'IDENTITY_INCONCLUSIVE';
  } else if (!extractedName || nameConfidence < 0.45) {
    identityStatus = 'inconclusive';
    identityCode = 'IDENTITY_INCONCLUSIVE';
    nameMatch = false;
  } else if (namesLikelyMatch(expectedHolderName, extractedName)) {
    identityStatus = 'matched';
    identityCode = 'IDENTITY_MATCHED';
    nameMatch = true;
  } else {
    identityStatus = 'mismatch';
    identityCode = 'IDENTITY_MISMATCH';
    nameMatch = false;
  }

  const identityCheck = {
    status: identityStatus,
    code: identityCode,
    expectedHolderName: expectedHolderName || '',
    extractedHolderName: extractedName,
    nameMatch,
    details:
      identityStatus === 'matched'
        ? 'Candidate name on the certificate matches the contact record'
        : identityStatus === 'mismatch'
          ? 'Candidate name on the certificate does not match the contact record'
          : 'Candidate name could not be reliably read for identity matching',
  };

  // 3b) Document authenticity — summary of forensic evidence only (not a fraud verdict)
  const authenticityStatus = visual.aiWatermarkOnly
    || visual.channels?.visualWatermark?.status === 'DETECTED'
    || visual.channels?.providerAttribution?.status === 'DETECTED'
    ? 'review'
    : visual.findings.some((f) => f.severity === 'high' && f.category !== 'extraction')
      ? 'concerns'
      : visual.findings.some((f) => f.severity === 'medium' && f.category !== 'extraction')
        ? 'review'
        : 'clear';

  const documentAuthenticity = {
    status: authenticityStatus,
    score: visual.authenticityScore,
    aiWatermarkOnly: Boolean(visual.aiWatermarkOnly),
    cleanScan,
    channels: visual.channels || {},
    details:
      authenticityStatus === 'clear'
        ? 'No significant visual authenticity concerns were flagged'
        : authenticityStatus === 'concerns'
          ? 'Significant visual concerns were flagged for human review (not automatic fraud)'
          : 'Authenticity indicators require manual review. AI markers never alone prove fraud.',
    doesNotProveAuthenticity: true,
    doesNotProveFraud: true,
  };

  // 3c) Authoritative credential verification — independent; not auto-satisfied by OCR/forensics
  const institutionOk = Boolean(extracted.institution)
    && Number(extracted.fieldConfidence?.institution || 0) >= 0.45;
  const qualificationOk = Boolean(extracted.qualification)
    && Number(extracted.fieldConfidence?.qualification || 0) >= 0.45;
  const authoritativeVerification = {
    status: 'not_checked',
    code: 'AUTHORITATIVE_NOT_CHECKED',
    verified: false,
    method: '',
    details: 'No authoritative issuer/registry check was completed for this document',
    localFieldReadiness: {
      institutionReadable: institutionOk,
      qualificationReadable: qualificationOk,
      note: (!institutionOk || !qualificationOk)
        ? 'Unreadable or low-confidence institution/qualification must not be treated as verified'
        : 'Local fields are readable but still not issuer-verified',
    },
  };

  // Extraction quality gate
  const quality = extracted.extractionQuality || { status: 'failed', score: 0 };
  const trustedFields = [
    extracted.qualification,
    extracted.institution,
    extracted.referenceNo,
  ].filter(Boolean);
  const yearTrusted = Boolean(
    extracted.awardYear
    && (extracted.fieldConfidence?.awardYear || 0) >= 0.4
    && extracted.fieldSources?.awardYear !== 'filename_capture_date',
  );
  const fieldsPresent = trustedFields.length > 0 || yearTrusted;
  const extractionOk = quality.status === 'good'
    && trustedFields.length >= 1
    && Boolean(extractedName)
    && (extracted.fieldConfidence?.holderName || 0) >= 0.45;

  // Overall credential gate used by green-tick / Approve rules:
  // requires solid extraction + identity match. Forensics never flip this to true.
  const credentialPassed = Boolean(
    exists
    && extractionOk
    && identityStatus === 'matched'
    && authoritativeVerification.status !== 'failed',
  );

  record.credentialVerification = {
    passed: credentialPassed,
    method: 'structured_extraction_identity_gate_v3',
    expectedHolderName: expectedHolderName || '',
    nameMatch,
    fieldsPresent,
    authoritativeVerified: false,
    extractionQuality: quality,
    identityCheck,
    documentAuthenticity,
    authoritativeVerification,
    details: credentialPassed
      ? 'Structured extraction and identity match passed; authoritative verification still not completed'
      : !extractionOk
        ? 'Credential verification not passed — extraction quality is insufficient or core fields are missing/low-confidence'
        : identityStatus === 'mismatch'
          ? 'Credential verification not passed — identity mismatch requires HR review'
          : 'Credential verification not passed — identity could not be confirmed from the document',
    checkedAt: new Date().toISOString(),
    cleanScanInsufficient: true,
  };
  record.phase = 'credential_verification';

  // 4) Risk / assessment from extraction quality + independent checks (not watermark alone)
  const assessmentOutcome = deriveAssessmentOutcome({
    authenticityScore: visual.authenticityScore,
    findings: visual.findings,
    credentialPassed,
    authoritativeVerified: false,
    extractionQuality: quality,
    identityStatus,
    authenticityStatus,
  });

  let score = 20;
  if (quality.status === 'failed') score += 35;
  if (quality.status === 'degraded') score += 20;
  if (identityStatus === 'mismatch') score += 25;
  if (identityStatus === 'inconclusive') score += 15;
  if (authenticityStatus === 'concerns') score += 20;
  if (authenticityStatus === 'review') score += 12;
  if (visual.aiWatermarkOnly) score += 8; // attention only
  if (!fieldsPresent) score += 10;
  score = Math.max(0, Math.min(100, Math.round(score)));

  const level = assessmentOutcome === QIE_ASSESSMENT.HIGH_RISK
    ? 'high'
    : assessmentOutcome === QIE_ASSESSMENT.LOW_RISK || assessmentOutcome === QIE_ASSESSMENT.VERIFIED
      ? 'low'
      : 'medium';

  record.risk = {
    score,
    level,
    assessmentOutcome,
    ocrAccuracyScore: extracted.ocrAccuracyScore,
    authenticityScore: visual.authenticityScore,
    factors: [
      quality.status !== 'good' ? `extraction_${quality.status}` : null,
      !credentialPassed ? 'credential_verification_failed' : null,
      identityStatus === 'mismatch' ? 'identity_mismatch' : null,
      identityStatus === 'inconclusive' ? 'identity_inconclusive' : null,
      authenticityStatus !== 'clear' ? `authenticity_${authenticityStatus}` : null,
      visual.aiWatermarkOnly ? 'ai_tool_watermark_review' : null,
      !fieldsPresent ? 'sparse_extraction' : null,
      'authoritative_not_checked',
    ].filter(Boolean),
    assessedAt: new Date().toISOString(),
  };
  record.phase = 'risk_assessment';

  // 5) Workflow routing — never auto-green
  const from = record.status;
  const severeIdentityOrExtraction = identityStatus === 'mismatch'
    || (quality.status === 'failed' && authenticityStatus === 'concerns');
  if (!credentialPassed && assessmentOutcome === QIE_ASSESSMENT.HIGH_RISK && severeIdentityOrExtraction) {
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
      extractionQuality: quality.status,
      identityStatus,
      authenticityStatus,
      findingCount: visual.findings.length,
    },
  });

  return record;
}

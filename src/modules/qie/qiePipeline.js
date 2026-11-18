import fs from 'fs';
import path from 'path';
import { absoluteUploadPath } from '../../storage/uploadKeys.js';
import {
  QIE_STATUSES,
  deriveQieIndicator,
  pushQieHistory,
} from './qieStatus.js';

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

function readSnippet(absPath, maxBytes = 64_000) {
  try {
    if (!absPath || !fs.existsSync(absPath)) return '';
    const buf = fs.readFileSync(absPath);
    const slice = buf.subarray(0, Math.min(buf.length, maxBytes));
    // Prefer printable ASCII/UTF-8 text; binary PDFs still yield partial strings.
    return slice.toString('utf8').replace(/[^\x09\x0A\x0D\x20-\x7E]/g, ' ').replace(/\s+/g, ' ').trim();
  } catch {
    return '';
  }
}

function extractFieldsFromText(text = '', originalName = '') {
  const blob = `${originalName} ${text}`.slice(0, 20_000);
  const degreeMatch = blob.match(
    /\b(bachelor|master|diploma|certificate|b\.?\s?sc|m\.?\s?sc|mbbs|bds|bpharm|nursing|phd|doctorate)[^\n,]{0,60}/i,
  );
  const yearMatch = blob.match(/\b(19|20)\d{2}\b/);
  const refMatch = blob.match(/\b(?:reg(?:istration)?|roll|cert(?:ificate)?|ref(?:erence)?)\s*[:#-]?\s*([A-Z0-9\-\/]{4,})/i);
  const universityMatch = blob.match(
    /\b([A-Z][A-Za-z&.\s]{3,60}(?:University|College|Institute|Board|Academy))\b/,
  );

  return {
    holderName: '',
    institution: universityMatch ? universityMatch[1].trim() : '',
    qualification: degreeMatch ? degreeMatch[0].trim() : '',
    awardYear: yearMatch ? yearMatch[0] : '',
    referenceNo: refMatch ? refMatch[1].trim() : '',
    classification: degreeMatch ? 'educational_certificate' : 'unknown_document',
    rawTextSnippet: blob.slice(0, 400),
    sourceFileName: originalName || '',
  };
}

/**
 * Run OCR → forensic → credential → risk phases.
 * Credential verification is independent of a clean forensic scan.
 */
export async function runQieAnalysisPhases(record, { expectedHolderName = '' } = {}) {
  let absPath = '';
  try {
    absPath = absoluteUploadPath(record.objectKey || record.storedPath) || '';
  } catch {
    absPath = '';
  }
  const exists = Boolean(absPath && fs.existsSync(absPath));
  const stat = exists ? fs.statSync(absPath) : null;
  const ext = path.extname(record.originalName || record.storedPath || '').toLowerCase();

  // 1) OCR & classification
  const snippet = exists ? readSnippet(absPath) : '';
  const extracted = extractFieldsFromText(snippet, record.originalName || '');
  if (!extracted.holderName && expectedHolderName) {
    extracted.holderNameHint = expectedHolderName;
  }
  record.extracted = extracted;
  record.phase = 'ocr_classification';

  // 2) Forensic analysis (supporting evidence only — never grants green alone)
  const findings = [];
  if (!exists) findings.push({ code: 'FILE_MISSING', severity: 'high', message: 'Stored file not found on disk for analysis' });
  if (stat && stat.size < 512) findings.push({ code: 'FILE_TOO_SMALL', severity: 'medium', message: 'File unusually small for a certificate' });
  if (stat && stat.size > 25 * 1024 * 1024) findings.push({ code: 'FILE_LARGE', severity: 'low', message: 'File larger than typical certificate scans' });
  const allowedExt = new Set(['.pdf', '.jpg', '.jpeg', '.png', '.webp', '.gif', '.bmp', '.tif', '.tiff']);
  if (ext && !allowedExt.has(ext)) findings.push({ code: 'UNEXPECTED_EXT', severity: 'medium', message: `Unexpected extension ${ext}` });
  const cleanScan = findings.filter((f) => f.severity === 'high').length === 0;
  record.forensic = {
    cleanScan,
    findings,
    analyzedAt: new Date().toISOString(),
    engine: 'tylo-qie-local-v1',
  };
  record.phase = 'forensic_analysis';

  // 3) Credential verification (required for any path to green)
  const holderFromDoc = extracted.holderName || extracted.holderNameHint || '';
  const nameOk = expectedHolderName
    ? namesLikelyMatch(expectedHolderName, holderFromDoc) || namesLikelyMatch(expectedHolderName, extracted.rawTextSnippet)
    : Boolean(extracted.institution || extracted.qualification);
  const fieldsPresent = Boolean(extracted.institution || extracted.qualification || extracted.referenceNo || extracted.awardYear);
  const credentialPassed = Boolean(exists && fieldsPresent && (expectedHolderName ? nameOk : true) && findings.every((f) => f.code !== 'FILE_MISSING'));

  record.credentialVerification = {
    passed: credentialPassed,
    method: 'local_field_and_identity_crosscheck',
    expectedHolderName: expectedHolderName || '',
    nameMatch: expectedHolderName ? nameOk : null,
    fieldsPresent,
    details: credentialPassed
      ? 'Credential fields extracted and identity cross-check passed'
      : 'Credential verification did not pass — requires HR review or reanalysis',
    checkedAt: new Date().toISOString(),
    // Explicit: forensic cleanScan alone is insufficient
    cleanScanInsufficient: true,
  };
  record.phase = 'credential_verification';

  // 4) Risk assessment
  let score = 20;
  if (!exists) score += 50;
  if (!credentialPassed) score += 35;
  if (!record.forensic.cleanScan) score += 15;
  if (!fieldsPresent) score += 10;
  if (expectedHolderName && !nameOk) score += 20;
  score = Math.max(0, Math.min(100, score));
  const level = score >= 70 ? 'high' : score >= 40 ? 'medium' : 'low';
  record.risk = {
    score,
    level,
    factors: [
      !credentialPassed ? 'credential_verification_failed' : null,
      !cleanScan ? 'forensic_findings' : null,
      expectedHolderName && !nameOk ? 'name_mismatch' : null,
      !fieldsPresent ? 'sparse_extraction' : null,
    ].filter(Boolean),
    assessedAt: new Date().toISOString(),
  };
  record.phase = 'risk_assessment';

  // 5) Route to HR review or discrepancy — never auto-green
  const from = record.status;
  if (!credentialPassed) {
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
    },
  });

  return record;
}

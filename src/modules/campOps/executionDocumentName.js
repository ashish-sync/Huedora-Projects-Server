import path from 'path';
import { stripDoctorNamePrefix } from '../../utils/textFormat.js';

/**
 * Camp One execution-document nomenclature (canonical).
 *
 * Display / logical:  {DOCTOR}{CODE}[.ext]           e.g. ADIPF.webp
 * Stored on disk/R2:  {campId}__{DOCTOR}{CODE}[.ext] e.g. 26-10-0001__ADIPF.webp
 *
 * Codes: DF doctor_form · PF patient_form · GS gps_selfie · OT other
 * No camp-date / numeric suffix after the doctor+code token.
 * Collisions: -2, -3, … before the extension (ADIPF-2.webp).
 */

export const EXECUTION_DOC_TYPE_CODES = {
  doctor_form: 'DF',
  patient_form: 'PF',
  gps_selfie: 'GS',
  other: 'OT',
};

const DOC_CODE_PATTERN = 'DF|PF|GS|OT|DOC';

/** Doctor token for file names: "Dr. Karan" / "Karan Sharma" → KARAN / KARANSHARMA */
export function doctorNameFileToken(doctorName = '') {
  const stripped = stripDoctorNamePrefix(doctorName);
  const token = String(stripped || doctorName || '')
    .replace(/[^a-zA-Z0-9]+/g, '')
    .toUpperCase();
  return token || 'DOCTOR';
}

export function executionDocTypeCode(docType = '') {
  const key = String(docType || '').trim().toLowerCase();
  return EXECUTION_DOC_TYPE_CODES[key] || 'DOC';
}

/**
 * Base name without extension: Doctor + DocCode (no date / numeric suffix).
 * e.g. ADIPF, KARANDF
 */
export function buildExecutionDocumentBaseName({
  doctorName = '',
  docType = '',
} = {}) {
  return `${doctorNameFileToken(doctorName)}${executionDocTypeCode(docType)}`;
}

function fileExtension(fileName = '') {
  const ext = path.extname(String(fileName || '')).toLowerCase();
  if (!ext || ext === '.') return '';
  return ext.replace(/[^\w.]+/g, '');
}

/**
 * Strip legacy camp-date (DDMMYYYY) glued after DF|PF|GS|OT for display only.
 * e.g. ADIPF10102026.webp → ADIPF.webp ; 26-10-0001__ADIPF10102026.webp → 26-10-0001__ADIPF.webp
 */
export function stripLegacyCampDateFromExecutionName(name = '') {
  const raw = String(name || '').trim();
  if (!raw) return '';
  const ext = path.extname(raw);
  const stem = ext ? raw.slice(0, -ext.length) : raw;
  const cleaned = stem.replace(new RegExp(`(${DOC_CODE_PATTERN})(\\d{8})$`, 'i'), '$1');
  return `${cleaned}${ext}`;
}

/**
 * Human-facing name for UI / downloads. Prefers logical fileName; never invents dates.
 */
export function executionDocumentDisplayName(doc = {}) {
  const preferred = String(doc?.fileName || '').trim();
  if (preferred) return stripLegacyCampDateFromExecutionName(preferred);
  const stored = String(doc?.storedName || '').trim();
  if (stored) {
    const cleaned = stripLegacyCampDateFromExecutionName(stored);
    const logical = cleaned.includes('__') ? cleaned.split('__').pop() : cleaned;
    return logical || cleaned;
  }
  return String(doc?.originalFileName || 'file').trim() || 'file';
}

/**
 * Unique stored/display file name for an upload.
 * Collisions get -2, -3, … before the extension.
 * Optional campScope keeps disk names unique across camps (e.g. 26-10-0001__ADIPF.webp).
 */
export function buildExecutionDocumentFileName({
  doctorName = '',
  docType = '',
  originalName = '',
  existingNames = [],
  index = 0,
  campScope = '',
} = {}) {
  const base = buildExecutionDocumentBaseName({ doctorName, docType });
  const ext = fileExtension(originalName);
  const scope = String(campScope || '')
    .replace(/[^\w.-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40);
  const taken = new Set(
    (existingNames || [])
      .map((name) => String(name || '').trim().toLowerCase())
      .filter(Boolean),
  );

  let attempt = Math.max(0, Number(index) || 0);
  while (attempt < 1000) {
    const suffix = attempt === 0 ? '' : `-${attempt + 1}`;
    const logical = `${base}${suffix}${ext}`;
    const candidate = scope ? `${scope}__${logical}` : logical;
    if (!taken.has(candidate.toLowerCase()) && !taken.has(logical.toLowerCase())) {
      return { fileName: logical, storedName: candidate };
    }
    attempt += 1;
  }

  const fallbackLogical = `${base}-${Date.now()}${ext}`;
  return {
    fileName: fallbackLogical,
    storedName: scope ? `${scope}__${fallbackLogical}` : fallbackLogical,
  };
}

/**
 * Stub metadata for QA/e2e scripts (same nomenclature as real uploads).
 * Does not write files — only shapes `executionDocuments[]` payloads.
 */
export function buildStubExecutionDocuments(camp = {}, opts = {}) {
  const types = Array.isArray(opts.types) && opts.types.length
    ? opts.types
    : ['doctor_form', 'patient_form'];
  const ext = fileExtension(opts.ext || '.pdf') || '.pdf';
  const doctorName = camp.doctorName || 'Doctor';
  const campScope = camp.campId || camp._id || '';
  const used = [];
  const urlBase = String(opts.urlBase || 'https://example.local').replace(/\/$/, '');

  return types.map((docType) => {
    const { fileName, storedName } = buildExecutionDocumentFileName({
      doctorName,
      docType,
      originalName: `stub${ext}`,
      existingNames: used,
      campScope,
    });
    used.push(fileName, storedName);
    return {
      id: storedName,
      fileName,
      storedName,
      docType,
      url: `${urlBase}/${storedName}`,
    };
  });
}

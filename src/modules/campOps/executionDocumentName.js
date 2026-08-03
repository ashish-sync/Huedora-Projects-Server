import path from 'path';
import { stripDoctorNamePrefix } from '../../utils/textFormat.js';

export const EXECUTION_DOC_TYPE_CODES = {
  doctor_form: 'DF',
  patient_form: 'PF',
  gps_selfie: 'GS',
  other: 'OT',
};

/** Doctor token for file names: "Dr. Karan" / "Karan Sharma" → KARAN / KARANSHARMA */
export function doctorNameFileToken(doctorName = '') {
  const stripped = stripDoctorNamePrefix(doctorName);
  const token = String(stripped || doctorName || '')
    .replace(/[^a-zA-Z0-9]+/g, '')
    .toUpperCase();
  return token || 'DOCTOR';
}

/** Camp date YYYY-MM-DD → DDMMYYYY (e.g. 2026-08-03 → 03082026) */
export function campDateFileToken(campDate = '') {
  const raw = String(campDate || '').trim();
  const iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[3]}${iso[2]}${iso[1]}`;

  const dmy = raw.match(/^(\d{2})[/-](\d{2})[/-](\d{4})$/);
  if (dmy) return `${dmy[1]}${dmy[2]}${dmy[3]}`;

  const parsed = Date.parse(raw);
  if (!Number.isNaN(parsed)) {
    const d = new Date(parsed);
    const dd = String(d.getDate()).padStart(2, '0');
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const yyyy = String(d.getFullYear());
    return `${dd}${mm}${yyyy}`;
  }

  return '00000000';
}

export function executionDocTypeCode(docType = '') {
  const key = String(docType || '').trim().toLowerCase();
  return EXECUTION_DOC_TYPE_CODES[key] || 'DOC';
}

/**
 * Base name without extension: Doctor + DocCode + CampDate
 * e.g. KARANDF03082026
 */
export function buildExecutionDocumentBaseName({
  doctorName = '',
  campDate = '',
  docType = '',
} = {}) {
  return `${doctorNameFileToken(doctorName)}${executionDocTypeCode(docType)}${campDateFileToken(campDate)}`;
}

function fileExtension(fileName = '') {
  const ext = path.extname(String(fileName || '')).toLowerCase();
  if (!ext || ext === '.') return '';
  return ext.replace(/[^\w.]+/g, '');
}

/**
 * Unique stored/display file name for an upload.
 * Collisions get -2, -3, … before the extension.
 * Optional campScope keeps disk names unique across camps with the same doctor/date.
 */
export function buildExecutionDocumentFileName({
  doctorName = '',
  campDate = '',
  docType = '',
  originalName = '',
  existingNames = [],
  index = 0,
  campScope = '',
} = {}) {
  const base = buildExecutionDocumentBaseName({ doctorName, campDate, docType });
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

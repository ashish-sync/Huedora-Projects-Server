import { trimStr } from '../campOps.helpers.js';

const MERGE_FIELDS = [
  'campDate',
  'startTime',
  'endTime',
  'expectedPatients',
  'doctorName',
  'doctorCode',
  'speciality',
  'campAddress',
  'city',
  'state',
  'pincode',
  'hq',
  'district',
  'zone',
  'fieldPersonName',
  'fieldPersonPhone',
];

function isBlank(value) {
  if (value == null) return true;
  if (typeof value === 'number') return Number.isNaN(value);
  return !trimStr(value);
}

/**
 * Merge deterministic camp row with AI-derived row.
 * Deterministic wins when both present and disagree → conflict.
 * AI only fills blanks. Never invents endTime when deterministic had none and AI guessed without evidence.
 */
export function mergeDeterministicAndAiRows(deterministicRow = {}, aiRow = {}, options = {}) {
  const allowAiEndTime = options.allowAiEndTime === true;
  const merged = { ...deterministicRow };
  const fieldProvenance = {};
  const conflicts = [];
  const filledByAi = [];

  for (const field of MERGE_FIELDS) {
    const det = deterministicRow[field];
    const ai = aiRow[field];
    const detBlank = isBlank(det);
    const aiBlank = isBlank(ai);

    if (field === 'endTime' && detBlank && !aiBlank && !allowAiEndTime) {
      // Only accept AI endTime when source explicitly had a range (caller sets flag)
      // or deterministic already had start and AI range was explicit in normalize.
      if (!options.aiHadExplicitEnd) {
        fieldProvenance[field] = 'skipped_ai_end_time';
        continue;
      }
    }

    if (!detBlank && !aiBlank) {
      const left = String(det).trim().toLowerCase();
      const right = String(ai).trim().toLowerCase();
      if (left !== right) {
        conflicts.push(`${field}: deterministic="${det}" vs ai="${ai}"`);
        fieldProvenance[field] = 'explicit';
        continue;
      }
      fieldProvenance[field] = 'explicit';
      continue;
    }

    if (detBlank && !aiBlank) {
      merged[field] = ai;
      filledByAi.push(field);
      fieldProvenance[field] = aiRow._dateProvenance && field === 'campDate'
        ? aiRow._dateProvenance
        : 'inferred';
      continue;
    }

    if (!detBlank) fieldProvenance[field] = 'explicit';
  }

  if (!trimStr(merged.campAddress) && trimStr(aiRow.rawAddress)) {
    merged.campAddress = aiRow.rawAddress;
    filledByAi.push('campAddress');
    fieldProvenance.campAddress = 'inferred';
  }

  if (Array.isArray(aiRow.people) && aiRow.people.length) {
    merged.people = aiRow.people;
  }

  return { row: merged, fieldProvenance, conflicts, filledByAi };
}

export function scoreExtractionConfidence({
  deterministicValid = false,
  filledByAi = [],
  conflicts = [],
  validation = {},
  usedLlm = false,
} = {}) {
  let score = deterministicValid ? 0.9 : 0.45;
  if (usedLlm) score = Math.min(score, 0.75);
  score -= Math.min(0.3, (filledByAi.length || 0) * 0.04);
  score -= Math.min(0.4, (conflicts.length || 0) * 0.1);
  score -= Math.min(0.3, (validation.codes?.length || 0) * 0.05);
  if (validation.status === 'READY' && !usedLlm) score = Math.max(score, 0.92);
  if (validation.status === 'CONFLICT' || validation.status === 'INVALID') score = Math.min(score, 0.35);
  return Math.max(0, Math.min(1, Number(score.toFixed(2))));
}

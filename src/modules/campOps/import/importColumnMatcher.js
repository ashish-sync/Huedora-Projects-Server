import {
  CAMP_PASTE_TABULAR_FIELD_KEYS,
  compactFieldName,
  getImportFieldDefinitions,
  preprocessFieldName,
} from './pasteFieldRegistry.js';

const MIN_CONFIDENCE = 55;
const SHORT_COMPACT_MAX_LEN = 3;

const CONFIDENCE = {
  COMPACT_EXACT: 100,
  NORMALIZED_EXACT: 95,
  COMPACT_CONTAINS: 82,
  TOKEN_FULL: 72,
  TOKEN_PARTIAL: 62,
};

function tokenizeHeader(value) {
  return preprocessFieldName(value).split(' ').filter(Boolean);
}

function buildCompactCandidates(fieldDef) {
  const values = [fieldDef.label, fieldDef.key, ...(fieldDef.aliases || [])];
  return [...new Set(values.map(compactFieldName).filter(Boolean))];
}

function buildNormalizedCandidates(fieldDef) {
  const values = [fieldDef.label, fieldDef.key, ...(fieldDef.aliases || [])];
  return [...new Set(values.map(preprocessFieldName).filter(Boolean))];
}

function scoreHeaderToField(header, fieldDef) {
  const compact = compactFieldName(header);
  const normalized = preprocessFieldName(header);
  if (!compact) return 0;

  const compactCandidates = buildCompactCandidates(fieldDef);
  const normalizedCandidates = buildNormalizedCandidates(fieldDef);

  if (compactCandidates.includes(compact)) return CONFIDENCE.COMPACT_EXACT;
  if (normalizedCandidates.includes(normalized)) return CONFIDENCE.NORMALIZED_EXACT;

  let best = 0;
  for (const candidate of compactCandidates) {
    if (!candidate || candidate.length <= SHORT_COMPACT_MAX_LEN) continue;
    if (compact.includes(candidate) || candidate.includes(compact)) {
      best = Math.max(best, CONFIDENCE.COMPACT_CONTAINS);
    }
  }

  const headerTokens = tokenizeHeader(header);
  for (const alias of normalizedCandidates) {
    const aliasTokens = tokenizeHeader(alias);
    if (!aliasTokens.length) continue;
    const overlap = aliasTokens.filter((token) => headerTokens.includes(token)).length;
    if (!overlap) continue;
    if (overlap === aliasTokens.length && overlap === headerTokens.length) {
      best = Math.max(best, CONFIDENCE.TOKEN_FULL);
    } else if (overlap === aliasTokens.length) {
      best = Math.max(best, CONFIDENCE.TOKEN_PARTIAL + overlap);
    }
  }

  return best;
}

function confidenceLabel(score) {
  if (score >= CONFIDENCE.NORMALIZED_EXACT) return 'high';
  if (score >= CONFIDENCE.COMPACT_CONTAINS) return 'medium';
  if (score >= MIN_CONFIDENCE) return 'low';
  return 'none';
}

/**
 * Match spreadsheet headers to canonical import fields using compact preprocessing.
 * Unmatched headers are returned as status "unmapped".
 */
export function matchImportColumns(headers = [], fieldKeys = null) {
  const cleanHeaders = (headers || [])
    .map((header) => String(header || '').trim())
    .filter(Boolean);
  const fields = getImportFieldDefinitions(fieldKeys);

  const pairs = [];
  cleanHeaders.forEach((header) => {
    fields.forEach((field) => {
      const score = scoreHeaderToField(header, field);
      if (score >= MIN_CONFIDENCE) {
        pairs.push({
          header,
          fieldKey: field.key,
          fieldLabel: field.label,
          score,
          confidence: confidenceLabel(score),
          compactHeader: compactFieldName(header),
        });
      }
    });
  });

  pairs.sort((a, b) => b.score - a.score);

  const mapping = {};
  const assignedHeaders = new Set();
  const assignedFields = new Set();

  for (const pair of pairs) {
    if (assignedHeaders.has(pair.header) || assignedFields.has(pair.fieldKey)) continue;
    assignedHeaders.add(pair.header);
    assignedFields.add(pair.fieldKey);
    mapping[pair.fieldKey] = pair.header;
  }

  const headerToField = new Map(Object.entries(mapping).map(([fieldKey, header]) => [header, fieldKey]));

  const columnResults = cleanHeaders.map((header) => {
    const fieldKey = headerToField.get(header) || null;
    const field = fieldKey ? fields.find((item) => item.key === fieldKey) : null;
    const topPair = pairs.find((pair) => pair.header === header && pair.fieldKey === fieldKey);

    return {
      header,
      compactHeader: compactFieldName(header),
      fieldKey,
      fieldLabel: field?.label || null,
      status: fieldKey ? 'mapped' : 'unmapped',
      confidence: topPair?.confidence || null,
      score: topPair?.score || null,
    };
  });

  const unmappedHeaders = columnResults
    .filter((item) => item.status === 'unmapped')
    .map((item) => item.header);

  const unmappedFields = fields
    .filter((field) => !mapping[field.key])
    .map((field) => ({
      key: field.key,
      label: field.label,
      required: Boolean(field.required),
    }));

  const missingRequiredFields = unmappedFields
    .filter((field) => field.required)
    .map((field) => field.label);

  return {
    mapping,
    suggestions: { ...mapping },
    columnResults,
    unmappedHeaders,
    unmappedFields,
    missingRequiredFields,
    fields,
  };
}

export { CAMP_PASTE_TABULAR_FIELD_KEYS, getImportFieldDefinitions };

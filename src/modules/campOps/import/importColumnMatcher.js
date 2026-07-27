import aliasConfig from './campImportFieldAliases.json' with { type: 'json' };

const MIN_CONFIDENCE = 55;
const SHORT_ALIAS_MAX_LEN = 3;

const CONFIDENCE = {
  EXACT: 100,
  COMPACT_EXACT: 95,
  ALIAS_EXACT: 92,
  ALIAS_CONTAINS: 78,
  TOKEN_FULL: 70,
  TOKEN_PARTIAL: 60,
};

export const CAMP_PASTE_TABULAR_FIELD_KEYS = aliasConfig.pasteTabularFields || [];

/**
 * Normalize a spreadsheet header for comparison: lowercase, strip punctuation, collapse spaces.
 */
export function normalizeImportHeader(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[._\-/\\]+/g, ' ')
    .replace(/[,#!?()[\]{}:;'"`]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function compactImportHeader(value) {
  return normalizeImportHeader(value).replace(/\s+/g, '');
}

function tokenizeHeader(value) {
  return normalizeImportHeader(value).split(' ').filter(Boolean);
}

function buildFieldCandidates(fieldKey, fieldDef) {
  const values = [fieldDef.label, fieldKey, ...(fieldDef.aliases || [])];
  return [...new Set(values.map(normalizeImportHeader).filter(Boolean))];
}

function scoreHeaderToField(header, fieldKey, fieldDef) {
  const normalized = normalizeImportHeader(header);
  const compact = compactImportHeader(header);
  if (!normalized) return 0;

  const candidates = buildFieldCandidates(fieldKey, fieldDef);
  const compactCandidates = candidates.map(compactImportHeader);

  if (candidates.includes(normalized)) return CONFIDENCE.EXACT;
  if (compactCandidates.includes(compact)) return CONFIDENCE.COMPACT_EXACT;

  let best = 0;
  for (const alias of candidates) {
    if (!alias) continue;
    if (normalized === alias) {
      best = Math.max(best, CONFIDENCE.ALIAS_EXACT);
      continue;
    }

    const aliasCompact = compactImportHeader(alias);
    if (compact === aliasCompact) {
      best = Math.max(best, CONFIDENCE.COMPACT_EXACT);
      continue;
    }

    const shorter = alias.length <= normalized.length ? alias : normalized;
    const longer = alias.length <= normalized.length ? normalized : alias;
    if (shorter.length <= SHORT_ALIAS_MAX_LEN) continue;

    if (longer.includes(shorter) || shorter.includes(longer)) {
      best = Math.max(best, CONFIDENCE.ALIAS_CONTAINS);
    }
  }

  const headerTokens = tokenizeHeader(header);
  for (const alias of candidates) {
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
  if (score >= CONFIDENCE.ALIAS_EXACT) return 'high';
  if (score >= CONFIDENCE.ALIAS_CONTAINS) return 'medium';
  if (score >= MIN_CONFIDENCE) return 'low';
  return 'none';
}

export function getImportFieldDefinitions(fieldKeys = null) {
  const keys = fieldKeys?.length
    ? fieldKeys
    : Object.keys(aliasConfig.fields || {});

  return keys
    .filter((key) => aliasConfig.fields[key])
    .map((key) => ({
      key,
      ...aliasConfig.fields[key],
    }));
}

/**
 * Match spreadsheet headers to canonical import fields.
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
      const score = scoreHeaderToField(header, field.key, field);
      if (score >= MIN_CONFIDENCE) {
        pairs.push({
          header,
          fieldKey: field.key,
          fieldLabel: field.label,
          score,
          confidence: confidenceLabel(score),
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

export function getAliasConfig() {
  return aliasConfig;
}

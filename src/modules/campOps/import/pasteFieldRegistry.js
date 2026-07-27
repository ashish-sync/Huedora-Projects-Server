import manualPasteConfig from './manualPasteFieldConfig.json' with { type: 'json' };
import { getPasteTabularFieldKeys } from './campRequestFieldSchema.js';

const NULL_VALUES = new Set(['', '-', 'na', 'n/a', 'nil', 'none', 'null']);

/**
 * Preprocess a field name for matching: lowercase, trim, strip symbols, collapse spaces.
 * Example: "Doctor Name*" -> "doctor name" ; compact -> "doctorname"
 */
export function preprocessFieldName(value) {
  let text = String(value ?? '');
  if (manualPasteConfig.trim_whitespace !== false) text = text.trim();
  if (manualPasteConfig.ignore_case !== false) text = text.toLowerCase();

  const symbols = manualPasteConfig.remove_symbols || [];
  for (const symbol of symbols) {
    if (!symbol) continue;
    text = text.split(symbol).join(' ');
  }

  if (manualPasteConfig.ignore_special_characters !== false) {
    text = text.replace(/[^a-z0-9\s]/gi, ' ');
  }

  return text.replace(/\s+/g, ' ').trim();
}

/** Compact form used for fuzzy header matching: "Doctor Name" -> "doctorname" */
export function compactFieldName(value) {
  return preprocessFieldName(value).replace(/\s+/g, '');
}

export function isNullValue(value) {
  const normalized = preprocessFieldName(value);
  return NULL_VALUES.has(normalized);
}

export function normalizePastePhone(value) {
  const digits = String(value || '').replace(/\D/g, '');
  return digits || '';
}

export function getManualPasteConfig() {
  return manualPasteConfig;
}

function titleCaseLabel(value) {
  return String(value || '')
    .split(' ')
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function buildCanonicalDefinitions() {
  const canonicalFields = manualPasteConfig.canonical_fields || {};
  const mapping = manualPasteConfig.canonical_to_internal || {};
  const fieldLabels = manualPasteConfig.field_labels || {};
  const fieldRequired = manualPasteConfig.field_required || {};
  const definitions = new Map();

  Object.entries(canonicalFields).forEach(([canonicalKey, aliases]) => {
    const internalKey = mapping[canonicalKey];
    if (!internalKey) return;

    const existing = definitions.get(internalKey) || {
      key: internalKey,
      label: fieldLabels[internalKey] || titleCaseLabel(canonicalKey.replace(/_/g, ' ')),
      required: Boolean(fieldRequired[internalKey]),
      aliases: [],
      canonicalKeys: [],
    };

    existing.aliases.push(...aliases);
    existing.canonicalKeys.push(canonicalKey);
    definitions.set(internalKey, existing);
  });

  Object.entries(manualPasteConfig.importOnlyFields || {}).forEach(([key, def]) => {
    definitions.set(key, {
      key,
      label: def.label || fieldLabels[key] || key,
      required: Boolean(def.required),
      aliases: [...(def.aliases || [])],
      canonicalKeys: [],
    });
  });

  for (const def of definitions.values()) {
    def.aliases = [...new Set(
      [def.label, def.key, ...def.aliases]
        .map((item) => preprocessFieldName(item))
        .filter(Boolean),
    )];
  }

  return [...definitions.values()];
}

let cachedDefinitions = null;

export function getImportFieldDefinitions(fieldKeys = null) {
  if (!cachedDefinitions) cachedDefinitions = buildCanonicalDefinitions();

  if (!fieldKeys?.length) return cachedDefinitions;

  const allowed = new Set(fieldKeys);
  return cachedDefinitions.filter((field) => allowed.has(field.key));
}

export const CAMP_PASTE_TABULAR_FIELD_KEYS = getPasteTabularFieldKeys();

export function getTextPasteLabels(internalKey) {
  const field = getImportFieldDefinitions().find((item) => item.key === internalKey);
  if (!field) return [];

  const labels = new Set();
  (manualPasteConfig.canonical_fields || {});
  Object.entries(manualPasteConfig.canonical_fields || {}).forEach(([canonicalKey, aliases]) => {
    if (manualPasteConfig.canonical_to_internal?.[canonicalKey] !== internalKey) return;
    aliases.forEach((alias) => labels.add(alias));
  });

  field.aliases.forEach((alias) => labels.add(alias));
  if (field.label) labels.add(field.label);

  return [...labels]
    .map((label) => titleCaseLabel(label))
    .sort((a, b) => b.length - a.length);
}

export function getDesignationContactPairs() {
  const mapping = manualPasteConfig.designation_mapping || {};
  const fieldPersonCodes = Object.entries(mapping)
    .filter(([, role]) => role === 'Field Person')
    .map(([code]) => code);
  const managerCodes = Object.entries(mapping)
    .filter(([, role]) => role === 'Reporting Manager')
    .map(([code]) => code);

  const pairs = [];

  fieldPersonCodes.forEach((code) => {
    pairs.push({
      name: [`${code} Name`, `${code} name`, code],
      phone: [`${code} Mobile`, `${code} Contact`, `${code} Contact No`, `${code} Phone`],
      role: 'field',
    });
  });

  managerCodes.forEach((code) => {
    pairs.push({
      name: [`${code} Name`, `${code} name`, code],
      phone: [`${code} Mobile`, `${code} Contact`, `${code} Contact No`, `${code} Phone`],
      role: 'manager',
    });
  });

  pairs.push({
    name: getTextPasteLabels('fieldPersonName'),
    phone: getTextPasteLabels('fieldPersonPhone'),
    role: 'field',
  });

  return pairs;
}

export function labelsMatchCompact(label, candidate) {
  return compactFieldName(label) === compactFieldName(candidate);
}

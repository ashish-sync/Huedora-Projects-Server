import { CONTACT_PERSON_LEVELS } from './campOps.constants.js';
import { formatContactPersonName } from '../../utils/textFormat.js';

export const DEFAULT_CONTACT_PERSON_LEVEL = 'Territory Manager';

/** Excel / import columns for each contact level (name + number). */
export const CONTACT_LEVEL_IMPORT_FIELDS = [
  { level: 'Territory Manager', code: 'TM', nameKey: 'tmName', phoneKey: 'tmPhone' },
  { level: 'Area Manager', code: 'AM', nameKey: 'amName', phoneKey: 'amPhone' },
  { level: 'Regional Manager', code: 'RM', nameKey: 'rmName', phoneKey: 'rmPhone' },
  { level: 'Zonal Manager', code: 'ZM', nameKey: 'zmName', phoneKey: 'zmPhone' },
  { level: 'Product Manager', code: 'PM', nameKey: 'pmName', phoneKey: 'pmPhone' },
];

const LEGACY_CONTACT_PERSON_LEVEL_ALIASES = {
  'TBM/MR': 'Territory Manager',
  TBM: 'Territory Manager',
  TM: 'Territory Manager',
  MR: 'Territory Manager',
  ABM: 'Area Manager',
  AM: 'Area Manager',
  RBM: 'Regional Manager',
  RM: 'Regional Manager',
  ZBM: 'Zonal Manager',
  ZM: 'Zonal Manager',
  PM: 'Product Manager',
};

function trimStr(v) {
  return v == null ? '' : String(v).trim();
}

function formatName(value) {
  return formatContactPersonName(trimStr(value));
}

export function normalizeContactPersonLevel(level) {
  const trimmed = trimStr(level);
  if (!trimmed) return DEFAULT_CONTACT_PERSON_LEVEL;
  if (CONTACT_PERSON_LEVELS.includes(trimmed)) return trimmed;
  return LEGACY_CONTACT_PERSON_LEVEL_ALIASES[trimmed]
    || LEGACY_CONTACT_PERSON_LEVEL_ALIASES[trimmed.toUpperCase()]
    || DEFAULT_CONTACT_PERSON_LEVEL;
}

function emptyContactPerson(level = DEFAULT_CONTACT_PERSON_LEVEL) {
  return {
    level: normalizeContactPersonLevel(level),
    name: '',
    phone: '',
  };
}

/**
 * Build contactPersons[] from per-level import columns and/or legacy
 * Contact Person Level / Name / Number columns. At least one complete
 * contact is enforced by request-stage validation, not here.
 */
export function buildContactPersonsFromImportRow(source = {}) {
  const fromLevels = [];
  const seenLevels = new Set();

  for (const def of CONTACT_LEVEL_IMPORT_FIELDS) {
    const name = formatName(source[def.nameKey]);
    const phone = trimStr(source[def.phoneKey]);
    if (!name && !phone) continue;
    fromLevels.push({ level: def.level, name, phone });
    seenLevels.add(def.level);
  }

  const legacyName = formatName(source.fieldPersonName);
  const legacyPhone = trimStr(source.fieldPersonPhone);
  const legacyLevelRaw = trimStr(source.contactPersonLevel);
  if (legacyName || legacyPhone) {
    const legacyLevel = normalizeContactPersonLevel(
      legacyLevelRaw || DEFAULT_CONTACT_PERSON_LEVEL,
    );
    if (!seenLevels.has(legacyLevel)) {
      // Legacy single-contact columns stay primary when that level wasn't filled via TM/AM/… columns.
      fromLevels.unshift({ level: legacyLevel, name: legacyName, phone: legacyPhone });
    }
  }

  return fromLevels.length ? fromLevels : [emptyContactPerson()];
}

export function normalizeContactPersons(source = {}) {
  const list = Array.isArray(source.contactPersons) ? source.contactPersons : [];
  if (list.length) {
    return list.map((item) => ({
      level: normalizeContactPersonLevel(item?.level ?? item?.contactPersonLevel),
      name: formatName(item?.name ?? item?.fieldPersonName),
      phone: trimStr(item?.phone ?? item?.fieldPersonPhone),
    }));
  }

  return buildContactPersonsFromImportRow(source);
}

export function resolveContactPersonFields(body = {}, existing = null) {
  const merged = {
    ...(existing && typeof existing === 'object' ? existing : {}),
    ...(body && typeof body === 'object' ? body : {}),
    contactPersons: body.contactPersons ?? existing?.contactPersons,
    contactPersonLevel: body.contactPersonLevel ?? existing?.contactPersonLevel,
    fieldPersonName: body.fieldPersonName ?? existing?.fieldPersonName,
    fieldPersonPhone: body.fieldPersonPhone ?? existing?.fieldPersonPhone,
  };
  for (const def of CONTACT_LEVEL_IMPORT_FIELDS) {
    if (merged[def.nameKey] == null || merged[def.nameKey] === '') {
      merged[def.nameKey] = existing?.[def.nameKey];
    }
    if (merged[def.phoneKey] == null || merged[def.phoneKey] === '') {
      merged[def.phoneKey] = existing?.[def.phoneKey];
    }
  }
  const contactPersons = normalizeContactPersons(merged);
  const primary = contactPersons[0] || emptyContactPerson();
  return {
    contactPersons,
    contactPersonLevel: primary.level,
    fieldPersonName: primary.name,
    fieldPersonPhone: primary.phone,
  };
}

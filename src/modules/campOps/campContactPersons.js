import { CONTACT_PERSON_LEVELS } from './campOps.constants.js';

export const DEFAULT_CONTACT_PERSON_LEVEL = 'Territory Manager';

const LEGACY_CONTACT_PERSON_LEVEL_ALIASES = {
  'TBM/MR': 'Territory Manager',
  TBM: 'Territory Manager',
  MR: 'Territory Manager',
  ABM: 'Area Manager',
  RBM: 'Regional Manager',
  ZBM: 'Zonal Manager',
  PM: 'Product Manager',
};

function trimStr(v) {
  return v == null ? '' : String(v).trim();
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

export function normalizeContactPersons(source = {}) {
  const list = Array.isArray(source.contactPersons) ? source.contactPersons : [];
  if (list.length) {
    return list.map((item) => ({
      level: normalizeContactPersonLevel(item?.level ?? item?.contactPersonLevel),
      name: trimStr(item?.name ?? item?.fieldPersonName),
      phone: trimStr(item?.phone ?? item?.fieldPersonPhone),
    }));
  }

  const legacy = emptyContactPerson(trimStr(source.contactPersonLevel) || DEFAULT_CONTACT_PERSON_LEVEL);
  legacy.name = trimStr(source.fieldPersonName);
  legacy.phone = trimStr(source.fieldPersonPhone);

  if (legacy.name || legacy.phone) {
    return [legacy];
  }

  return [emptyContactPerson()];
}

export function resolveContactPersonFields(body = {}, existing = null) {
  const merged = {
    contactPersons: body.contactPersons ?? existing?.contactPersons,
    contactPersonLevel: body.contactPersonLevel ?? existing?.contactPersonLevel,
    fieldPersonName: body.fieldPersonName ?? existing?.fieldPersonName,
    fieldPersonPhone: body.fieldPersonPhone ?? existing?.fieldPersonPhone,
  };
  const contactPersons = normalizeContactPersons(merged);
  const primary = contactPersons[0] || emptyContactPerson();
  return {
    contactPersons,
    contactPersonLevel: primary.level,
    fieldPersonName: primary.name,
    fieldPersonPhone: primary.phone,
  };
}

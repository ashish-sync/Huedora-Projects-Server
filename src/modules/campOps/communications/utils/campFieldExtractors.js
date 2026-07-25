export const JUNK_FIELD_VALUES = new Set([
  'name', 'na', 'n/a', 'tbd', 'tba', '-', 'nil', 'none', 'pending', 'as above',
  'same', 'nill', 'not available', 'unknown', 'morning', 'afternoon', 'evening',
]);

export const FIELD_LABEL_ALIASES = {
  clientName: ['client', 'brand', 'company', 'pharma', 'organisation', 'organization'],
  campaignName: ['camp type', 'campaign type', 'type', 'test type', 'screening type', 'bmd'],
  campaignType: ['campaign', 'campaign name', 'division', 'business unit', 'program', 'programme', 'process'],
  doctorName: [
    'doctor name', 'doctors name', 'doctor', 'dr name', 'drname', 'dr', 'physician',
    'dr name', 'hcp name',
  ],
  doctorCode: [
    'doctor code', 'doctors code', 'dr code', 'doctor id', 'doctors code',
  ],
  scCode: [
    'sc code', 'dr sc code', 'sales code', 'sc code no', 'emp code',
    'se/kam employee id', 'se employee id',
  ],
  mslNo: ['msl no', 'msl number', 'msl'],
  speciality: ['speciality', 'specialty', 'specialization'],
  hospitalName: ['hospital name', 'hospital', 'hospital/clinic', 'clinic/hospital', 'clinic name', 'clinic'],
  campAddress: [
    'camp address', 'address', 'full clinic address', 'hospital/clinic address',
    'hospital clinic address', 'camp venue', 'complete adress', 'complete address',
    'location', 'venue', 'address*',
  ],
  city: [
    'camp city', 'city', 'town', 'name of city', 'hq', 'region',
    'station/ patch name', 'station patch name', 'patch name', 'station',
  ],
  state: ['camp state', 'state', 'province'],
  pincode: ['pin code', 'pincode', 'pin', 'zip', 'zip code', 'postal code'],
  campDate: [
    'date of the camp', 'camp date', 'date', 'dates', "date's", 'event date',
    'schedule date', 'proposed date',
  ],
  startTime: ['start time', 'in time', 'from time', 'time from', 'camp time'],
  endTime: ['end time', 'out time', 'to time', 'time to'],
  expectedPatients: [
    'expected patients', 'expected patient', 'patients', 'footfall', 'expected footfall',
  ],
  fieldPersonName: [
    'field person name', 'field person', 'field rep', 'mr name', 'se name',
    'se/kam name', 'bo name', 'representative', 'mr', 'flm name', 'rsm name',
    'client name',
  ],
  fieldPersonContact: [
    'field person contact no', 'se mobile', 'se mobile no', 'bo contact no',
    'client number', 'client no', 'mob number', 'mobile no', 'mr mobile',
    'se/kam contact no', 'flm mob no', 'rsm mobile', 'technician contact',
  ],
  fieldPersonPhone: [
    'field phone', 'field person phone', 'field person contact', 'field person contact no',
    'se mobile', 'se mobile no', 'bo contact no', 'mob number', 'mobile no', 'mr mobile',
    'se/kam contact no', 'flm mob no', 'rsm mobile', 'technician contact',
  ],
  remarks: ['remarks', 'notes', 'comment', 'comments', 'additional info', 'timing'],
};

const aliasLookup = new Map();
Object.entries(FIELD_LABEL_ALIASES).forEach(([field, aliases]) => {
  aliases.forEach((alias) => {
    const normalized = normalizeFieldKey(alias);
    if (!aliasLookup.has(normalized) || normalized.length > aliasLookup.get(normalized).alias.length) {
      aliasLookup.set(normalized, { field, alias });
    }
  });
});

export const sortedAliases = [...aliasLookup.entries()].sort((a, b) => b[0].length - a[0].length);

export function normalizeFieldKey(rawKey) {
  return String(rawKey || '')
    .trim()
    .toLowerCase()
    .replace(/^\-\s*/, '')
    .replace(/\*/g, '')
    .replace(/\./g, '')
    .replace(/['’]/g, '')
    .replace(/[_/]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function cleanFieldValue(value) {
  return String(value || '')
    .replace(/\r/g, '')
    .split('\n')[0]
    .replace(/^[<\[\(]+|[>\]\)]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function isJunkFieldValue(value, field = '') {
  const cleaned = cleanFieldValue(value);
  if (!cleaned || cleaned.length < 2) return true;
  if (JUNK_FIELD_VALUES.has(cleaned.toLowerCase())) return true;
  if (field === 'doctorName' && /^(dr|doctor|name)$/i.test(cleaned)) return true;
  if (field === 'city' && /^(request|campaign|camp|hq)$/i.test(cleaned)) return true;
  return false;
}

export function sanitizeFieldValue(value, field) {
  const cleaned = cleanFieldValue(value);
  if (isJunkFieldValue(cleaned, field)) return '';
  return cleaned;
}

export function resolveFieldKey(rawKey) {
  const normalized = normalizeFieldKey(rawKey);
  if (!normalized) return null;

  for (const [alias, { field }] of sortedAliases) {
    if (normalized === alias) return field;
  }

  return null;
}

export function parseLabelValueLine(line) {
  const trimmed = String(line || '').trim().replace(/^\-\s*/, '');
  if (!trimmed) return null;

  const match = /^(.+?)\s*[:=\-–—]+\s*(.*)$/.exec(trimmed);
  if (!match) return null;

  const field = resolveFieldKey(match[1]);
  if (!field) return null;

  return { field, value: match[2].trim() };
}

export function scoreCampTextSegment(text) {
  const segment = String(text || '').trim();
  if (!segment) return 0;

  let score = 0;
  segment.split(/\r?\n/).forEach((line) => {
    if (parseLabelValueLine(line)) score += 3;
  });

  if (/\b(client|doctor|dr name|camp date|date of the camp|bmd|camp type)\b/i.test(segment)) score += 2;
  if (/\d{1,2}[\/\-.]\d{1,2}[\/\-.]\d{2,4}/.test(segment)) score += 2;
  if (/from:\s*.+@/i.test(segment)) score -= 2;
  if (/unsubscribe|confidential|disclaimer|google form uploaded/i.test(segment)) score -= 2;

  return score;
}

/**
 * Reusable parser utilities — label normalization, value transforms,
 * key-value splitting, time/date parsing, contact resolution.
 */

import type {
  CampFieldKey,
  ClientParserConfig,
  ContactRoleConfig,
  ExtractedField,
  MatchMethod,
  RawLabelValue,
} from './types.js';
import {
  CAMP_FIELD_KEYS,
  GLOBAL_FIELD_ALIASES,
  MATCH_METHOD_CONFIDENCE,
} from './fieldMappings.js';

/* -------------------------------------------------------------------------- */
/* Label normalization                                                        */
/* -------------------------------------------------------------------------- */

/**
 * Normalize a label for alias matching.
 * "Expected Patient Count" → "expectedpatientcount"
 */
export function normalizeLabel(raw: string): string {
  return String(raw ?? '')
    .toLowerCase()
    .replace(/[\s_\-./:'’"*,()[\]{}]+/g, '')
    .trim();
}

/** Strip HTML tags and normalize line endings. */
export function sanitizeInputText(text: string): string {
  return String(text ?? '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\u00a0/g, ' ')
    .trim();
}

/* -------------------------------------------------------------------------- */
/* Alias lookup                                                               */
/* -------------------------------------------------------------------------- */

export interface AliasLookupEntry {
  field: CampFieldKey;
  alias: string;
  normalized: string;
  scope: 'client' | 'global';
}

/** Build sorted alias lookup (longest normalized alias first). */
export function buildAliasLookup(config: ClientParserConfig): AliasLookupEntry[] {
  const entries: AliasLookupEntry[] = [];

  const clientAliases = config.fieldAliases || {};
  for (const [field, aliases] of Object.entries(clientAliases)) {
    for (const alias of aliases || []) {
      entries.push({
        field: field as CampFieldKey,
        alias,
        normalized: normalizeLabel(alias),
        scope: 'client',
      });
    }
  }

  for (const field of CAMP_FIELD_KEYS) {
    for (const alias of GLOBAL_FIELD_ALIASES[field] || []) {
      const normalized = normalizeLabel(alias);
      const clientOverride = entries.some(
        (e) => e.field === field && e.normalized === normalized,
      );
      if (!clientOverride) {
        entries.push({ field, alias, normalized, scope: 'global' });
      }
    }
  }

  return entries.sort((a, b) => b.normalized.length - a.normalized.length);
}

export function resolveFieldFromLabel(
  label: string,
  lookup: AliasLookupEntry[],
): { field: CampFieldKey; method: MatchMethod; sourceLabel: string } | null {
  const normalized = normalizeLabel(label);
  if (!normalized) return null;

  for (const entry of lookup) {
    if (normalized === entry.normalized) {
      return {
        field: entry.field,
        method: entry.scope === 'client' ? 'client_alias' : 'global_alias',
        sourceLabel: entry.alias,
      };
    }
  }

  return null;
}

/* -------------------------------------------------------------------------- */
/* Key-Value extraction (Mode 1)                                              */
/* -------------------------------------------------------------------------- */

const KV_SEPARATORS = [':', '–', '-', '='];

/** Split a line on the first key-value separator. */
export function splitKeyValueLine(line: string): { label: string; value: string } | null {
  const trimmed = line.trim();
  if (!trimmed) return null;

  let bestIndex = -1;
  let bestSep = '';

  for (const sep of KV_SEPARATORS) {
    const idx = trimmed.indexOf(sep);
    if (idx > 0 && (bestIndex === -1 || idx < bestIndex)) {
      bestIndex = idx;
      bestSep = sep;
    }
  }

  if (bestIndex <= 0) return null;

  const label = trimmed.slice(0, bestIndex).trim();
  const value = trimmed.slice(bestIndex + bestSep.length).trim();
  if (!label) return null;

  return { label, value };
}

export function extractKeyValuePairs(
  text: string,
  ignorePatterns: RegExp[] = [],
): RawLabelValue[] {
  const lines = sanitizeInputText(text).split('\n');
  const pairs: RawLabelValue[] = [];

  lines.forEach((line, index) => {
    if (ignorePatterns.some((re) => re.test(line))) return;

    const kv = splitKeyValueLine(line);
    if (!kv) return;

    pairs.push({
      label: kv.label,
      normalizedLabel: normalizeLabel(kv.label),
      value: kv.value,
      line: index + 1,
    });
  });

  return pairs;
}

/* -------------------------------------------------------------------------- */
/* Value normalization                                                        */
/* -------------------------------------------------------------------------- */

const JUNK_VALUES = new Set([
  'na', 'n/a', 'nil', 'none', 'tbd', 'tba', '-', 'pending', 'not provided',
  'not available', 'unknown', 'same', 'as above',
]);

export function isJunkValue(value: string): boolean {
  const v = value.trim().toLowerCase();
  return !v || JUNK_VALUES.has(v);
}

/** Remove Dr/Doctor prefix and convert to Proper Case. */
export function normalizePersonName(value: string): string {
  let name = String(value ?? '').trim();
  name = name.replace(/^(?:dr\.?|doctor)\s+/i, '');
  name = name.replace(/\s+/g, ' ').trim();
  if (!name) return '';

  return name
    .split(/\s+/)
    .map((part) => {
      if (part.length <= 2 && /^[A-Z]+$/.test(part)) return part;
      return part.charAt(0).toUpperCase() + part.slice(1).toLowerCase();
    })
    .join(' ');
}

/** Normalize to 10-digit Indian mobile. */
export function normalizePhoneNumber(value: string): string {
  let digits = String(value ?? '').replace(/\D/g, '');
  if (digits.startsWith('91') && digits.length === 12) {
    digits = digits.slice(2);
  }
  if (digits.length === 10) return digits;
  if (digits.length > 10) return digits.slice(-10);
  return digits.length >= 10 ? digits : '';
}

const MONTH_MAP: Record<string, number> = {
  jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3,
  apr: 4, april: 4, may: 5, jun: 6, june: 6, jul: 7, july: 7,
  aug: 8, august: 8, sep: 9, sept: 9, september: 9,
  oct: 10, october: 10, nov: 11, november: 11, dec: 12, december: 12,
};

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

function toIsoDate(year: number, month: number, day: number): string {
  if (year < 100) year += year >= 50 ? 1900 : 2000;
  if (month < 1 || month > 12 || day < 1 || day > 31) return '';
  return `${year}-${pad2(month)}-${pad2(day)}`;
}

/** Parse flexible date formats → YYYY-MM-DD. Supports Today/Tomorrow. */
export function normalizeDate(value: string, referenceDate: Date = new Date()): string {
  const raw = String(value ?? '').trim();
  if (!raw || isJunkValue(raw)) return '';

  const lower = raw.toLowerCase();
  if (lower === 'today') {
    return toIsoDate(
      referenceDate.getFullYear(),
      referenceDate.getMonth() + 1,
      referenceDate.getDate(),
    );
  }
  if (lower === 'tomorrow') {
    const d = new Date(referenceDate);
    d.setDate(d.getDate() + 1);
    return toIsoDate(d.getFullYear(), d.getMonth() + 1, d.getDate());
  }

  const iso = raw.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (iso) return toIsoDate(Number(iso[1]), Number(iso[2]), Number(iso[3]));

  const dmy = raw.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})$/);
  if (dmy) return toIsoDate(Number(dmy[3]), Number(dmy[2]), Number(dmy[1]));

  const named = raw.match(
    /^(\d{1,2})[\s\-]+([A-Za-z]+)[\s\-]+(\d{2,4})$/,
  );
  if (named) {
    const month = MONTH_MAP[named[2].toLowerCase().slice(0, 3)];
    if (month) return toIsoDate(Number(named[3]), month, Number(named[1]));
  }

  const monthFirst = raw.match(/^([A-Za-z]+)\s+(\d{1,2})(?:,?\s+(\d{4}))?$/);
  if (monthFirst) {
    const month = MONTH_MAP[monthFirst[1].toLowerCase()];
    const year = monthFirst[3] ? Number(monthFirst[3]) : referenceDate.getFullYear();
    if (month) return toIsoDate(year, month, Number(monthFirst[2]));
  }

  const shortDayMonth = raw.match(/^(\d{1,2})\s+([A-Za-z]{3,})$/i);
  if (shortDayMonth) {
    const month = MONTH_MAP[shortDayMonth[2].toLowerCase().slice(0, 3)];
    if (month) return toIsoDate(referenceDate.getFullYear(), month, Number(shortDayMonth[1]));
  }

  return '';
}

/** Parse single time token → HH:mm (24h). */
export function normalizeTimeToken(token: string): string {
  const raw = String(token ?? '').trim().replace(/\./g, ':');
  if (!raw) return '';

  const match = raw.match(/^(\d{1,2})(?::(\d{2}))?\s*(AM|PM)?$/i);
  if (!match) return raw;

  let hours = Number(match[1]);
  const minutes = match[2] ? match[2] : '00';
  const meridiem = match[3]?.toUpperCase();

  if (meridiem === 'PM' && hours < 12) hours += 12;
  if (meridiem === 'AM' && hours === 12) hours = 0;

  return `${pad2(hours)}:${minutes}`;
}

export interface TimeRange {
  start: string;
  end: string;
}

/**
 * Parse time ranges: "11 AM to 3 PM", "11am-3pm", "11:00 AM to 3:00 PM".
 * Single time → start only.
 */
export function parseTimeRange(value: string): TimeRange {
  const raw = String(value ?? '').trim();
  if (!raw) return { start: '', end: '' };

  const rangeMatch = raw.match(
    /(\d{1,2}(?::\d{2})?(?:\s*(?:AM|PM))?)\s*(?:to|–|-)\s*(\d{1,2}(?::\d{2})?(?:\s*(?:AM|PM))?)/i,
  );
  if (rangeMatch) {
    return {
      start: normalizeTimeToken(rangeMatch[1]),
      end: normalizeTimeToken(rangeMatch[2]),
    };
  }

  return { start: normalizeTimeToken(raw), end: '' };
}

export function normalizePincode(value: string): string {
  const digits = String(value ?? '').replace(/\D/g, '').slice(0, 6);
  return digits.length === 6 ? digits : '';
}

export function normalizeExpectedPatients(value: string): string {
  const match = String(value ?? '').match(/\d+/);
  return match ? match[0] : '';
}

/** Apply field-specific value normalization. */
export function normalizeFieldValue(field: CampFieldKey, value: string): string {
  if (isJunkValue(value)) return '';

  switch (field) {
    case 'doctor_name':
    case 'contact_person_name':
      return normalizePersonName(value);
    case 'contact_person_number':
      return normalizePhoneNumber(value);
    case 'camp_date':
      return normalizeDate(value);
    case 'camp_start_time':
    case 'camp_end_time': {
      const range = parseTimeRange(value);
      if (field === 'camp_end_time') {
        return range.end || normalizeTimeToken(value);
      }
      return range.start || normalizeTimeToken(value);
    }
    case 'pincode':
      return normalizePincode(value);
    case 'expected_patients':
      return normalizeExpectedPatients(value);
    case 'city':
    case 'hq':
    case 'doctor_code':
      return value.replace(/\s+/g, ' ').trim();
    default:
      return value.trim();
  }
}

/* -------------------------------------------------------------------------- */
/* Contact priority resolution                                                */
/* -------------------------------------------------------------------------- */

export function resolveContactByPriority(
  pairs: RawLabelValue[],
  lookup: AliasLookupEntry[],
  priority: ContactRoleConfig[],
): { name: string; phone: string } {
  const contactsByRole: Array<{ name: string; phone: string }> = [];

  for (const role of priority) {
    let name = '';
    let phone = '';

    for (const pair of pairs) {
      const resolved = resolveFieldFromLabel(pair.label, lookup);
      if (!resolved) continue;

      const normLabel = normalizeLabel(pair.label);
      const nameMatch = role.nameAliases.some(
        (a) => normalizeLabel(a) === normLabel,
      );
      const phoneMatch = role.phoneAliases.some(
        (a) => normalizeLabel(a) === normLabel,
      );

      if (nameMatch && !name) name = pair.value;
      if (phoneMatch && !phone) phone = pair.value;
    }

    if (name || phone) {
      contactsByRole.push({ name, phone });
    }
  }

  if (!contactsByRole.length) {
    return { name: '', phone: '' };
  }

  const chosen = contactsByRole[0];
  return {
    name: normalizePersonName(chosen.name),
    phone: normalizePhoneNumber(chosen.phone),
  };
}

/* -------------------------------------------------------------------------- */
/* Field merge helpers                                                        */
/* -------------------------------------------------------------------------- */

export function emptyParsedFields(): Record<CampFieldKey, string> {
  return Object.fromEntries(CAMP_FIELD_KEYS.map((k) => [k, ''])) as Record<
    CampFieldKey,
    string
  >;
}

export function confidenceForMethod(method: MatchMethod): number {
  return MATCH_METHOD_CONFIDENCE[method] ?? 50;
}

/** Merge extracted fields — first non-empty wins unless new has higher confidence. */
export function mergeExtractedFields(
  target: Map<CampFieldKey, ExtractedField>,
  incoming: ExtractedField,
): void {
  const existing = target.get(incoming.field);
  if (!existing) {
    target.set(incoming.field, incoming);
    return;
  }
  if (!existing.value && incoming.value) {
    target.set(incoming.field, incoming);
    return;
  }
  if (incoming.value && incoming.confidence > existing.confidence) {
    target.set(incoming.field, incoming);
  }
}

/** Extract 6-digit PIN from free text (address lines). */
export function extractPinFromText(text: string): string {
  const match = String(text ?? '').match(/\b(\d{6})\b/);
  return match ? match[1] : '';
}

/** Extract city from address heuristics when not labeled. */
export function extractCityFromAddress(address: string): string {
  const parts = String(address ?? '')
    .split(/[,;\n]/)
    .map((p) => p.trim())
    .filter(Boolean);
  if (parts.length >= 2) {
    const candidate = parts[parts.length - 2].replace(/\b\d{6}\b/g, '').trim();
    if (candidate && !/^\d+$/.test(candidate)) return candidate;
  }
  return '';
}

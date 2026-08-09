/**
 * Deterministic normalization for extracted event fields.
 * Relative dates resolve in Asia/Kolkata against referenceDate — never by the LLM alone.
 */
import { parseLocalDateInput, trimStr } from '../campOps.helpers.js';
import { normalizePastePhone } from '../import/pasteFieldRegistry.js';
import {
  formatContactPersonName,
  formatDoctorName,
  formatTextValue,
} from '../../../utils/textFormat.js';

const WEEKDAY = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

function kolkataParts(date = new Date()) {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    weekday: 'long',
  });
  const parts = Object.fromEntries(fmt.formatToParts(date).map((p) => [p.type, p.value]));
  return {
    iso: `${parts.year}-${parts.month}-${parts.day}`,
    weekday: String(parts.weekday || '').toLowerCase(),
  };
}

function addDaysIso(iso, days) {
  const [y, m, d] = String(iso).split('-').map(Number);
  const utc = new Date(Date.UTC(y, m - 1, d + days, 6, 30, 0));
  return kolkataParts(utc).iso;
}

function nextWeekdayIso(fromIso, targetWeekday) {
  const target = WEEKDAY.indexOf(String(targetWeekday || '').toLowerCase());
  if (target < 0) return null;
  const [y, m, d] = String(fromIso).split('-').map(Number);
  const base = new Date(Date.UTC(y, m - 1, d, 6, 30, 0));
  for (let i = 1; i <= 7; i += 1) {
    const next = new Date(base);
    next.setUTCDate(base.getUTCDate() + i);
    if (kolkataParts(next).weekday === WEEKDAY[target]) return kolkataParts(next).iso;
  }
  return null;
}

/** Resolve relative / labeled dates to YYYY-MM-DD. */
export function normalizeEventDate(value, { referenceDate = null, timezone = 'Asia/Kolkata' } = {}) {
  void timezone;
  const raw = trimStr(value);
  if (!raw) return { iso: null, dayName: null, provenance: null, relative: false };

  const ref = parseLocalDateInput(referenceDate) || kolkataParts().iso;
  const lower = raw.toLowerCase().replace(/\s+/g, ' ');

  if (lower === 'today') {
    return { iso: ref, dayName: weekdayName(ref), provenance: 'normalized', relative: true };
  }
  if (lower === 'tomorrow') {
    const iso = addDaysIso(ref, 1);
    return { iso, dayName: weekdayName(iso), provenance: 'normalized', relative: true };
  }
  const nextMatch = lower.match(/^next\s+(sunday|monday|tuesday|wednesday|thursday|friday|saturday)$/);
  if (nextMatch) {
    const iso = nextWeekdayIso(ref, nextMatch[1]);
    return { iso, dayName: weekdayName(iso), provenance: 'normalized', relative: true };
  }

  // 15.08.2026 / 15-Aug-26 / 15 Aug 2026 handled via parseLocalDateInput + extras
  const dotted = raw.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})$/);
  if (dotted) {
    let year = Number(dotted[3]);
    if (year < 100) year += 2000;
    const iso = `${year}-${String(dotted[2]).padStart(2, '0')}-${String(dotted[1]).padStart(2, '0')}`;
    if (parseLocalDateInput(iso) === iso) {
      return { iso, dayName: weekdayName(iso), provenance: 'normalized', relative: false };
    }
  }

  const mon = raw.match(/^(\d{1,2})[-\s]+([A-Za-z]{3,9})[-\s,]+(\d{2,4})$/);
  if (mon) {
    const months = {
      jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4,
      may: 5, jun: 6, june: 6, jul: 7, july: 7, aug: 8, august: 8,
      sep: 9, sept: 9, september: 9, oct: 10, october: 10, nov: 11, november: 11,
      dec: 12, december: 12,
    };
    const mi = months[mon[2].toLowerCase()];
    if (mi) {
      let year = Number(mon[3]);
      if (year < 100) year += 2000;
      const iso = `${year}-${String(mi).padStart(2, '0')}-${String(mon[1]).padStart(2, '0')}`;
      if (parseLocalDateInput(iso) === iso) {
        return { iso, dayName: weekdayName(iso), provenance: 'normalized', relative: false };
      }
    }
  }

  const iso = parseLocalDateInput(raw);
  if (iso) {
    return { iso, dayName: weekdayName(iso), provenance: 'normalized', relative: false };
  }
  return { iso: null, dayName: null, provenance: null, relative: false, raw };
}

export function weekdayName(iso) {
  if (!iso) return null;
  const [y, m, d] = String(iso).split('-').map(Number);
  const utc = new Date(Date.UTC(y, m - 1, d, 6, 30, 0));
  return kolkataParts(utc).weekday;
}

/**
 * Normalize a single time token to HH:mm. Never invent end times.
 * Supports: 9AM, 08.30 am, 09:00, 2.30pm, 12:00pm
 */
export function normalizeEventTime(value) {
  const raw = trimStr(value);
  if (!raw) return null;

  let text = raw
    .replace(/\./g, ':')
    .replace(/\s+/g, ' ')
    .trim();

  // 930am / 930 am
  const compact = text.match(/^(\d{1,2})([0-5]\d)\s*(am|pm)?$/i);
  if (compact) {
    text = `${compact[1]}:${compact[2]}${compact[3] ? ` ${compact[3]}` : ''}`;
  }

  const match = text.match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/i);
  if (!match) return null;
  let hours = Number(match[1]);
  const minutes = match[2] != null ? Number(match[2]) : 0;
  const meridiem = match[3]?.toUpperCase();
  if (Number.isNaN(hours) || Number.isNaN(minutes) || minutes > 59 || hours > 23) return null;
  if (meridiem === 'PM' && hours < 12) hours += 12;
  if (meridiem === 'AM' && hours === 12) hours = 0;
  if (!meridiem && hours > 23) return null;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

/** Parse "9AM to 1PM" / "9AM onwards" — onwards leaves end null. */
export function normalizeTimeRange(value) {
  const raw = trimStr(value);
  if (!raw) return { startTime: null, endTime: null };
  if (/onwards|onward|starting|from\s+/i.test(raw) && !/\bto\b|–|-/i.test(raw)) {
    const startOnly = raw.replace(/onwards?|starting|from/ig, '').trim();
    return { startTime: normalizeEventTime(startOnly), endTime: null };
  }
  const parts = raw.split(/\bto\b|–|—|-/i).map((p) => trimStr(p)).filter(Boolean);
  if (parts.length >= 2) {
    return {
      startTime: normalizeEventTime(parts[0]),
      endTime: normalizeEventTime(parts[1]),
    };
  }
  return { startTime: normalizeEventTime(raw), endTime: null };
}

export function normalizeIndianPhones(values = []) {
  const list = Array.isArray(values) ? values : [values];
  const out = [];
  for (const value of list) {
    let phone = normalizePastePhone(value);
    const digits = String(value || '').replace(/\D/g, '');
    if (!phone && digits.length === 12 && digits.startsWith('91')) phone = digits.slice(2);
    if (!phone && digits.length === 10) phone = digits;
    if (phone && phone.length === 12 && phone.startsWith('91')) phone = phone.slice(2);
    if (phone && /^\d{10}$/.test(phone) && !out.includes(phone)) out.push(phone);
  }
  return out;
}

export function normalizePincode(value) {
  const digits = String(value || '').replace(/\D/g, '');
  return /^\d{6}$/.test(digits) ? digits : null;
}

/**
 * Map a validated AI event object into a camp paste row (partial).
 */
export function aiEventToCampRow(aiEvent = {}, { referenceDate = null } = {}) {
  const event = aiEvent.event || {};
  const location = aiEvent.location || {};
  const people = Array.isArray(aiEvent.people) ? aiEvent.people : [];

  const dateInfo = normalizeEventDate(event.date, { referenceDate });
  let startTime = normalizeEventTime(event.startTime);
  let endTime = normalizeEventTime(event.endTime);
  if (!startTime && event.startTime) {
    const range = normalizeTimeRange(event.startTime);
    startTime = range.startTime;
    if (!endTime) endTime = range.endTime;
  }

  const doctor = people.find((p) => /doctor/i.test(String(p.role || ''))) || people[0] || {};
  const contact = people.find((p) => /se|tm|abm|rsm|asm|zsm|flm|manager|coordinator|contact|employee/i.test(String(p.role || '')))
    || people.find((p) => p !== doctor)
    || {};

  const doctorPhones = normalizeIndianPhones(doctor.mobileNumbers || []);
  const contactPhones = normalizeIndianPhones(contact.mobileNumbers || []);

  const address = [
    location.venue,
    location.address || location.rawAddress,
    location.area,
  ].filter(Boolean).join(', ') || location.rawAddress || location.address || '';

  const expectedRaw = event.expectedPatients;
  const expectedPatients = expectedRaw == null || expectedRaw === ''
    ? ''
    : Number(expectedRaw);

  return {
    campDate: dateInfo.iso || '',
    dayName: dateInfo.dayName || '',
    dayLabel: trimStr(event.day),
    startTime: startTime || '',
    endTime: endTime || '',
    expectedPatients: Number.isFinite(expectedPatients) ? expectedPatients : '',
    doctorName: formatDoctorName(doctor.name || '') || '',
    doctorCode: trimStr(doctor.scCode || doctor.employeeCode) || '',
    speciality: formatTextValue(doctor.speciality || '', 'speciality') || '',
    campAddress: formatTextValue(address, 'campAddress') || '',
    city: formatTextValue(location.city || '', 'city') || '',
    state: formatTextValue(location.state || '', 'state') || '',
    pincode: normalizePincode(location.pincode) || '',
    hq: formatTextValue(location.hq || location.stationPatch || '', 'hq') || '',
    fieldPersonName: formatContactPersonName(contact.name || '') || '',
    fieldPersonPhone: contactPhones[0] || doctorPhones[0] || '',
    people,
    rawAddress: location.rawAddress || address || '',
    _dateRelative: dateInfo.relative,
    _dateProvenance: dateInfo.provenance,
  };
}

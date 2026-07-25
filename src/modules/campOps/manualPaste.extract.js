import { trimStr, parseLocalDateInput } from './campOps.helpers.js';
import { resolveZoneNameForState } from '../geo/geo.zones.js';

export const NOT_PROVIDED = 'Not Provided';

const INDIAN_STATES = [
  'Andaman and Nicobar Islands',
  'Andhra Pradesh',
  'Arunachal Pradesh',
  'Assam',
  'Bihar',
  'Chandigarh',
  'Chhattisgarh',
  'Dadra and Nagar Haveli and Daman and Diu',
  'Delhi',
  'Goa',
  'Gujarat',
  'Haryana',
  'Himachal Pradesh',
  'Jammu and Kashmir',
  'Jharkhand',
  'Karnataka',
  'Kerala',
  'Ladakh',
  'Lakshadweep',
  'Madhya Pradesh',
  'Maharashtra',
  'Manipur',
  'Meghalaya',
  'Mizoram',
  'Nagaland',
  'Odisha',
  'Puducherry',
  'Punjab',
  'Rajasthan',
  'Sikkim',
  'Tamil Nadu',
  'Telangana',
  'Tripura',
  'Uttar Pradesh',
  'Uttarakhand',
  'West Bengal',
];

const IGNORE_LINE_PATTERNS = [
  /\btechnician\b/i,
  /^\s*client\b/i,
  /^\s*camp\s*type\b/i,
  /^\s*reminder\b/i,
  /^\s*request\s*source\b/i,
  /^\s*specialit/i,
  /^\s*patch\b/i,
  /^\s*station\b/i,
];

const CONTACT_PRIORITY = [
  { name: ['SE Name'], phone: ['SE Mobile'] },
  { name: ['ABM Name'], phone: ['ABM Mobile'] },
  { name: ['BO Name'], phone: ['BO Contact No', 'BO Contact', 'BO Mobile'] },
  { name: ['RSM Name'], phone: ['RSM Mobile'] },
  { name: ['Field Team Name'], phone: ['Field Team Mobile', 'Field Team Contact'] },
];

function escapeRegex(value) {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function withDefault(value) {
  const v = trimStr(value);
  return v || NOT_PROVIDED;
}

function toCampValue(value) {
  const v = trimStr(value);
  if (!v || v.toLowerCase() === NOT_PROVIDED.toLowerCase()) return '';
  return v;
}

function stripIgnoredLines(text) {
  return String(text || '')
    .split('\n')
    .filter((line) => !IGNORE_LINE_PATTERNS.some((pattern) => pattern.test(line)))
    .join('\n');
}

function pickLabeledValue(text, labels = []) {
  const raw = String(text || '');
  for (const label of labels) {
    const re = new RegExp(
      `(?:^|\\n)\\s*${escapeRegex(label)}\\s*[:\\-=–]+\\s*(.+?)(?:\\n|$)`,
      'i',
    );
    const match = raw.match(re);
    if (match?.[1]) return trimStr(match[1]);
  }
  return '';
}

function normalizeTimeToken(token) {
  const raw = trimStr(token);
  if (!raw) return '';
  const match = raw.match(/^(\d{1,2}):(\d{2})(?:\s*(AM|PM))?$/i);
  if (!match) return raw;
  let hours = Number(match[1]);
  const minutes = match[2];
  const meridiem = match[3]?.toUpperCase();
  if (meridiem === 'PM' && hours < 12) hours += 12;
  if (meridiem === 'AM' && hours === 12) hours = 0;
  return `${String(hours).padStart(2, '0')}:${minutes}`;
}

function extractCampTimes(text) {
  const labeledStart = pickLabeledValue(text, ['Camp Start Time', 'Start Time', 'Start']);
  const labeledEnd = pickLabeledValue(text, ['Camp End Time', 'End Time', 'End']);
  const mentioned = extractMentionedTimes(text);
  const startTime = normalizeTimeToken(labeledStart) || mentioned[0] || '';
  const endTime = normalizeTimeToken(labeledEnd) || mentioned[1] || '';
  return { startTime, endTime };
}

function extractPinCode(text, location = {}) {
  const labeled = pickLabeledValue(text, ['PIN Code', 'Pin Code', 'Pincode', 'PIN', 'Postal Code']);
  const fromLabel = String(labeled || '').replace(/\D/g, '').slice(0, 6);
  if (fromLabel.length === 6) return fromLabel;
  return location.pincode || '';
}

function extractMentionedTimes(text) {
  const source = stripIgnoredLines(text);
  const matches = [...source.matchAll(/\b(\d{1,2}:\d{2}(?:\s*(?:AM|PM))?)\b/gi)];
  return matches.map((match) => normalizeTimeToken(match[1])).filter(Boolean);
}

function extractCampDate(text) {
  const raw = pickLabeledValue(text, ['Date']);
  if (!raw) return '';
  const dateMatch = raw.match(/\d{1,2}[\/\-.]\d{1,2}[\/\-.]\d{2,4}|\d{4}-\d{2}-\d{2}/);
  const dateToken = dateMatch ? dateMatch[0] : raw.split(/\s+/)[0];
  return parseLocalDateInput(dateToken) || dateToken;
}

function findStateInText(text) {
  const haystack = String(text || '');
  const sorted = [...INDIAN_STATES].sort((a, b) => b.length - a.length);
  for (const state of sorted) {
    const re = new RegExp(`\\b${escapeRegex(state)}\\b`, 'i');
    if (re.test(haystack)) return state;
  }
  return '';
}

function extractLocationFromAddress(address) {
  const raw = trimStr(address);
  if (!raw) {
    return { state: '', city: '', pincode: '' };
  }

  const pinMatch = raw.match(/\b(\d{6})\b/);
  const pincode = pinMatch ? pinMatch[1] : '';

  let state = findStateInText(raw);
  let city = '';

  const parts = raw
    .split(/[,;\n]/)
    .map((part) => trimStr(part))
    .filter(Boolean);

  if (state) {
    const stateIndex = parts.findIndex((part) => new RegExp(`\\b${escapeRegex(state)}\\b`, 'i').test(part));
    if (stateIndex > 0) {
      city = parts[stateIndex - 1].replace(/\b\d{6}\b/g, '').trim();
    }
  }

  if (!city && pincode) {
    const beforePin = raw.split(pincode)[0] || '';
    const pinParts = beforePin.split(/[,;\n]/).map((part) => trimStr(part)).filter(Boolean);
    city = pinParts[pinParts.length - 1] || '';
  }

  if (!city && parts.length >= 2) {
    city = parts[parts.length - 2].replace(/\b\d{6}\b/g, '').trim();
  }

  city = city.replace(new RegExp(`\\b${escapeRegex(state)}\\b`, 'i'), '').trim();

  return { state, city, pincode };
}

function extractContactPerson(text) {
  for (const pair of CONTACT_PRIORITY) {
    const name = pickLabeledValue(text, pair.name);
    const phone = pickLabeledValue(text, pair.phone);
    if (name || phone) {
      return { name, phone };
    }
  }
  return { name: '', phone: '' };
}

export function extractManualPasteFields(text) {
  const raw = String(text || '');
  const doctorName = pickLabeledValue(raw, ['Doctor Name', 'Dr Name', 'Doctor']);
  const doctorCode = pickLabeledValue(raw, ['Doctor Code', 'SC Code', 'SE Code']);
  const campDate = extractCampDate(raw);
  const { startTime, endTime } = extractCampTimes(raw);
  const campAddress = pickLabeledValue(raw, [
    'Camp Address',
    'Camp Venue',
    'Address',
    'Complete Address',
  ]);
  const location = extractLocationFromAddress(campAddress);
  const pincode = extractPinCode(raw, location);
  const zone = location.state ? resolveZoneNameForState(location.state) : '';
  const expectedPatientsRaw = pickLabeledValue(raw, ['Expected Patients']);
  const expectedPatientsMatch = expectedPatientsRaw.match(/\d+/);
  const contact = extractContactPerson(raw);

  const display = {
    campDate: withDefault(campDate),
    startTime: withDefault(startTime),
    endTime: withDefault(endTime),
    doctorName: withDefault(doctorName),
    doctorCode: withDefault(doctorCode),
    campAddress: withDefault(campAddress),
    state: withDefault(location.state),
    city: withDefault(location.city),
    hq: withDefault(location.city),
    pincode: withDefault(pincode),
    zone: withDefault(zone),
    expectedPatients: withDefault(expectedPatientsMatch ? expectedPatientsMatch[0] : ''),
    fieldPersonName: withDefault(contact.name),
    fieldPersonPhone: withDefault(contact.phone),
  };

  return {
    display,
    row: {
      doctorName: toCampValue(doctorName),
      doctorCode: toCampValue(doctorCode),
      campDate: toCampValue(campDate),
      startTime: toCampValue(startTime) || '09:00',
      endTime: toCampValue(endTime),
      campAddress: toCampValue(campAddress),
      state: toCampValue(location.state),
      city: toCampValue(location.city),
      hq: toCampValue(location.city),
      pincode: toCampValue(pincode),
      zone: toCampValue(zone),
      expectedPatients: expectedPatientsMatch ? Number(expectedPatientsMatch[0]) : 0,
      fieldPersonName: toCampValue(contact.name),
      fieldPersonPhone: toCampValue(contact.phone),
      remarks: '',
      rawExcerpt: raw.slice(0, 500),
    },
  };
}

export function formatManualPasteOutput(display = {}) {
  return [
    'Camp Date:',
    display.campDate || NOT_PROVIDED,
    'Camp Start Time:',
    display.startTime || NOT_PROVIDED,
    'Camp End Time:',
    display.endTime || NOT_PROVIDED,
    'Doctor Name:',
    display.doctorName || NOT_PROVIDED,
    'Doctor Code:',
    display.doctorCode || NOT_PROVIDED,
    'Camp Address:',
    display.campAddress || NOT_PROVIDED,
    'State:',
    display.state || NOT_PROVIDED,
    'Zone:',
    display.zone || NOT_PROVIDED,
    'City:',
    display.city || NOT_PROVIDED,
    'HQ:',
    display.hq || NOT_PROVIDED,
    'PIN Code:',
    display.pincode || NOT_PROVIDED,
    'Expected Patients:',
    display.expectedPatients || NOT_PROVIDED,
    'Contact Person Name:',
    display.fieldPersonName || NOT_PROVIDED,
    'Contact Person Number:',
    display.fieldPersonPhone || NOT_PROVIDED,
  ].join('\n');
}

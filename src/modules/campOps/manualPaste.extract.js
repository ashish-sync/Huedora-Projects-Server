import { trimStr, parseLocalDateInput } from './campOps.helpers.js';
import { resolveZoneNameForState } from '../geo/geo.zones.js';
import {
  formatDoctorName,
  formatContactPersonName,
  formatTextValue,
} from '../../utils/textFormat.js';
import { findStateInText } from '../geo/indianStateNames.js';
import {
  compactFieldName,
  getDesignationContactPairs,
  getTextPasteLabels,
  isNullValue,
  normalizePastePhone,
  preprocessFieldName,
} from './import/pasteFieldRegistry.js';
import {
  getFieldLabelsMap,
  getPasteTabularFieldKeys,
} from './import/campRequestFieldSchema.js';
import { normalizePasteStartTime } from './pasteTimeNormalize.js';

export const NOT_PROVIDED = 'Not Provided';

function escapeRegex(value) {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function formatExtractedDoctorName(value) {
  return formatDoctorName(value);
}

function formatExtractedContactName(value) {
  return formatContactPersonName(value);
}

function withDefault(value) {
  const v = trimStr(value);
  return v || NOT_PROVIDED;
}

function toCampValue(value) {
  const v = trimStr(value);
  if (!v || isNullValue(v) || v.toLowerCase() === NOT_PROVIDED.toLowerCase()) return '';
  return v;
}

/** Strip WhatsApp/email list bullets so "- Doctor Name:" still matches. */
function stripListBullet(line = '') {
  return String(line || '')
    .replace(/^\s*(?:[-*•◦▪▫–—]+|\d+[.)])\s*/u, '')
    .replace(/^\s*\*\s*/, '')
    .trim();
}

function splitLabeledLine(line = '') {
  const cleaned = stripListBullet(line);
  if (!cleaned) return null;
  // Prefer colon/equals — avoid treating "Coimbatore-641045" as Label-Value.
  const match = cleaned.match(/^(.{2,60}?)\s*[:：=]\s*(.+)$/)
    || cleaned.match(/^([A-Za-z][A-Za-z0-9 /&.()]{1,50}?)\s*[-–—]\s*(.+)$/);
  if (!match) return null;
  const left = trimStr(match[1]);
  const right = trimStr(match[2]);
  if (!left || !right || isNullValue(right)) return null;
  // Address/locality lines are not field labels.
  if (/,/.test(left) || /\d{4,}/.test(left)) return null;
  return { left, right };
}

function labelMatches(left, label) {
  const leftCompact = compactFieldName(left);
  const labelCompact = compactFieldName(label);
  if (!leftCompact || !labelCompact) return false;
  if (leftCompact === labelCompact) return true;
  // Allow "Doctor SC Code" ↔ "SC Code", "Pincode of camp place" ↔ "Pincode"
  // Keep threshold high so short aliases like "name" / "dr" do not over-match.
  if (leftCompact.endsWith(labelCompact) && labelCompact.length >= 6) return true;
  if (labelCompact.endsWith(leftCompact) && leftCompact.length >= 6) return true;
  return false;
}

function pickLabeledValue(text, labels = []) {
  const raw = String(text || '');
  const ordered = [...labels]
    .filter(Boolean)
    .sort((a, b) => String(b).length - String(a).length);

  for (const label of ordered) {
    const re = new RegExp(
      `(?:^|\\n)\\s*(?:[-*•◦▪▫–—]+|\\d+[.)])?\\s*${escapeRegex(label)}\\s*[:：=\\-–—]+\\s*(.+?)(?:\\n|$)`,
      'iu',
    );
    const match = raw.match(re);
    if (match?.[1]) {
      const value = trimStr(match[1]);
      if (!isNullValue(value)) return value;
    }
  }

  const lines = raw.split('\n');
  for (const line of lines) {
    const parsed = splitLabeledLine(line);
    if (!parsed) continue;
    for (const label of ordered) {
      if (labelMatches(parsed.left, label)) {
        return parsed.right;
      }
    }
  }

  return '';
}

function pickFieldValue(text, internalKey) {
  return pickLabeledValue(text, getTextPasteLabels(internalKey));
}

function normalizeSingleTime(token) {
  const raw = trimStr(token);
  if (!raw || isNullValue(raw)) return '';
  return normalizePasteStartTime(raw);
}

function parseTimeRange(value) {
  const raw = trimStr(value);
  const range = raw.match(/^(\d{1,2}:\d{2}(?:\s*(?:AM|PM))?)\s*[-–to]+\s*(\d{1,2}:\d{2}(?:\s*(?:AM|PM))?)$/i);
  if (!range) return null;
  return {
    startTime: normalizeSingleTime(range[1]),
    endTime: normalizeSingleTime(range[2]),
  };
}

function extractUnlabeledAddressLine(text, hospitalName = '') {
  const lines = String(text || '').split('\n').map(stripListBullet).filter(Boolean);
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (splitLabeledLine(line)) continue;
    // Prefer a free-form line after Camp Venue / with PIN / comma-separated locality.
    const prev = i > 0 ? stripListBullet(lines[i - 1]) : '';
    const afterVenue = /camp\s*venue|hospital|clinic|venue/i.test(prev);
    const looksLikeAddress = /\b\d{6}\b/.test(line) || (/,/.test(line) && line.length >= 20);
    if ((afterVenue || looksLikeAddress) && (!hospitalName || !compactFieldName(line).includes(compactFieldName(hospitalName).slice(0, 8)))) {
      return trimStr(line);
    }
  }
  return '';
}

function extractCampTimes(text) {
  const labeledStart = pickFieldValue(text, 'startTime');
  const labeledEnd = pickFieldValue(text, 'endTime');
  const timeLabelValue = pickLabeledValue(text, ['Time', 'Camp Time', 'Timing']);

  const startRange = parseTimeRange(labeledStart) || parseTimeRange(timeLabelValue);
  const endRange = parseTimeRange(labeledEnd);

  const mentioned = extractMentionedTimes(text);
  const onwards = String(timeLabelValue || labeledStart || text).match(
    /\b(\d{1,2}(?::\d{2})?\s*(?:am|pm)?)\s*onwards?\b/i,
  );
  const startTime = startRange?.startTime
    || normalizeSingleTime(labeledStart)
    || normalizeSingleTime(onwards?.[1])
    || normalizeSingleTime(timeLabelValue)
    || mentioned[0]
    || '';
  const endTime = endRange?.endTime || startRange?.endTime || normalizeSingleTime(labeledEnd) || mentioned[1] || '';
  return { startTime, endTime };
}

function extractPinCode(text, location = {}) {
  const labeled = pickFieldValue(text, 'pincode');
  const fromLabel = String(labeled || '').replace(/\D/g, '').slice(0, 6);
  if (fromLabel.length === 6) return fromLabel;
  if (location.pincode) return location.pincode;
  const address = pickFieldValue(text, 'campAddress') || pickFieldValue(text, 'hospitalName');
  return extractLocationFromAddress(address).pincode || '';
}

function extractMentionedTimes(text) {
  const matches = [...String(text || '').matchAll(/\b(\d{1,2}(?::\d{2})?\s*(?:AM|PM)|(?:\d{1,2}:\d{2}))\b/gi)];
  return matches.map((match) => normalizeSingleTime(match[1])).filter(Boolean);
}

function extractCampDate(text) {
  const raw = pickFieldValue(text, 'campDate');
  if (!raw) return '';
  const dateMatch = raw.match(/\d{1,2}[\/\-.]\d{1,2}[\/\-.]\d{2,4}|\d{4}-\d{2}-\d{2}/);
  const dateToken = dateMatch ? dateMatch[0] : raw.split(/\s+/)[0];
  return parseLocalDateInput(dateToken) || dateToken;
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
      city = parts[stateIndex - 1].replace(/-?\d{6}\b/g, '').replace(/[-–—\s]+$/g, '').trim();
    }
  }

  if (!city && pincode) {
    const beforePin = raw.split(pincode)[0] || '';
    const pinParts = beforePin.split(/[,;\n]/).map((part) => trimStr(part)).filter(Boolean);
    city = (pinParts[pinParts.length - 1] || '').replace(/[-–—\s]+$/g, '').trim();
  }

  if (!city && parts.length >= 2) {
    city = parts[parts.length - 2].replace(/\b\d{6}\b/g, '').trim();
  }

  city = city.replace(new RegExp(`\\b${escapeRegex(state)}\\b`, 'i'), '').trim();

  return { state, city, pincode };
}

function extractContactPerson(text) {
  for (const pair of getDesignationContactPairs()) {
    const name = pickLabeledValue(text, pair.name);
    const phone = pickLabeledValue(text, pair.phone);
    if (name || phone) {
      return {
        name,
        phone: normalizePastePhone(phone),
        role: pair.role,
      };
    }
  }
  return { name: '', phone: '', role: '' };
}

export function extractManualPasteFields(text) {
  const raw = String(text || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const doctorName = pickFieldValue(raw, 'doctorName');
  const doctorCode = pickFieldValue(raw, 'doctorCode');
  const speciality = pickFieldValue(raw, 'speciality');
  const campDate = extractCampDate(raw);
  const { startTime, endTime } = extractCampTimes(raw);
  const hospitalName = pickFieldValue(raw, 'hospitalName');
  const labeledAddress = pickFieldValue(raw, 'campAddress');
  const unlabeledAddress = extractUnlabeledAddressLine(raw, hospitalName);
  const campAddress = labeledAddress
    || [hospitalName, unlabeledAddress].filter(Boolean).join(', ')
    || hospitalName;
  const city = pickFieldValue(raw, 'city');
  const state = pickFieldValue(raw, 'state');
  const location = extractLocationFromAddress(campAddress || unlabeledAddress);
  const pincode = extractPinCode(raw, location);
  const hq = pickFieldValue(raw, 'hq');
  const zone = (state || location.state) ? resolveZoneNameForState(state || location.state) : '';
  const expectedPatientsRaw = pickFieldValue(raw, 'expectedPatients');
  const expectedPatientsMatch = expectedPatientsRaw.match(/\d+/);
  const contact = extractContactPerson(raw);
  const remarks = pickFieldValue(raw, 'remarks');

  const resolvedCity = city || location.city;
  const resolvedState = state || location.state;
  const resolvedDistrict = pickFieldValue(raw, 'district') || location.district || resolvedCity;
  const resolvedHq = hq || resolvedCity || resolvedDistrict;

  const display = {
    campDate: withDefault(campDate),
    startTime: withDefault(startTime),
    endTime: withDefault(endTime),
    doctorName: withDefault(formatExtractedDoctorName(doctorName)),
    doctorCode: withDefault(doctorCode),
    speciality: withDefault(speciality),
    hospitalName: withDefault(formatTextValue(hospitalName, 'hospitalName')),
    campAddress: withDefault(formatTextValue(campAddress, 'campAddress')),
    state: withDefault(formatTextValue(resolvedState, 'state')),
    district: withDefault(formatTextValue(resolvedDistrict, 'district')),
    city: withDefault(formatTextValue(resolvedCity, 'city')),
    hq: withDefault(formatTextValue(resolvedHq, 'hq')),
    pincode: withDefault(pincode),
    zone: withDefault(zone),
    expectedPatients: withDefault(expectedPatientsMatch ? expectedPatientsMatch[0] : ''),
    fieldPersonName: withDefault(formatExtractedContactName(contact.name)),
    fieldPersonPhone: withDefault(contact.phone),
    remarks: withDefault(remarks),
  };

  return {
    display,
    row: {
      doctorName: toCampValue(formatExtractedDoctorName(doctorName)),
      doctorCode: toCampValue(doctorCode),
      speciality: toCampValue(speciality),
      hospitalName: toCampValue(formatTextValue(hospitalName, 'hospitalName')),
      campDate: toCampValue(campDate),
      startTime: toCampValue(startTime),
      endTime: toCampValue(endTime),
      campAddress: toCampValue(formatTextValue(campAddress, 'campAddress')),
      state: toCampValue(formatTextValue(resolvedState, 'state')),
      district: toCampValue(formatTextValue(resolvedDistrict, 'district')),
      city: toCampValue(formatTextValue(resolvedCity, 'city')),
      hq: toCampValue(formatTextValue(resolvedHq, 'hq')),
      pincode: toCampValue(pincode),
      zone: toCampValue(zone),
      expectedPatients: expectedPatientsMatch ? Number(expectedPatientsMatch[0]) : 0,
      fieldPersonName: toCampValue(formatExtractedContactName(contact.name)),
      fieldPersonPhone: toCampValue(contact.phone),
      remarks: toCampValue(remarks),
      rawExcerpt: raw.slice(0, 500),
    },
  };
}

export function formatManualPasteOutput(display = {}) {
  const labels = getFieldLabelsMap();
  const keys = getPasteTabularFieldKeys();

  return keys.flatMap((key) => [
    `${labels[key] || key}:`,
    display[key] || NOT_PROVIDED,
  ]).join('\n');
}

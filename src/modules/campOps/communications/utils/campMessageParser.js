import { normalizeCampName } from '../config/campNames.js';
import { parseLocalDateInput, computeEndTime, parseTimeToMinutes, resolveClinicHospitalName } from './campHelpers.js';
import {
  cleanFieldValue,
  parseLabelValueLine,
  sanitizeFieldValue,
  scoreCampTextSegment,
} from './campFieldExtractors.js';

export const PENDING_IMPORT_CLIENT_NAME = 'Import (Pending Review)';

const WHATSAPP_EXPORT_PATTERN = /(?:^|\n)\[\d{1,2}:\d{2}\s*(?:am|pm),\s*\d{1,2}\/\d{1,2}\/\d{4}\]\s*\+?[\d\s]+:\s*/gi;

const CAMP_BLOCK_SPLITTERS = [
  /(?:^|\n)(?=Client:\s*\S)/gi,
  /(?:^|\n)(?=BMD Camp Request)/gi,
  /(?:^|\n)(?=Dietician Camps Booking Template)/gi,
  /(?:^|\n)(?=Kindly arrange\s+to book)/gi,
  /(?:^|\n)(?=Dear Madame)/gi,
  /(?:^|\n)(?=Dear .{3,40} please help)/gi,
  /(?:^|\n)(?=Calcidef\s)/gi,
  /(?:^|\n)(?=Subject:\s*BMD)/gi,
];

const MONTHS = {
  jan: 0, january: 0, feb: 1, february: 1, mar: 2, march: 2,
  apr: 3, april: 3, may: 4, jun: 5, june: 5, jul: 6, july: 6,
  aug: 7, august: 7, sep: 8, sept: 8, september: 8, oct: 9, october: 9,
  nov: 10, november: 10, dec: 11, december: 11,
};

const INDIAN_STATES = [
  'Andhra Pradesh', 'West Bengal', 'Uttar Pradesh', 'Madhya Pradesh', 'Tamil Nadu',
  'Maharashtra', 'Karnataka', 'Gujarat', 'Rajasthan', 'Kerala', 'Punjab', 'Haryana',
  'Bihar', 'Odisha', 'Assam', 'Jharkhand', 'Chhattisgarh', 'Telangana', 'Delhi',
  'Uttarakhand', 'Himachal Pradesh', 'Goa', 'Punjab',
];

function normalizeWhitespace(text) {
  return String(text || '').replace(/\s+/g, ' ').trim();
}

function monthIndex(token) {
  const key = String(token || '').toLowerCase().replace(/\./g, '');
  return MONTHS[key] ?? MONTHS[key.slice(0, 3)] ?? null;
}

export function normalizeTimeString(raw) {
  let text = String(raw || '').trim().toLowerCase();
  if (!text) return '';

  text = text
    .replace(/\./g, ':')
    .replace(/\s+/g, ' ')
    .replace(/morning\s+/i, '')
    .replace(/(\d{1,2}):(\d{2})\s*(am|pm)/gi, '$1:$2 $3')
    .replace(/(\d{1,2})\s*(am|pm)/gi, '$1:00 $2');

  const match = /(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/.exec(text);
  if (!match) return '';

  let hours = Number(match[1]);
  const minutes = Number(match[2] || 0);
  const meridiem = match[3];

  if (meridiem === 'pm' && hours < 12) hours += 12;
  if (meridiem === 'am' && hours === 12) hours = 0;

  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

export function extractDateFromText(text) {
  const source = String(text || '');

  const labeled = [
    /(?:date of the camp|camp date|date|dates|date's)\s*[:=\-–—]+\s*([^\n]+)/i,
    /(?:^|\n)date\s*[:=\-–—]+\s*([^\n]+)/i,
  ];
  for (const pattern of labeled) {
    const match = pattern.exec(source);
    if (match) {
      const parsed = parseFlexibleDate(match[1]);
      if (parsed) return parsed;
    }
  }

  const patterns = [
    /(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})/,
    /(\d{1,2})\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s+(\d{4})?/i,
    /(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s+(\d{1,2})(?:st|nd|rd|th)?(?:\s+(\d{4}))?/i,
  ];

  for (const pattern of patterns) {
    const match = pattern.exec(source);
    if (!match) continue;
    if (pattern === patterns[0]) {
      const parsed = parseFlexibleDate(match[0]);
      if (parsed) return parsed;
    } else if (match.length === 4 && /[a-z]/i.test(match[2] || match[1])) {
      const parsed = parseFlexibleDate(match[0]);
      if (parsed) return parsed;
    }
  }

  return null;
}

export function parseFlexibleDate(value) {
  const text = String(value || '').trim();
  if (!text) return null;

  const local = parseLocalDateInput(text);
  if (local) return local;

  const dmy = /^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})$/.exec(text);
  if (dmy) {
    let year = Number(dmy[3]);
    if (year < 100) year += 2000;
    const date = new Date(year, Number(dmy[2]) - 1, Number(dmy[1]));
    return Number.isNaN(date.getTime()) ? null : date;
  }

  const dayMonthYear = /^(\d{1,2})\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s*(\d{4})?$/i.exec(text);
  if (dayMonthYear) {
    const month = monthIndex(dayMonthYear[2]);
    if (month == null) return null;
    let year = dayMonthYear[3] ? Number(dayMonthYear[3]) : new Date().getFullYear();
    const date = new Date(year, month, Number(dayMonthYear[1]));
    if (!dayMonthYear[3] && date < new Date()) date.setFullYear(year + 1);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  const monthDayYear = /^(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s+(\d{1,2})(?:st|nd|rd|th)?(?:\s+(\d{4}))?$/i.exec(text);
  if (monthDayYear) {
    const month = monthIndex(monthDayYear[1]);
    if (month == null) return null;
    let year = monthDayYear[3] ? Number(monthDayYear[3]) : new Date().getFullYear();
    const date = new Date(year, month, Number(monthDayYear[2]));
    if (!monthDayYear[3] && date < new Date()) date.setFullYear(year + 1);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  const parsed = new Date(text);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function extractTimingRange(text) {
  const source = String(text || '');
  let startTime = '';
  let endTime = '';

  const timingLine = /timing\s*[:=\-–—]+\s*(.+)$/im.exec(source);
  if (timingLine) {
    const range = /(.+?)\s*(?:to|–|-)\s*(.+)/i.exec(timingLine[1]);
    if (range) {
      startTime = normalizeTimeString(range[1]);
      endTime = normalizeTimeString(range[2]);
    }
  }

  const timeLine = /time\s*[:=\-–—]+\s*(.+)$/im.exec(source);
  if (timeLine && !startTime) {
    const range = /(.+?)\s*(?:to|–|-)\s*(.+)/i.exec(timeLine[1]);
    if (range) {
      startTime = normalizeTimeString(range[1]);
      endTime = normalizeTimeString(range[2]);
    } else {
      startTime = normalizeTimeString(timeLine[1]);
    }
  }

  if (!startTime) {
    const inTime = /in\s*time\s*[:=\-–—]+\s*(.+)$/im.exec(source);
    const outTime = /out\s*time\s*[:=\-–—]+\s*(.+)$/im.exec(source);
    if (inTime) startTime = normalizeTimeString(inTime[1]);
    if (outTime) endTime = normalizeTimeString(outTime[1]);
  }

  return { startTime, endTime };
}

function extractMultilineAddress(lines) {
  const addressKeyPattern = /^(complete adress|complete address|address\*?|full clinic address|hospital\/clinic address|camp address|camp venue|location)\s*[:=\-–—]+\s*(.*)$/i;
  let collecting = false;
  const parts = [];

  for (const rawLine of lines) {
    const line = rawLine.trim().replace(/^\-\s*/, '');
    const addressStart = addressKeyPattern.exec(line);
    if (addressStart) {
      collecting = true;
      if (addressStart[1].trim()) parts.push(addressStart[1].trim());
      continue;
    }

    if (collecting) {
      if (parseLabelValueLine(line)) break;
      if (line) parts.push(line);
    }
  }

  return normalizeWhitespace(parts.join(', '));
}

function extractLabeledFieldsFromBlock(text) {
  const result = {};
  const lines = String(text || '').split(/\r?\n/).map((line) => line.trim()).filter(Boolean);

  lines.forEach((line) => {
    const parsed = parseLabelValueLine(line);
    if (!parsed) return;
    const value = sanitizeFieldValue(parsed.value, parsed.field);
    if (!value) return;
    if (!result[parsed.field]) result[parsed.field] = value;
  });

  const multilineAddress = extractMultilineAddress(lines);
  if (multilineAddress && !result.campAddress) {
    result.campAddress = multilineAddress;
  }

  const timing = extractTimingRange(text);
  if (timing.startTime && !result.startTime) result.startTime = timing.startTime;
  if (timing.endTime && !result.endTime) result.endTime = timing.endTime;

  if (!result.campDate) {
    const date = extractDateFromText(text);
    if (date) result.campDate = date;
  }

  if (!result.campaignName && /\bbmd\b/i.test(text)) {
    result.campaignName = 'BMD';
  }

  if (!result.state) {
    const lower = text.toLowerCase();
    for (const state of INDIAN_STATES) {
      if (lower.includes(state.toLowerCase())) {
        result.state = state;
        break;
      }
    }
  }

  if (!result.pincode) {
    const pin = /\b(\d{6})\b/.exec(text);
    if (pin) result.pincode = pin[1];
  }

  return result;
}

export function normalizeClientLabel(value) {
  return String(value || '')
    .replace(/_/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function matchClientFromText(text, knownClients = []) {
  const labeled = extractLabeledFieldsFromBlock(text);
  if (labeled.clientName) {
    const label = normalizeClientLabel(labeled.clientName);
    for (const client of knownClients) {
      const name = client.name.toLowerCase();
      const firstWord = name.split(' ')[0];
      if (label.toLowerCase() === name || label.toLowerCase().startsWith(`${firstWord} `) || label.toLowerCase().startsWith(firstWord)) {
        return client.name;
      }
    }
    return label;
  }

  const lower = String(text || '').toLowerCase();
  for (const client of knownClients) {
    const name = client.name.toLowerCase();
    const code = String(client.code || '').toLowerCase();
    if (lower.includes(name)) return client.name;
    if (code && lower.includes(code)) return client.name;
    const firstWord = name.split(' ')[0];
    if (firstWord.length > 3 && lower.includes(firstWord)) return client.name;
  }

  const clientMatch = /client\s*[:=\-–—]+\s*([^\n]+)/i.exec(text);
  if (clientMatch) {
    const label = normalizeClientLabel(clientMatch[1]);
    for (const client of knownClients) {
      const firstWord = client.name.toLowerCase().split(' ')[0];
      if (label.toLowerCase().includes(firstWord)) return client.name;
    }
    return label;
  }

  return '';
}

export function splitCampMessageBlocks(text) {
  const raw = String(text || '').trim();
  if (!raw) return [];

  let segments = raw.split(WHATSAPP_EXPORT_PATTERN).map((part) => part.trim()).filter(Boolean);
  if (segments.length <= 1) segments = [raw];

  const expanded = [];
  segments.forEach((segment) => {
    let parts = [segment];
    CAMP_BLOCK_SPLITTERS.forEach((splitter) => {
      const next = [];
      parts.forEach((part) => {
        const split = part.split(splitter).map((p) => p.trim()).filter(Boolean);
        next.push(...(split.length ? split : [part]));
      });
      parts = next;
    });
    expanded.push(...parts);
  });

  const scored = expanded
    .map((segment) => ({ segment, score: scoreCampTextSegment(segment) }))
    .filter((item) => item.score >= 2);

  if (!scored.length) return [raw];

  return scored.map((item) => item.segment);
}

export function normalizeCampRow(raw = {}, { from = '', knownClients = [] } = {}) {
  const fields = { ...raw };

  if (!fields.clientName) {
    fields.clientName = matchClientFromText(
      [fields.remarks, fields.campaignName, from].join('\n'),
      knownClients
    ) || PENDING_IMPORT_CLIENT_NAME;
  } else {
    fields.clientName = normalizeClientLabel(fields.clientName);
  }

  let campDate = fields.campDate;
  if (typeof campDate === 'string') {
    campDate = parseFlexibleDate(campDate) || extractDateFromText(campDate);
  }
  if (!(campDate instanceof Date) || Number.isNaN(campDate.getTime())) {
    campDate = extractDateFromText(JSON.stringify(fields)) || new Date();
    campDate.setHours(0, 0, 0, 0);
  }

  const startTime = normalizeTimeString(fields.startTime) || '09:00';
  let endTime = normalizeTimeString(fields.endTime) || '';
  const durationHours = Number(fields.durationHours) || 3;
  if (!endTime) endTime = computeEndTime(startTime, durationHours);

  const expectedPatients = Number(String(fields.expectedPatients || '').replace(/[^\d]/g, '')) || 0;

  return {
    clientName: fields.clientName || PENDING_IMPORT_CLIENT_NAME,
    campaignName: normalizeCampName(fields.campaignName),
    campaignType: String(fields.campaignType || '').trim() || 'Screening',
    doctorName: String(fields.doctorName || '').trim(),
    doctorCode: String(fields.doctorCode || '').trim(),
    scCode: String(fields.scCode || '').trim(),
    mslNo: String(fields.mslNo || '').trim(),
    speciality: String(fields.speciality || '').trim(),
    hospitalName: resolveClinicHospitalName(fields.hospitalName, fields.clinicName),
    clinicName: '',
    campAddress: String(fields.campAddress || '').trim(),
    city: String(fields.city || '').trim(),
    state: String(fields.state || '').trim(),
    pincode: String(fields.pincode || '').trim(),
    campDate,
    startTime,
    endTime,
    durationHours,
    expectedPatients,
    actualPatients: Number(fields.actualPatients) || 0,
    fieldPersonName: String(fields.fieldPersonName || '').trim(),
    fieldPersonPhone: String(fields.fieldPersonPhone || fields.fieldPersonContact || '').trim(),
    remarks: String(fields.remarks || '').trim(),
  };
}

export function parseCampMessageBlock(text, options = {}) {
  const fields = extractLabeledFieldsFromBlock(text);
  const row = normalizeCampRow(fields, options);
  const partialFields = [];

  if (row.clientName === PENDING_IMPORT_CLIENT_NAME) partialFields.push('clientName');
  if (!fields.campDate) partialFields.push('campDate');
  if (!fields.doctorName) partialFields.push('doctorName');
  if (!fields.city) partialFields.push('city');

  return {
    valid: true,
    row,
    partial: partialFields.length > 0,
    partialFields,
    rawBlock: text,
  };
}

export function parseCampMessages(text, options = {}) {
  const blocks = splitCampMessageBlocks(text);
  return blocks.map((block, index) => ({
    rowNumber: index + 1,
    ...parseCampMessageBlock(block, options),
  }));
}

export function parseWhatsAppMessage(text, options = {}) {
  const results = parseCampMessages(text, options);
  return results[0]?.row || {};
}

export function validateWhatsAppCampData(parsed) {
  const row = normalizeCampRow(parsed);
  if (!row.campDate) {
    return { valid: false, row, errors: ['Camp date is required'] };
  }
  return { valid: true, row, errors: [] };
}

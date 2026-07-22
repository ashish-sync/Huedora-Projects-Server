import { CampOpsCamp } from './campOps.model.js';
import { normalizeCampName } from './campOps.constants.js';

export function trimStr(v) {
  return v == null ? '' : String(v).trim();
}

export function escapeRegex(value) {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function parseTimeToMinutes(timeStr) {
  if (!timeStr) return null;
  const parts = String(timeStr).trim().split(':');
  const hours = Number(parts[0]);
  const minutes = Number(parts[1] || 0);
  if (Number.isNaN(hours) || Number.isNaN(minutes)) return null;
  return hours * 60 + minutes;
}

export function formatMinutes(totalMinutes) {
  const normalized = ((totalMinutes % (24 * 60)) + 24 * 60) % (24 * 60);
  const hours = Math.floor(normalized / 60);
  const minutes = normalized % 60;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

export function computeEndTime(startTime, durationHours) {
  const startMinutes = parseTimeToMinutes(startTime);
  if (startMinutes == null || !durationHours) return '';
  return formatMinutes(startMinutes + durationHours * 60);
}

export function computeDurationHours(startTime, endTime) {
  const startMinutes = parseTimeToMinutes(startTime);
  const endMinutes = parseTimeToMinutes(endTime);
  if (startMinutes == null || endMinutes == null) return null;
  let diff = endMinutes - startMinutes;
  if (diff <= 0) diff += 24 * 60;
  const hours = diff / 60;
  if (hours <= 0) return null;
  return Math.max(1, Math.min(12, Math.round(hours * 100) / 100));
}

export function resolveCampSchedule({
  startTime = '09:00',
  endTime = '',
  durationHours = null,
} = {}) {
  const start = trimStr(startTime) || '09:00';
  const end = trimStr(endTime);

  if (end) {
    const computedDuration = computeDurationHours(start, end);
    return {
      startTime: start,
      endTime: end,
      durationHours: computedDuration ?? (Number(durationHours) || 3),
    };
  }

  const duration = Number(durationHours) || 3;
  return {
    startTime: start,
    endTime: computeEndTime(start, duration),
    durationHours: duration,
  };
}

export function parseLocalDateInput(value) {
  const text = trimStr(value);
  if (!text) return null;

  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(text);
  const dmy = /^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})$/.exec(text);

  let year;
  let month;
  let day;

  if (iso) {
    year = Number(iso[1]);
    month = Number(iso[2]);
    day = Number(iso[3]);
  } else if (dmy) {
    day = Number(dmy[1]);
    month = Number(dmy[2]);
    year = Number(dmy[3]);
    if (year < 100) year += 2000;
  } else {
    const parsed = new Date(text);
    if (Number.isNaN(parsed.getTime())) return null;
    return parsed.toISOString().slice(0, 10);
  }

  const date = new Date(year, month - 1, day);
  if (
    date.getFullYear() !== year ||
    date.getMonth() !== month - 1 ||
    date.getDate() !== day
  ) {
    return null;
  }
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

export function getCampEndDateTime(camp) {
  const dateStr = parseLocalDateInput(camp.campDate) || String(camp.campDate || '').slice(0, 10);
  const end = new Date(`${dateStr}T00:00:00`);
  if (Number.isNaN(end.getTime())) return null;
  const endTime = camp.endTime || computeEndTime(camp.startTime, camp.durationHours);
  const endMinutes = parseTimeToMinutes(endTime);
  if (endMinutes == null) {
    end.setHours(23, 59, 59, 999);
    return end;
  }
  end.setHours(Math.floor(endMinutes / 60), endMinutes % 60, 0, 0);
  return end;
}

export function withCampSchedule(camp) {
  const obj = camp.toObject ? camp.toObject() : { ...camp };
  if (!obj.endTime && obj.startTime && obj.durationHours) {
    obj.endTime = computeEndTime(obj.startTime, obj.durationHours);
  }
  const endsAt = getCampEndDateTime(obj);
  obj.endsAt = endsAt ? endsAt.toISOString() : null;
  obj.timeFrame = obj.durationHours
    ? `${obj.durationHours} hr camp (${obj.startTime || '--:--'} - ${obj.endTime || '--:--'})`
    : `${obj.startTime || '--:--'} - ${obj.endTime || '--:--'}`;
  obj.isOverdue =
    obj.status === 'approved' && endsAt != null && endsAt.getTime() <= Date.now();
  // HueDora-compatible alias
  if (obj.clientId != null && obj.client == null) obj.client = obj.clientId;
  return obj;
}

export function isCampOverdue(camp) {
  return withCampSchedule(camp).isOverdue;
}

export function buildCampFilter(query = {}) {
  const filter = { isDeleted: false };

  const status = trimStr(query.status);
  const client = trimStr(query.client || query.clientId);
  const state = trimStr(query.state);
  const campaignType = trimStr(query.campaignType);
  const search = trimStr(query.search || query.q);

  if (status) filter.status = status;
  if (client) filter.clientId = client;
  if (state) filter.state = state;
  if (campaignType) filter.campaignType = campaignType;

  const dateFrom = parseLocalDateInput(query.dateFrom);
  const dateTo = parseLocalDateInput(query.dateTo);
  if (dateFrom || dateTo) {
    filter.campDate = {};
    if (dateFrom) filter.campDate.$gte = dateFrom;
    if (dateTo) filter.campDate.$lte = dateTo;
  }

  if (search) {
    const regex = new RegExp(escapeRegex(search), 'i');
    filter.$or = [
      { campId: regex },
      { doctorName: regex },
      { hospitalName: regex },
      { clinicName: regex },
      { city: regex },
      { clientName: regex },
      { campaignName: regex },
    ];
  }

  return filter;
}

export async function generateCampId(campDate = new Date()) {
  const date =
    typeof campDate === 'string'
      ? new Date(parseLocalDateInput(campDate) || campDate)
      : new Date(campDate);
  const yy = String(date.getFullYear()).slice(-2);
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const prefix = `${yy}-${mm}-`;
  const rows = CampOpsCamp._all().filter(
    (r) => !r.isDeleted && String(r.campId || '').startsWith(prefix)
  );
  let maxSeq = 0;
  for (const row of rows) {
    const parts = String(row.campId).split('-');
    const seq = Number(parts[2]);
    if (!Number.isNaN(seq) && seq > maxSeq) maxSeq = seq;
  }
  return `${prefix}${String(maxSeq + 1).padStart(4, '0')}`;
}

export function captureSubmissionTracking(now = new Date()) {
  const hour = now.getHours();
  const day = now.getDay();
  return {
    submittedAt: now.toISOString(),
    submittedOffHours: hour < 8 || hour >= 20,
    submittedWeekendAttention: day === 0 || day === 6,
  };
}

export function buildClientCode(name) {
  const base = String(name || '')
    .replace(/[^a-zA-Z0-9]/g, '')
    .toUpperCase()
    .slice(0, 12);
  return base || 'CLIENT';
}

export function groupCount(rows, keyFn) {
  const map = new Map();
  for (const row of rows) {
    const label = keyFn(row) || 'Unknown';
    map.set(label, (map.get(label) || 0) + 1);
  }
  return [...map.entries()]
    .map(([label, value]) => ({ label, value }))
    .sort((a, b) => b.value - a.value);
}

export function extractFieldsFromText(text) {
  const raw = String(text || '');
  const pick = (patterns) => {
    for (const re of patterns) {
      const m = raw.match(re);
      if (m?.[1]) return trimStr(m[1]);
    }
    return '';
  };

  const doctorName = pick([
    /(?:dr\.?\s*name|doctor\s*name)\s*[-:=]+\s*(.+?)(?:\n|$)/i,
    /(?:doctor|dr\.?)\s*[-:=]+\s*([A-Za-z .]+)/i,
    /hcp\s*[-:=]+\s*([A-Za-z .]+)/i,
  ]);
  const doctorCode = pick([
    /(?:dr\.?\s*code|doctor\s*code)\s*[-:=]+\s*(\S+)/i,
  ]);
  const clientName = pick([
    /(?:client|brand|pharma)\s*[-:=]+\s*([A-Za-z0-9 &.-]+)/i,
  ]);
  const city = pick([
    /(?:camp\s*)?city\s*[-:=]+\s*([A-Za-z .]+)/i,
    /city\s*[-:=]+\s*([A-Za-z .]+)/i,
  ]);
  const state = pick([/state\s*[-:=]+\s*([A-Za-z .]+)/i]);
  const pincode = pick([/(?:pin\s*code|pincode)\s*[-:=]+\s*(\d{6})/i, /\b(\d{6})\b/]);
  const campDate = pick([
    /(?:date of the camp|camp\s*date|dates?)\s*[-:=]+\s*(\d{1,2}[\/\-.]\d{1,2}[\/\-.]\d{2,4}|\d{4}-\d{2}-\d{2})/i,
    /(?:^|\n)date\s*[-:=]+\s*(\d{1,2}[\/\-.]\d{1,2}[\/\-.]\d{2,4}|\d{4}-\d{2}-\d{2})/i,
  ]);
  const startTime = pick([
    /start\s*time\s*[-:=]+\s*(\d{1,2}:\d{2})/i,
    /in\s*time\s*[-:=]+\s*(\d{1,2}:\d{2})/i,
    /time\s*[-:=]+\s*(\d{1,2}:\d{2})/i,
  ]);
  const endTime = pick([
    /end\s*time\s*[-:=]+\s*(\d{1,2}:\d{2})/i,
    /out\s*time\s*[-:=]+\s*(\d{1,2}:\d{2})/i,
  ]);
  const expectedPatients = pick([
    /(?:expected\s*)?patients?\s*[-:=]+\s*(\d+)/i,
    /footfall\s*[-:=]+\s*(\d+)/i,
  ]);
  const campAddress = pick([
    /(?:address\*?|camp\s*address|full clinic address|venue|location)\s*[-:=]+\s*(.+?)(?:\n|$)/i,
  ]);
  const fieldPersonName = pick([
    /(?:field\s*person(?:\s*name)?|mr\s*name|rep(?:resentative)?\s*name)\s*[-:=]+\s*(.+?)(?:\n|$)/i,
  ]);
  const fieldPersonPhone = pick([
    /(?:field\s*person\s*(?:contact|phone|mobile)|contact\s*(?:no|number)?)\s*[-:=]+\s*([\d+\s-]{8,})/i,
    /(?:mobile|phone)\s*[-:=]+\s*([\d+\s-]{8,})/i,
  ]);
  const campaignName = normalizeCampName(
    pick([
      /(?:camp\s*name|camp\s*type|campaign)\s*[-:=]+\s*([A-Za-z0-9 &]+)/i,
    ])
  );
  const campaignType = pick([
    /(?:division|therapy|campaign\s*type|program)\s*[-:=]+\s*([A-Za-z0-9 &.-]+)/i,
  ]);

  return {
    clientName,
    campaignName: campaignName || 'BMD',
    campaignType: campaignType || 'Screening',
    doctorName,
    doctorCode,
    campAddress,
    city,
    state,
    pincode,
    campDate: parseLocalDateInput(campDate) || campDate,
    startTime: startTime || '09:00',
    endTime,
    expectedPatients: expectedPatients ? Number(expectedPatients) : 0,
    fieldPersonName,
    fieldPersonPhone,
    remarks: '',
    rawExcerpt: raw.slice(0, 500),
  };
}

export function mapImportRows(rows, mapping, defaultClientName = '') {
  return (rows || []).map((row, index) => {
    const mapped = { rowNumber: index + 2 };
    for (const [key, header] of Object.entries(mapping || {})) {
      mapped[key] = header != null ? trimStr(row[header] ?? row[key] ?? '') : '';
    }
    if (!mapped.clientName && defaultClientName) mapped.clientName = defaultClientName;
    return mapped;
  });
}

export function validateMappedImportRows(rows) {
  const validRows = [];
  const invalidRows = [];

  for (const row of rows) {
    const errors = [];
    if (!trimStr(row.clientName)) errors.push('Client name is required');
    if (!trimStr(row.campDate)) errors.push('Camp date is required');
    const campDate = parseLocalDateInput(row.campDate);
    if (trimStr(row.campDate) && !campDate) errors.push('Camp date is invalid');

    const expectedPatients =
      row.expectedPatients === '' || row.expectedPatients == null
        ? 0
        : Number(row.expectedPatients);
    if (Number.isNaN(expectedPatients)) errors.push('Expected patients must be a number');

    const schedule = resolveCampSchedule({
      startTime: trimStr(row.startTime) || '09:00',
      endTime: trimStr(row.endTime),
      durationHours: row.durationHours,
    });

    const normalized = {
      ...row,
      clientName: trimStr(row.clientName),
      campaignName: normalizeCampName(row.campaignName),
      campaignType: trimStr(row.campaignType) || 'Screening',
      doctorName: trimStr(row.doctorName),
      doctorCode: trimStr(row.doctorCode),
      campAddress: trimStr(row.campAddress),
      city: trimStr(row.city),
      state: trimStr(row.state),
      pincode: trimStr(row.pincode),
      campDate,
      startTime: schedule.startTime,
      endTime: schedule.endTime,
      durationHours: schedule.durationHours,
      expectedPatients: expectedPatients || 0,
      fieldPersonName: trimStr(row.fieldPersonName),
      fieldPersonPhone: trimStr(row.fieldPersonPhone),
      remarks: trimStr(row.remarks),
    };

    if (errors.length) invalidRows.push({ ...normalized, errors });
    else validRows.push(normalized);
  }

  return { validRows, invalidRows };
}

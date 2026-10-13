function expandYear(yearPart) {
  const y = String(yearPart || '').trim();
  if (y.length === 4) return Number(y);
  if (y.length === 2) {
    const n = Number(y);
    return n >= 70 ? 1900 + n : 2000 + n;
  }
  return NaN;
}

function parseToDate(value) {
  if (value == null || value === '') return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  const text = String(value).trim();
  if (!text) return null;

  const isoDateTime = /^(\d{4})-(\d{2})-(\d{2})[T\s]/.exec(text);
  if (isoDateTime) {
    const parsed = new Date(text);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (iso) {
    return new Date(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]));
  }

  const compact = text.replace(/\s+/g, '');
  const dmyDash = /^(\d{2})-(\d{2})-(\d{2}|\d{4})$/.exec(compact);
  if (dmyDash) {
    const year = expandYear(dmyDash[3]);
    if (!Number.isNaN(year)) {
      return new Date(year, Number(dmyDash[2]) - 1, Number(dmyDash[1]));
    }
  }

  const dmySlash = /^(\d{2})\/(\d{2})\/(\d{2}|\d{4})$/.exec(compact);
  if (dmySlash) {
    const year = expandYear(dmySlash[3]);
    if (!Number.isNaN(year)) {
      return new Date(year, Number(dmySlash[2]) - 1, Number(dmySlash[1]));
    }
  }

  const parsed = new Date(text);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function formatDate(value) {
  const date = parseToDate(value);
  if (!date) return '-';
  const day = String(date.getDate()).padStart(2, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const year = String(date.getFullYear());
  return `${day}-${month}-${year}`;
}

/**
 * Normalize a clock time (09:00, 9:00 am, 930pm, 6.00 PM) to HH:mm (24-hour).
 * Returns '' when the value cannot be parsed as a time of day.
 */
export function normalizeTimeOfDay(value) {
  const raw = String(value ?? '').replace(/\s+/g, ' ').trim();
  if (!raw) return '';

  let text = raw
    .replace(/\./g, ':')
    .replace(/\b(onwards?|starting|from)\b/gi, '')
    .trim();

  const compact = text.match(/^(\d{1,2})([0-5]\d)\s*(am|pm)?$/i);
  if (compact) {
    text = `${compact[1]}:${compact[2]}${compact[3] ? ` ${compact[3]}` : ''}`;
  }

  const match = text.match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/i);
  if (!match) return '';

  let hours = Number(match[1]);
  const minutes = match[2] != null ? Number(match[2]) : 0;
  const meridiem = match[3]?.toUpperCase();
  if (Number.isNaN(hours) || Number.isNaN(minutes) || minutes > 59) return '';
  if (meridiem === 'PM' && hours < 12) hours += 12;
  if (meridiem === 'AM' && hours === 12) hours = 0;
  if (!meridiem && hours > 23) return '';
  if (hours < 0 || hours > 23) return '';
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

/** Display / export time as HH:mm (24-hour). Accepts Date, ISO datetime, or clock strings. */
export function formatTime(value) {
  if (value == null || value === '') return '';
  const clock = normalizeTimeOfDay(value);
  if (clock) return clock;
  const date = parseToDate(value);
  if (!date) return '';
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

/** Alias — prefer this name when formatting camp start/end columns. */
export const formatTimeOfDay = formatTime;

export function formatDateTime(value) {
  const date = parseToDate(value);
  if (!date) return '-';
  return `${formatDate(date)} ${formatTime(date)}`;
}

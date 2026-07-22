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

  const dmyDash = /^(\d{2})-(\d{2})-(\d{2}|\d{4})$/.exec(text);
  if (dmyDash) {
    const year = expandYear(dmyDash[3]);
    if (!Number.isNaN(year)) {
      return new Date(year, Number(dmyDash[2]) - 1, Number(dmyDash[1]));
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

export function formatTime(value) {
  const date = parseToDate(value);
  if (!date) return '';
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

export function formatDateTime(value) {
  const date = parseToDate(value);
  if (!date) return '-';
  return `${formatDate(date)} ${formatTime(date)}`;
}

function trimStr(value) {
  return value == null ? '' : String(value).replace(/\s+/g, ' ').trim();
}

/**
 * Normalize camp start/end tokens from paste (9AM, 9:00 am, 930am, 08.30) → HH:mm.
 * Returns '' when the value cannot be normalized (never invents a time).
 */
export function normalizePasteStartTime(value) {
  const raw = trimStr(value);
  if (!raw) return '';

  let text = raw
    .replace(/\./g, ':')
    .replace(/\s+/g, ' ')
    .trim();

  // Strip trailing "onwards" / "starting" noise from free-form timing lines.
  text = text.replace(/\b(onwards?|starting|from)\b/gi, '').trim();

  // 930am / 930 am
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

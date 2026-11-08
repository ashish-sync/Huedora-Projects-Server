/** TYLO One business-calendar timezone. Keep date-only camp fields timezone-free. */
export const IST_TIME_ZONE = 'Asia/Kolkata';

const FORMATTER = new Intl.DateTimeFormat('en-GB', {
  timeZone: IST_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  hourCycle: 'h23',
  weekday: 'short',
});

export function istDateTimeParts(now = new Date()) {
  const values = Object.fromEntries(
    FORMATTER.formatToParts(new Date(now))
      .filter((part) => part.type !== 'literal')
      .map((part) => [part.type, part.value]),
  );
  return {
    year: Number(values.year),
    month: Number(values.month),
    day: Number(values.day),
    hour: Number(values.hour),
    weekday: values.weekday,
  };
}

export function istTodayIso(now = new Date()) {
  const { year, month, day } = istDateTimeParts(now);
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

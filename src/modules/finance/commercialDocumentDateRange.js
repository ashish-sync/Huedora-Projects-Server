function isoDay(value) {
  const match = /^(\d{4}-\d{2}-\d{2})/.exec(String(value || '').trim());
  return match ? match[1] : '';
}

/** Inclusive documentDate range for Saved Documents list/export. */
export function commercialDocumentDateRange(dateFrom, dateTo) {
  let from = isoDay(dateFrom);
  let to = isoDay(dateTo);
  if (from && to && from > to) {
    const swap = from;
    from = to;
    to = swap;
  }
  if (!from && !to) return null;
  const range = {};
  if (from) range.$gte = from;
  if (to) range.$lte = `${to}T23:59:59.999`;
  return range;
}

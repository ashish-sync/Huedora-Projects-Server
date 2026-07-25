export function trimValue(value) {
  return typeof value === 'string' ? value.trim() : value;
}

export function trimDeep(value) {
  if (typeof value === 'string') return value.trim();
  if (Array.isArray(value)) return value.map(trimDeep);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, trimDeep(item)])
    );
  }
  return value;
}

export function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

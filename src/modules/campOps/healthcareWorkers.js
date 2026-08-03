/**
 * Client Master Healthcare Worker may be stored as a string (legacy) or string[].
 * Returns unique trimmed role labels.
 */
export function normalizeHealthcareWorkers(value) {
  const parts = Array.isArray(value)
    ? value
    : String(value ?? '')
      .split(/[,;|]/)
      .map((part) => String(part || '').trim())
      .filter(Boolean);

  const seen = new Set();
  const out = [];
  for (const part of parts) {
    const label = String(part || '').trim();
    if (!label) continue;
    const key = label.toLowerCase() === 'dietician' || label.toLowerCase() === 'dietitian'
      ? 'dietitian'
      : label.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(label);
  }
  return out;
}

export function formatHealthcareWorkers(value) {
  return normalizeHealthcareWorkers(value).join(', ');
}

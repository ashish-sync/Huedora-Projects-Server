/** Canonical picklists for Contact Directory */

export const RESOURCE_TYPES = [
  'Individual',
  'Freelancer',
  'Contractual',
  'Retainer',
  'Full Timer',
  'Service Provider',
];

export const PROFESSIONS = [
  'MIS Executive',
  'Camp Coordinator',
  'Technician',
  'Phlebotomist',
  'Dietician',
];

/** Loose match for Excel imports (case / spacing) */
export function matchPicklist(value, options) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  const norm = raw.toLowerCase().replace(/[\s_-]+/g, '');
  const found = options.find((o) => o.toLowerCase().replace(/[\s_-]+/g, '') === norm);
  if (found) return found;
  // common typos / aliases
  const aliases = {
    contratual: 'Contractual',
    contractual: 'Contractual',
    fulltimer: 'Full Timer',
    'full-time': 'Full Timer',
    fulltime: 'Full Timer',
    serviceprovider: 'Service Provider',
    deitician: 'Dietician',
    dietician: 'Dietician',
    dietitian: 'Dietician',
  };
  return aliases[norm] || raw;
}

/** Camp Management — process mapping & slot rules */

export const CAMP_METHODS = ['Diagnostic', 'Physio & Neuro', 'BMD', 'Uroflow', 'Dietitian'];

/**
 * Method → Process → Camp Type
 */
export const CAMP_PROCESS_MAP = [
  { method: 'Diagnostic', process: 'NT PRO - BNP', campType: 'Non Device' },
  { method: 'Diagnostic', process: 'Lipidocare', campType: 'Device' },
  { method: 'Diagnostic', process: 'Vitamin D3', campType: 'Device' },
  { method: 'Physio & Neuro', process: 'Neuro', campType: 'Device' },
  { method: 'BMD', process: 'BMD', campType: 'Device' },
  { method: 'Uroflow', process: 'Uroflow', campType: 'Device' },
  { method: 'Dietitian', process: 'Dietitian', campType: 'Non Device' },
];

export const CAMP_TYPES = ['Device', 'Non Device'];

export const CAMP_STATUSES = ['Pending', 'Approved', 'Declined'];

export const CAMP_SLOTS = ['Morning', 'Noon', 'Evening'];

/**
 * Derive camp type from method + process.
 * @returns {string|null}
 */
export function resolveCampType(method, process) {
  const row = CAMP_PROCESS_MAP.find((r) => r.method === method && r.process === process);
  return row?.campType || null;
}

/**
 * Processes available for a method.
 */
export function processesForMethod(method) {
  return CAMP_PROCESS_MAP.filter((r) => r.method === method).map((r) => r.process);
}

/**
 * Camp Slot from start time (local HH:MM or HH:MM:SS).
 * 6:00 AM – 12:59 PM → Morning
 * 1:00 PM – 4:59 PM → Noon
 * 5:00 PM – 10:00 PM → Evening
 */
export function resolveCampSlot(startTime) {
  if (!startTime) return null;
  const raw = String(startTime).trim();
  const match = raw.match(/^(\d{1,2}):(\d{2})/);
  if (!match) return null;
  const h = Number(match[1]);
  const m = Number(match[2]);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return null;
  const mins = h * 60 + m;
  if (mins >= 6 * 60 && mins <= 12 * 60 + 59) return 'Morning';
  if (mins >= 13 * 60 && mins <= 16 * 60 + 59) return 'Noon';
  if (mins >= 17 * 60 && mins <= 22 * 60) return 'Evening';
  return null;
}

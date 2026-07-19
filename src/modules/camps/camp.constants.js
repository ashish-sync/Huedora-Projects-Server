/** Camp Management — process mapping, slots, schedule helpers */

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

/** Full lifecycle (ported from HueDora camp ops, TYLO naming) */
export const CAMP_STATUSES = ['Pending', 'Approved', 'Declined', 'Completed', 'Cancelled'];

export const CAMP_SLOTS = ['Morning', 'Noon', 'Evening'];

export const CAMP_DURATION_OPTIONS = [3, 4, 5, 6, 8];

export const CAMP_CANCEL_SOURCES = ['Brand', 'Ops'];

export const CAMP_STATUS_TRANSITIONS = {
  Pending: ['Approved', 'Declined'],
  Approved: ['Completed', 'Cancelled'],
  Declined: [],
  Completed: [],
  Cancelled: [],
};

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

export function parseTimeToMinutes(timeStr) {
  if (!timeStr) return null;
  const match = String(timeStr).trim().match(/^(\d{1,2}):(\d{2})/);
  if (!match) return null;
  return Number(match[1]) * 60 + Number(match[2]);
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
  return formatMinutes(startMinutes + Number(durationHours) * 60);
}

export function resolveCampSchedule({
  startTime = '09:00',
  endTime = '',
  durationHours = null,
} = {}) {
  const start = String(startTime || '09:00').trim() || '09:00';
  const end = String(endTime || '').trim();
  const duration = Number(durationHours) || 3;

  if (end && !durationHours) {
    const a = parseTimeToMinutes(start);
    const b = parseTimeToMinutes(end);
    let hours = 3;
    if (a != null && b != null && b > a) {
      hours = Math.max(1, Math.min(12, Math.round(((b - a) / 60) * 100) / 100));
    }
    return { startTime: start, endTime: end, durationHours: hours };
  }

  return {
    startTime: start,
    endTime: end || computeEndTime(start, duration),
    durationHours: duration,
  };
}

/** Approved camp whose end datetime is in the past (not yet Completed/Cancelled) */
export function isCampScheduleOverdue(camp, now = new Date()) {
  if (!camp || camp.status !== 'Approved') return false;
  const date = String(camp.campDate || '').trim();
  if (!date) return false;
  const endTime =
    camp.endTime || computeEndTime(camp.startTime, camp.durationHours) || '23:59';
  const end = new Date(`${date}T${endTime.length === 5 ? `${endTime}:00` : endTime}`);
  if (Number.isNaN(end.getTime())) return false;
  return end.getTime() <= now.getTime();
}

export function canTransitionCamp(from, to) {
  return (CAMP_STATUS_TRANSITIONS[from] || []).includes(to);
}

/**
 * Build / create a calendar To-Do for the user who schedules a Training Request.
 */

const MAX_TITLE = 160;
const DEFAULT_DURATION_MS = 60 * 60 * 1000;

function trimLine(value) {
  return String(value || '').trim();
}

/**
 * @param {object} row - AssetRequest (post-process or pre-patch merged)
 * @param {{ scheduledAt?: string, scheduleVenue?: string }} [schedule]
 * @returns {{ kind: string, title: string, body: string, startAt: string, endAt: string } | null}
 */
export function buildTrainingTodoPayload(row = {}, schedule = {}) {
  const scheduledAt = trimLine(schedule.scheduledAt || row.scheduledAt);
  if (!scheduledAt) return null;
  const start = new Date(scheduledAt);
  if (!Number.isFinite(start.getTime())) return null;

  const requestNumber = trimLine(row.requestNumber) || trimLine(row._id) || 'Training';
  const topic = trimLine(row.trainingTopic || row.trainingName);
  let title = topic ? `Training · ${requestNumber} · ${topic}` : `Training · ${requestNumber}`;
  if (title.length > MAX_TITLE) title = title.slice(0, MAX_TITLE).trim();

  const venue = trimLine(schedule.scheduleVenue || row.scheduleVenue);
  const trainee = trimLine(row.traineeName);
  const mode = trimLine(row.trainingMode);
  const bodyParts = [
    requestNumber ? `Request: ${requestNumber}` : '',
    topic ? `Topic: ${topic}` : '',
    trainee ? `Trainee: ${trainee}` : '',
    venue ? `Venue / trainer: ${venue}` : '',
    mode ? `Mode: ${mode}` : '',
  ].filter(Boolean);

  return {
    kind: 'task',
    title,
    body: bodyParts.join('\n'),
    startAt: start.toISOString(),
    endAt: new Date(start.getTime() + DEFAULT_DURATION_MS).toISOString(),
  };
}

/** Prefer the actor who marked the training FULFILLED (Schedule click). */
export function schedulerIdFromRow(row = {}) {
  const updates = Array.isArray(row.hiringUpdates) ? [...row.hiringUpdates].reverse() : [];
  const fulfilled = updates.find(
    (u) =>
      String(u?.progress || '').toUpperCase() === 'FULFILLED' &&
      String(u?.kind || '').toUpperCase() === 'STATUS' &&
      u?.actorId
  );
  return String(
    fulfilled?.actorId || row.fulfilledById || row.approverId || row.requestorId || ''
  ).trim();
}

/**
 * Create a To-Do for the scheduler. Returns calendar event id or ''.
 * Never throws — callers must not fail Schedule if calendar fails.
 */
export async function createTrainingTodoForScheduler({
  row,
  schedule,
  ownerId,
  actor,
  createEvent,
  log = console,
}) {
  const payload = buildTrainingTodoPayload(row, schedule);
  const resolvedOwner = String(ownerId || schedulerIdFromRow(row) || '').trim();
  if (!payload || !resolvedOwner || typeof createEvent !== 'function') return '';
  try {
    const event = await createEvent(resolvedOwner, payload, actor);
    const id = String(event?._id || event?.id || '').trim();
    return id;
  } catch (err) {
    log?.error?.('[asset-requests] Failed to create training To-Do', {
      requestId: row?._id,
      requestNumber: row?.requestNumber,
      message: err?.message || String(err),
    });
    return '';
  }
}

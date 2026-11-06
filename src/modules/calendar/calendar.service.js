import { AppError } from '../../utils/helpers.js';
import { User } from '../users/user.model.js';
import { notifyUser, notifyEvent } from '../notifications/notifyEvent.js';
import { CalendarEvent } from './calendar.model.js';

const MAX_TITLE = 160;
const MAX_BODY = 2000;
const KINDS = new Set(['task', 'block', 'availability_request']);

export function asId(value) {
  return String(value || '').trim();
}

function toIso(value) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
}

function overlapsRange(event, fromIso, toIso) {
  const start = new Date(event.startAt || 0).getTime();
  const end = new Date(event.endAt || event.startAt || 0).getTime();
  const from = fromIso ? new Date(fromIso).getTime() : -Infinity;
  const to = toIso ? new Date(toIso).getTime() : Infinity;
  if (Number.isNaN(start) || Number.isNaN(end)) return false;
  return start <= to && end >= from;
}

export function serializeUserLite(user) {
  if (!user) return null;
  return {
    id: asId(user._id || user.id),
    fullName: String(user.fullName || user.username || user.email || 'User').trim(),
    email: String(user.email || '').trim(),
    designation: String(user.designation || '').trim(),
  };
}

export function serializeEvent(event, { people = new Map(), currentUserId = '' } = {}) {
  if (!event) return null;
  const ownerId = asId(event.ownerId);
  const participantIds = (event.participantIds || []).map(asId);
  const selfId = asId(currentUserId);
  return {
    id: asId(event._id),
    kind: event.kind || 'task',
    ownerId,
    owner: people.get(ownerId) || null,
    participantIds,
    participants: participantIds.map((id) => people.get(id)).filter(Boolean),
    title: String(event.title || ''),
    body: String(event.body || ''),
    startAt: event.startAt || null,
    endAt: event.endAt || null,
    allDay: Boolean(event.allDay),
    status: event.status || 'open',
    suggestedStartAt: event.suggestedStartAt || null,
    suggestedEndAt: event.suggestedEndAt || null,
    responseNote: String(event.responseNote || ''),
    reminderAt: event.reminderAt || null,
    canRespond:
      event.kind === 'availability_request' &&
      event.status === 'pending' &&
      participantIds.includes(selfId) &&
      ownerId !== selfId,
    canEdit: ownerId === selfId,
    createdAt: event.createdAt || null,
    updatedAt: event.updatedAt || null,
  };
}

async function loadPeople(ids = []) {
  const unique = [...new Set(ids.map(asId).filter(Boolean))];
  if (!unique.length) return new Map();
  const rows = await User.find({
    _id: { $in: unique },
    isDeleted: { $ne: true },
  }).select('fullName email username designation');
  const map = new Map();
  for (const row of rows) map.set(asId(row._id), serializeUserLite(row));
  return map;
}

export async function listDirectory(currentUserId, { q = '' } = {}) {
  const selfId = asId(currentUserId);
  const query = String(q || '').trim().toLowerCase();
  const rows = await User.find({
    isDeleted: { $ne: true },
    isActive: { $ne: false },
  })
    .select('fullName email username designation')
    .sort({ fullName: 1 })
    .limit(200);
  return rows
    .map(serializeUserLite)
    .filter((user) => user && user.id !== selfId)
    .filter((user) => {
      if (!query) return true;
      return `${user.fullName} ${user.email} ${user.designation}`.toLowerCase().includes(query);
    });
}

async function loadVisibleEvents(userId) {
  const selfId = asId(userId);
  const rows = await CalendarEvent.find({
    isDeleted: { $ne: true },
    $or: [{ ownerId: selfId }, { participantIds: { $in: [selfId] } }],
  }).sort({ startAt: 1 });
  return rows;
}

export async function listEvents(userId, { from, to, kind } = {}) {
  const selfId = asId(userId);
  let rows = await loadVisibleEvents(selfId);
  if (from || to) {
    rows = rows.filter((row) => overlapsRange(row, from, to));
  }
  if (kind) {
    const kinds = String(kind)
      .split(',')
      .map((k) => k.trim())
      .filter(Boolean);
    if (kinds.length) rows = rows.filter((row) => kinds.includes(row.kind));
  }
  const people = await loadPeople([
    ...rows.map((row) => row.ownerId),
    ...rows.flatMap((row) => row.participantIds || []),
  ]);
  return rows.map((row) => serializeEvent(row, { people, currentUserId: selfId }));
}

export async function summaryCounts(userId) {
  const selfId = asId(userId);
  const rows = await loadVisibleEvents(selfId);
  const openTasks = rows.filter((row) => row.kind === 'task' && row.status === 'open').length;
  const pendingRequests = rows.filter(
    (row) =>
      row.kind === 'availability_request' &&
      row.status === 'pending' &&
      (row.participantIds || []).map(asId).includes(selfId) &&
      asId(row.ownerId) !== selfId,
  ).length;
  return { openTasks, pendingRequests, badge: openTasks + pendingRequests };
}

async function assertActiveUsers(ids) {
  const unique = [...new Set(ids.map(asId).filter(Boolean))];
  if (!unique.length) return [];
  const rows = await User.find({
    _id: { $in: unique },
    isDeleted: { $ne: true },
    isActive: { $ne: false },
  }).select('_id');
  if (rows.length !== unique.length) {
    throw new AppError('One or more colleagues were not found or are inactive', 404, 'NOT_FOUND');
  }
  return unique;
}

function validateTimes(startAt, endAt) {
  const start = toIso(startAt);
  if (!start) throw new AppError('startAt is required and must be a valid date/time', 400, 'VALIDATION_ERROR');
  const end = toIso(endAt) || start;
  if (new Date(end).getTime() < new Date(start).getTime()) {
    throw new AppError('endAt must be on or after startAt', 400, 'VALIDATION_ERROR');
  }
  return { start, end };
}

async function scheduleReminder(event, actor) {
  if (!event.reminderAt) return null;
  const reminderAt = toIso(event.reminderAt);
  if (!reminderAt) return null;
  const notification = await notifyUser(event.ownerId, {
    type: 'CALENDAR_REMINDER',
    title: `Reminder: ${event.title}`,
    body: event.body || `Scheduled for ${new Date(event.startAt).toLocaleString('en-IN')}`,
    entityType: 'CalendarEvent',
    entityId: asId(event._id),
    scheduledFor: reminderAt,
    deliveredAt: null,
    group: false,
    includeWatchers: false,
    actor,
    module: 'calendar',
    meta: { kind: 'update' },
  });
  if (notification?._id) {
    event.reminderNotificationId = asId(notification._id);
    await event.save();
  }
  return notification;
}

export async function createEvent(userId, payload = {}, actor = null) {
  const selfId = asId(userId);
  const kind = String(payload.kind || 'task').trim();
  if (!KINDS.has(kind)) throw new AppError('Invalid event kind', 400, 'VALIDATION_ERROR');

  const title = String(payload.title || '').trim();
  if (!title) throw new AppError('title is required', 400, 'VALIDATION_ERROR');
  if (title.length > MAX_TITLE) throw new AppError(`title must be ${MAX_TITLE} characters or fewer`, 400, 'VALIDATION_ERROR');

  const body = String(payload.body || payload.note || '').trim().slice(0, MAX_BODY);
  const { start, end } = validateTimes(payload.startAt, payload.endAt);
  const allDay = Boolean(payload.allDay);
  const reminderAt = payload.reminderAt ? toIso(payload.reminderAt) : start;

  let participantIds = [];
  if (Array.isArray(payload.participantIds)) {
    participantIds = await assertActiveUsers(payload.participantIds.filter((id) => asId(id) !== selfId));
  } else if (payload.peerUserId) {
    participantIds = await assertActiveUsers([payload.peerUserId]);
  }

  if ((kind === 'block' || kind === 'availability_request') && !participantIds.length) {
    throw new AppError('Select at least one colleague', 400, 'VALIDATION_ERROR');
  }

  let status = 'open';
  if (kind === 'task') status = 'open';
  else if (kind === 'block') status = 'confirmed';
  else if (kind === 'availability_request') status = 'pending';

  const event = await CalendarEvent.create({
    kind,
    ownerId: selfId,
    participantIds,
    title,
    body,
    startAt: start,
    endAt: end,
    allDay,
    status,
    reminderAt: kind === 'task' ? reminderAt : null,
    createdBy: selfId,
    updatedBy: selfId,
  });

  if (kind === 'task' && reminderAt) {
    await scheduleReminder(event, actor);
  }

  if (kind === 'block') {
    await notifyEvent({
      type: 'CALENDAR_BLOCK',
      title: `Calendar blocked: ${title}`,
      body: body || `${actor?.fullName || 'A colleague'} blocked time on your calendar.`,
      entityType: 'CalendarEvent',
      entityId: asId(event._id),
      recipients: participantIds,
      includeWatchers: false,
      actor,
      module: 'calendar',
      meta: { kind: 'update' },
    });
  }

  if (kind === 'availability_request') {
    await notifyEvent({
      type: 'CALENDAR_AVAILABILITY_REQUEST',
      title: `Availability request: ${title}`,
      body:
        body ||
        `${actor?.fullName || 'A colleague'} requested your availability on ${new Date(start).toLocaleString('en-IN')}.`,
      entityType: 'CalendarEvent',
      entityId: asId(event._id),
      recipients: participantIds,
      includeWatchers: false,
      actor,
      module: 'calendar',
      meta: { kind: 'approval' },
    });
  }

  const people = await loadPeople([selfId, ...participantIds]);
  return serializeEvent(event, { people, currentUserId: selfId });
}

async function getOwnedOrShared(eventId, userId) {
  const event = await CalendarEvent.findById(asId(eventId));
  if (!event || event.isDeleted) throw new AppError('Event not found', 404, 'NOT_FOUND');
  const selfId = asId(userId);
  const participants = (event.participantIds || []).map(asId);
  if (asId(event.ownerId) !== selfId && !participants.includes(selfId)) {
    throw new AppError('You do not have access to this event', 403, 'FORBIDDEN');
  }
  return event;
}

export async function updateEvent(userId, eventId, payload = {}, actor = null) {
  const event = await getOwnedOrShared(eventId, userId);
  const selfId = asId(userId);
  if (asId(event.ownerId) !== selfId) {
    throw new AppError('Only the owner can edit this event', 403, 'FORBIDDEN');
  }

  if (payload.title !== undefined) {
    const title = String(payload.title || '').trim();
    if (!title) throw new AppError('title is required', 400, 'VALIDATION_ERROR');
    event.title = title.slice(0, MAX_TITLE);
  }
  if (payload.body !== undefined || payload.note !== undefined) {
    event.body = String(payload.body ?? payload.note ?? '').trim().slice(0, MAX_BODY);
  }
  if (payload.startAt || payload.endAt) {
    const { start, end } = validateTimes(payload.startAt || event.startAt, payload.endAt || event.endAt);
    event.startAt = start;
    event.endAt = end;
  }
  if (payload.allDay !== undefined) event.allDay = Boolean(payload.allDay);
  if (payload.status !== undefined && event.kind === 'task') {
    const status = String(payload.status);
    if (!['open', 'done', 'cancelled'].includes(status)) {
      throw new AppError('Invalid task status', 400, 'VALIDATION_ERROR');
    }
    event.status = status;
  }
  if (payload.reminderAt !== undefined && event.kind === 'task') {
    event.reminderAt = payload.reminderAt ? toIso(payload.reminderAt) : null;
  }
  event.updatedBy = selfId;
  await event.save();

  if (event.kind === 'task' && payload.reminderAt) {
    await scheduleReminder(event, actor);
  }

  const people = await loadPeople([event.ownerId, ...(event.participantIds || [])]);
  return serializeEvent(event, { people, currentUserId: selfId });
}

export async function deleteEvent(userId, eventId) {
  const event = await getOwnedOrShared(eventId, userId);
  if (asId(event.ownerId) !== asId(userId)) {
    throw new AppError('Only the owner can delete this event', 403, 'FORBIDDEN');
  }
  event.isDeleted = true;
  event.deletedAt = new Date().toISOString();
  event.deletedBy = asId(userId);
  event.status = 'cancelled';
  event.updatedBy = asId(userId);
  await event.save();
  return { id: asId(event._id), deleted: true };
}

async function assertInvitee(event, userId) {
  const selfId = asId(userId);
  if (event.kind !== 'availability_request') {
    throw new AppError('Only availability requests can be answered', 400, 'VALIDATION_ERROR');
  }
  if (event.status !== 'pending') {
    throw new AppError('This request has already been answered', 409, 'CONFLICT');
  }
  const participants = (event.participantIds || []).map(asId);
  if (!participants.includes(selfId)) {
    throw new AppError('You are not invited to this request', 403, 'FORBIDDEN');
  }
  return selfId;
}

export async function acceptRequest(userId, eventId, payload = {}, actor = null) {
  const event = await getOwnedOrShared(eventId, userId);
  await assertInvitee(event, userId);
  event.status = 'accepted';
  event.responseNote = String(payload.note || '').trim().slice(0, MAX_BODY);
  event.updatedBy = asId(userId);
  await event.save();

  await notifyUser(event.ownerId, {
    type: 'CALENDAR_ACCEPTED',
    title: `Availability accepted: ${event.title}`,
    body: event.responseNote || `${actor?.fullName || 'Colleague'} accepted your availability request.`,
    entityType: 'CalendarEvent',
    entityId: asId(event._id),
    includeWatchers: false,
    actor,
    module: 'calendar',
    meta: { kind: 'update' },
  });

  const people = await loadPeople([event.ownerId, ...(event.participantIds || [])]);
  return serializeEvent(event, { people, currentUserId: asId(userId) });
}

export async function declineRequest(userId, eventId, payload = {}, actor = null) {
  const event = await getOwnedOrShared(eventId, userId);
  await assertInvitee(event, userId);
  event.status = 'declined';
  event.responseNote = String(payload.note || '').trim().slice(0, MAX_BODY);
  event.updatedBy = asId(userId);
  await event.save();

  await notifyUser(event.ownerId, {
    type: 'CALENDAR_DECLINED',
    title: `Availability declined: ${event.title}`,
    body: event.responseNote || `${actor?.fullName || 'Colleague'} declined your availability request.`,
    entityType: 'CalendarEvent',
    entityId: asId(event._id),
    includeWatchers: false,
    actor,
    module: 'calendar',
    meta: { kind: 'update' },
  });

  const people = await loadPeople([event.ownerId, ...(event.participantIds || [])]);
  return serializeEvent(event, { people, currentUserId: asId(userId) });
}

export async function suggestAlternative(userId, eventId, payload = {}, actor = null) {
  const event = await getOwnedOrShared(eventId, userId);
  await assertInvitee(event, userId);
  const { start, end } = validateTimes(payload.startAt, payload.endAt);
  event.status = 'suggested';
  event.suggestedStartAt = start;
  event.suggestedEndAt = end;
  event.responseNote = String(payload.note || '').trim().slice(0, MAX_BODY);
  event.updatedBy = asId(userId);
  await event.save();

  await notifyUser(event.ownerId, {
    type: 'CALENDAR_SUGGESTED',
    title: `Alternative suggested: ${event.title}`,
    body:
      event.responseNote ||
      `${actor?.fullName || 'Colleague'} suggested ${new Date(start).toLocaleString('en-IN')} – ${new Date(end).toLocaleString('en-IN')}.`,
    entityType: 'CalendarEvent',
    entityId: asId(event._id),
    includeWatchers: false,
    actor,
    module: 'calendar',
    meta: { kind: 'update' },
  });

  const people = await loadPeople([event.ownerId, ...(event.participantIds || [])]);
  return serializeEvent(event, { people, currentUserId: asId(userId) });
}

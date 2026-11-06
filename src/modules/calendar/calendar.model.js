import { defineCollection } from '../../store/filedb.js';
import { softDelete } from '../common/counter.model.js';

/**
 * Personal tasks, calendar blocks, and availability requests between employees.
 * kind: task | block | availability_request
 */
export const CalendarEvent = defineCollection('calendar_events', {
  ...softDelete,
  kind: 'task',
  ownerId: null,
  participantIds: [],
  title: '',
  body: '',
  startAt: null,
  endAt: null,
  allDay: false,
  /** open | done | cancelled | pending | accepted | declined | suggested | confirmed */
  status: 'open',
  suggestedStartAt: null,
  suggestedEndAt: null,
  responseNote: '',
  reminderAt: null,
  reminderNotificationId: null,
  createdBy: null,
  updatedBy: null,
});

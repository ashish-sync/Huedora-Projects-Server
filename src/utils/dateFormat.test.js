import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  formatDate,
  formatDateTime,
  formatTime,
  normalizeTimeOfDay,
} from './dateFormat.js';

describe('dateFormat standards', () => {
  it('formats dates as DD-MM-YYYY', () => {
    assert.equal(formatDate('2026-08-15'), '15-08-2026');
    assert.equal(formatDate('15/08/2026'), '15-08-2026');
  });

  it('normalizes mixed clock strings to 24-hour HH:mm', () => {
    assert.equal(normalizeTimeOfDay('20:30'), '20:30');
    assert.equal(normalizeTimeOfDay('11:00 AM'), '11:00');
    assert.equal(normalizeTimeOfDay('6:00 PM'), '18:00');
    assert.equal(normalizeTimeOfDay('9AM'), '09:00');
    assert.equal(formatTime('11:00 AM'), '11:00');
    assert.equal(formatTime('6:00 PM'), '18:00');
  });

  it('formats datetimes as DD-MM-YYYY HH:mm', () => {
    assert.match(formatDateTime('2026-08-15T14:30:00'), /^15-08-2026 14:30$/);
  });
});

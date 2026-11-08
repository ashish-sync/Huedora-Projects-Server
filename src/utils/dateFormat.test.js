import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  TIME_ZONE,
  formatDate,
  formatDateTime,
  formatTime,
  formatTimeOfDay,
  normalizeTimeOfDay,
} from './dateFormat.js';

describe('Standardized Date and Time Formatting (Server)', () => {
  it('enforces Asia/Kolkata timezone standard', () => {
    assert.equal(TIME_ZONE, 'Asia/Kolkata');
  });

  it('formats dates as DD-MM-YYYY', () => {
    assert.equal(formatDate('2026-08-15'), '15-08-2026');
    assert.equal(formatDate('15/08/2026'), '15-08-2026');
    assert.equal(formatDate('08-11-2026'), '08-11-2026');
  });

  it('does not roll US leftover Excel dates into the wrong month', () => {
    assert.equal(formatDate('11/16/26'), '16-11-2026');
    assert.equal(formatDate('16-11-26'), '16-11-2026');
    assert.equal(formatDate('01-12-26'), '01-12-2026');
    assert.equal(formatDate('31-01-27'), '31-01-2027');
  });

  it('formats Date instances and UTC ISO timestamps accurately in Asia/Kolkata', () => {
    // 18:45 UTC is 00:15 next day in IST (UTC+05:30)
    const lateUtc = new Date('2026-11-08T18:45:00Z');
    assert.equal(formatDate(lateUtc), '09-11-2026');
    assert.equal(formatTime(lateUtc), '12:15 AM');
    assert.equal(formatDateTime(lateUtc), '09-11-2026 12:15 AM');
  });

  it('normalizes mixed clock strings to 24-hour HH:mm for storage/inputs', () => {
    assert.equal(normalizeTimeOfDay('20:30'), '20:30');
    assert.equal(normalizeTimeOfDay('11:00 AM'), '11:00');
    assert.equal(normalizeTimeOfDay('6:00 PM'), '18:00');
    assert.equal(normalizeTimeOfDay('9AM'), '09:00');
    assert.equal(normalizeTimeOfDay('09:30'), '09:30');
  });

  it('formats clock strings to hh:mm AM/PM (12-hour zero-padded)', () => {
    assert.equal(formatTime('09:30'), '09:30 AM');
    assert.equal(formatTime('14:30'), '02:30 PM');
    assert.equal(formatTime('11:00 AM'), '11:00 AM');
    assert.equal(formatTime('6:00 PM'), '06:00 PM');
    assert.equal(formatTime('9AM'), '09:00 AM');
    assert.equal(formatTime('930pm'), '09:30 PM');
    assert.equal(formatTime('00:00'), '12:00 AM');
    assert.equal(formatTime('12:00'), '12:00 PM');
    assert.equal(formatTimeOfDay('17:45'), '05:45 PM');
  });

  it('formats datetimes as DD-MM-YYYY hh:mm AM/PM', () => {
    assert.equal(formatDateTime('2026-08-15T09:00:00Z'), '15-08-2026 02:30 PM');
    assert.equal(formatDateTime('2026-08-15 14:30:00'), '15-08-2026 02:30 PM');
  });

  it('handles empty or missing values with fallback', () => {
    assert.equal(formatDate(''), '-');
    assert.equal(formatDate(null), '-');
    assert.equal(formatTime(''), '');
    assert.equal(formatTime(null), '');
    assert.equal(formatDateTime(''), '-');
    assert.equal(formatDateTime(null), '-');
  });
});

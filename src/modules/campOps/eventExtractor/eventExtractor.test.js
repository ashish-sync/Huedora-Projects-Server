import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeEventDate,
  normalizeEventTime,
  normalizeTimeRange,
  normalizeIndianPhones,
  aiEventToCampRow,
  weekdayName,
} from './normalize.js';
import { mergeDeterministicAndAiRows, scoreExtractionConfidence } from './merge.js';
import {
  validateCampExtractionRow,
  deterministicNeedsLlmAssist,
  isGarbageInput,
} from './validate.js';
import { PASTE_FIXTURES } from './fixtures.js';
import { extractManualPasteFields } from '../manualPaste.extract.js';

test('normalizes date formats from the brief to YYYY-MM-DD', () => {
  for (const raw of ['15.08.2026', '15/08/2026', '15-Aug-26', '15 Aug 2026']) {
    const { iso } = normalizeEventDate(raw, { referenceDate: '2026-08-10' });
    assert.equal(iso, '2026-08-15', raw);
  }
});

test('resolves relative dates in Asia/Kolkata against referenceDate', () => {
  assert.equal(
    normalizeEventDate('tomorrow', { referenceDate: '2026-08-10' }).iso,
    '2026-08-11'
  );
  assert.equal(
    normalizeEventDate('today', { referenceDate: '2026-08-10' }).iso,
    '2026-08-10'
  );
});

test('normalizes times without inventing end time', () => {
  assert.equal(normalizeEventTime('08.30 am'), '08:30');
  assert.equal(normalizeEventTime('9AM'), '09:00');
  assert.equal(normalizeEventTime('09:00'), '09:00');
  assert.equal(normalizeEventTime('2.30pm'), '14:30');
  assert.equal(normalizeEventTime('12:00pm'), '12:00');
  const onwards = normalizeTimeRange('9AM onwards');
  assert.equal(onwards.startTime, '09:00');
  assert.equal(onwards.endTime, null);
  const range = normalizeTimeRange('9AM to 1PM');
  assert.equal(range.startTime, '09:00');
  assert.equal(range.endTime, '13:00');
});

test('normalizes +91 phone formats', () => {
  assert.deepEqual(normalizeIndianPhones(['+91 98765 43210', '9876543210']), ['9876543210']);
});

test('DATE_DAY_MISMATCH is reported, not silently corrected', () => {
  // 16/08/2026 is Sunday
  assert.equal(weekdayName('2026-08-16'), 'sunday');
  const result = validateCampExtractionRow({
    campDate: '2026-08-16',
    dayLabel: 'MONDAY',
    doctorName: 'Test',
    campAddress: 'Somewhere',
    startTime: '12:00',
  });
  assert.ok(result.codes.includes('DATE_DAY_MISMATCH'));
  assert.equal(result.status, 'CONFLICT');
});

test('aiEventToCampRow never invents endTime from a single noon time', () => {
  const row = aiEventToCampRow({
    event: { date: '15/08/2026', startTime: '12:00pm', endTime: null, expectedPatients: 10 },
    location: { venue: 'Clinic', city: 'Pune', rawAddress: 'Clinic Pune' },
    people: [{ role: 'Doctor', name: 'Raj', mobileNumbers: ['9876543210'] }],
  }, { referenceDate: '2026-08-10' });
  assert.equal(row.startTime, '12:00');
  assert.equal(row.endTime, '');
});

test('merge keeps deterministic values and records conflicts', () => {
  const merged = mergeDeterministicAndAiRows(
    { doctorName: 'A', campDate: '2026-08-15', startTime: '09:00' },
    { doctorName: 'B', campDate: '2026-08-15', endTime: '12:00', city: 'Pune' },
    { aiHadExplicitEnd: true }
  );
  assert.equal(merged.row.doctorName, 'A');
  assert.equal(merged.row.city, 'Pune');
  assert.equal(merged.row.endTime, '12:00');
  assert.ok(merged.conflicts.some((c) => c.startsWith('doctorName:')));
});

test('merge does not accept invented AI endTime without explicit flag', () => {
  const merged = mergeDeterministicAndAiRows(
    { startTime: '09:00' },
    { endTime: '12:00' },
    { aiHadExplicitEnd: false }
  );
  assert.equal(merged.row.endTime, undefined);
});

test('garbage and completeness gates', () => {
  assert.equal(isGarbageInput('hi'), true);
  assert.equal(isGarbageInput(PASTE_FIXTURES.labeled), false);
  assert.equal(deterministicNeedsLlmAssist({ valid: true }), false);
  assert.equal(deterministicNeedsLlmAssist({
    partial: true,
    creationEligible: true,
    mandatoryMissing: [],
    partialFields: ['endTime', 'doctorCode'],
  }), false);
  assert.equal(deterministicNeedsLlmAssist({
    partial: true,
    creationEligible: false,
    mandatoryMissing: ['pincode'],
    partialFields: ['pincode'],
  }), true);
  assert.equal(deterministicNeedsLlmAssist({
    valid: false,
    partial: false,
    mandatoryMissing: ['doctorName', 'startTime'],
  }), true);
});

test('fixture: labeled sample extracts via deterministic path', () => {
  const { row, display } = extractManualPasteFields(PASTE_FIXTURES.labeled);
  assert.equal(row.doctorName, 'Rajesh Kumar');
  assert.equal(display.startTime, '10:00');
  assert.equal(display.endTime, '14:30');
});

test('fixture: freeform Chennai retains clinic phrase for AI/review', () => {
  assert.match(PASTE_FIXTURES.freeformChennai, /Sri Sarada Clinic Besent Nagar \(Chennai\)/);
  assert.match(PASTE_FIXTURES.freeformChennai, /9AM onwards/);
});

test('fixture: multi-event contains separator and Ballari spelling', () => {
  assert.match(PASTE_FIXTURES.multiEvent, /---/);
  assert.match(PASTE_FIXTURES.multiEvent, /Ballari/);
  assert.match(PASTE_FIXTURES.multiEvent, /Day: MONDAY/);
});

test('fixture: conflict noon has Monday mismatch setup and single noon time', () => {
  assert.match(PASTE_FIXTURES.conflictNoon, /12:00pm/);
  assert.match(PASTE_FIXTURES.conflictNoon, /Day: MONDAY/);
  const row = aiEventToCampRow({
    event: {
      date: '16/08/2026',
      day: 'MONDAY',
      startTime: '12:00pm',
      endTime: null,
    },
    location: { rawAddress: 'Main Road Clinic, Kochi' },
    people: [{ role: 'Doctor', name: 'Suresh Nair', mobileNumbers: ['+91 98765 43210'] }],
  });
  const validation = validateCampExtractionRow({
    ...row,
    dayLabel: 'MONDAY',
  });
  assert.ok(validation.codes.includes('DATE_DAY_MISMATCH'));
  assert.equal(row.endTime, '');
  assert.deepEqual(normalizeIndianPhones(['+91 98765 43210']), ['9876543210']);
});

test('confidence drops when conflicts / AI fill increase', () => {
  const high = scoreExtractionConfidence({ deterministicValid: true, usedLlm: false });
  const low = scoreExtractionConfidence({
    deterministicValid: false,
    usedLlm: true,
    filledByAi: ['a', 'b', 'c'],
    conflicts: ['x'],
    validation: { codes: ['DATE_DAY_MISMATCH'], status: 'CONFLICT' },
  });
  assert.ok(high > low);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  HCW_ASSIGNMENT_GAP_MINUTES,
  findHcwAssignmentGapConflict,
} from './hcwAssignmentGap.js';

const hcw = 'hcw-1';

function camp(overrides = {}) {
  return {
    _id: 'camp-a',
    campId: 'CAMP-A',
    hcwContactId: hcw,
    assignmentDecision: 'assign',
    status: 'approved',
    campDate: '2026-08-15',
    startTime: '08:00',
    endTime: '14:00',
    ...overrides,
  };
}

test('allows next camp at end + 90 minutes (15:30 after 14:00)', () => {
  const conflict = findHcwAssignmentGapConflict(
    camp({ _id: 'camp-b', campId: 'CAMP-B', startTime: '15:30', endTime: '18:00' }),
    [camp()],
  );
  assert.equal(conflict, null);
});

test('blocks next camp before end + 90 minutes', () => {
  const conflict = findHcwAssignmentGapConflict(
    camp({ _id: 'camp-b', campId: 'CAMP-B', startTime: '15:00', endTime: '18:00' }),
    [camp()],
  );
  assert.ok(conflict);
  assert.equal(conflict.earliestStartTime, '15:30');
  assert.equal(conflict.gapMinutes, HCW_ASSIGNMENT_GAP_MINUTES);
  assert.match(
    conflict.message,
    /HCW Schedule Conflict: This HCW has another camp scheduled until 14:00\. A mandatory 1h 30m gap is required, so the earliest available start time is 15:30\./,
  );
});

test('blocks overlapping camps for the same HCW', () => {
  const conflict = findHcwAssignmentGapConflict(
    camp({ _id: 'camp-b', campId: 'CAMP-B', startTime: '12:00', endTime: '16:00' }),
    [camp()],
  );
  assert.ok(conflict);
});

test('ignores other HCWs and other dates', () => {
  assert.equal(
    findHcwAssignmentGapConflict(
      camp({ _id: 'b', startTime: '14:30', endTime: '17:00' }),
      [camp({ hcwContactId: 'other-hcw' })],
    ),
    null,
  );
  assert.equal(
    findHcwAssignmentGapConflict(
      camp({ _id: 'b', startTime: '14:30', endTime: '17:00' }),
      [camp({ campDate: '2026-08-16' })],
    ),
    null,
  );
});

test('ignores cancelled or refused camps', () => {
  assert.equal(
    findHcwAssignmentGapConflict(
      camp({ _id: 'b', startTime: '14:30', endTime: '17:00' }),
      [camp({ status: 'cancelled' })],
    ),
    null,
  );
  assert.equal(
    findHcwAssignmentGapConflict(
      camp({ _id: 'b', startTime: '14:30', endTime: '17:00' }),
      [camp({ assignmentDecision: 'refuse' })],
    ),
    null,
  );
  assert.equal(
    findHcwAssignmentGapConflict(
      camp({ _id: 'b', startTime: '14:30', endTime: '17:00' }),
      [camp({
        status: 'cancelled',
        assignmentDecision: 'assign',
        assignmentStatus: 'Assigned',
      })],
    ),
    null,
  );
  assert.equal(
    findHcwAssignmentGapConflict(
      camp({ _id: 'b', startTime: '14:30', endTime: '17:00' }),
      [camp({ executionStatus: 'Cancelled' })],
    ),
    null,
  );
});

test('example: 8:00–14:00 then 15:29 blocked, 15:30 allowed', () => {
  const existing = [camp()];
  assert.ok(findHcwAssignmentGapConflict(
    camp({ _id: 'b', startTime: '15:29', endTime: '18:00' }),
    existing,
  ));
  assert.equal(findHcwAssignmentGapConflict(
    camp({ _id: 'b', startTime: '15:30', endTime: '18:00' }),
    existing,
  ), null);
});

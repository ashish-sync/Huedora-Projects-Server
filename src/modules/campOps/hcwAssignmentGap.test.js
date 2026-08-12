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

test('allows next camp at end + 30 minutes (14:30 after 14:00)', () => {
  const conflict = findHcwAssignmentGapConflict(
    camp({ _id: 'camp-b', campId: 'CAMP-B', startTime: '14:30', endTime: '18:00' }),
    [camp()],
  );
  assert.equal(conflict, null);
});

test('warns when next camp starts before end + 30 minutes', () => {
  const conflict = findHcwAssignmentGapConflict(
    camp({ _id: 'camp-b', campId: 'CAMP-B', startTime: '14:15', endTime: '18:00' }),
    [camp()],
  );
  assert.ok(conflict);
  assert.equal(conflict.earliestStartTime, '14:30');
  assert.equal(conflict.gapMinutes, HCW_ASSIGNMENT_GAP_MINUTES);
  assert.equal(conflict.softWarning, true);
  assert.match(
    conflict.message,
    /HCW Schedule Conflict: This HCW has another camp scheduled until 14:00\. A 30m gap is recommended, so the earliest available start time is 14:30\./,
  );
  assert.match(conflict.approvalMessage, /Reporting Manager/);
});

test('warns on overlapping camps for the same HCW', () => {
  const conflict = findHcwAssignmentGapConflict(
    camp({ _id: 'camp-b', campId: 'CAMP-B', startTime: '12:00', endTime: '16:00' }),
    [camp()],
  );
  assert.ok(conflict);
});

test('ignores other HCWs and other dates', () => {
  assert.equal(
    findHcwAssignmentGapConflict(
      camp({ _id: 'b', startTime: '14:15', endTime: '17:00' }),
      [camp({ hcwContactId: 'other-hcw' })],
    ),
    null,
  );
  assert.equal(
    findHcwAssignmentGapConflict(
      camp({ _id: 'b', startTime: '14:15', endTime: '17:00' }),
      [camp({ campDate: '2026-08-16' })],
    ),
    null,
  );
});

test('ignores cancelled or refused camps', () => {
  assert.equal(
    findHcwAssignmentGapConflict(
      camp({ _id: 'b', startTime: '14:15', endTime: '17:00' }),
      [camp({ status: 'cancelled' })],
    ),
    null,
  );
  assert.equal(
    findHcwAssignmentGapConflict(
      camp({ _id: 'b', startTime: '14:15', endTime: '17:00' }),
      [camp({ assignmentDecision: 'refuse' })],
    ),
    null,
  );
  assert.equal(
    findHcwAssignmentGapConflict(
      camp({ _id: 'b', startTime: '14:15', endTime: '17:00' }),
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
      camp({ _id: 'b', startTime: '14:15', endTime: '17:00' }),
      [camp({ executionStatus: 'Cancelled' })],
    ),
    null,
  );
});

test('example: 8:00–14:00 then 14:29 warned, 14:30 allowed', () => {
  const existing = [camp()];
  assert.ok(findHcwAssignmentGapConflict(
    camp({ _id: 'b', startTime: '14:29', endTime: '18:00' }),
    existing,
  ));
  assert.equal(findHcwAssignmentGapConflict(
    camp({ _id: 'b', startTime: '14:30', endTime: '18:00' }),
    existing,
  ), null);
});

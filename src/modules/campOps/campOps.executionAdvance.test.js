import assert from 'node:assert/strict';
import {
  applyAssignmentStageOutcome,
  isCampDateDueForExecution,
  promoteAssignedCampToExecutionIfDue,
} from './campOps.lifecycle.js';

function isoOffset(days, now = new Date('2026-08-03T12:00:00')) {
  const date = new Date(now);
  date.setHours(0, 0, 0, 0);
  date.setDate(date.getDate() + days);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

const now = new Date('2026-08-03T12:00:00');

function assignedCamp(campDate) {
  return {
    status: 'approved',
    lifecycleStage: 'assignment',
    assignmentDecision: 'assign',
    assignmentStatus: 'Assigned',
    hcwCategory: 'Technician',
    hcwName: 'Ravi',
    hcwContact: '9999999999',
    hcwContactId: 'hcw-1',
    campDate,
    executionStatus: 'Camp Scheduled',
  };
}

assert.equal(isCampDateDueForExecution({ campDate: isoOffset(2, now) }, now), false);
assert.equal(isCampDateDueForExecution({ campDate: isoOffset(1, now) }, now), true);
assert.equal(isCampDateDueForExecution({ campDate: isoOffset(0, now) }, now), true);

{
  const camp = assignedCamp(isoOffset(5, now));
  applyAssignmentStageOutcome(camp, {
    editingStage: 'assignment',
    assignmentDecision: 'assign',
    hcwCategory: 'Technician',
    hcwName: 'Ravi',
    hcwContact: '9999999999',
  }, now);
  assert.equal(camp.assignmentStatus, 'Assigned');
  assert.equal(camp.lifecycleStage, 'assignment');
}

{
  const camp = assignedCamp(isoOffset(1, now));
  applyAssignmentStageOutcome(camp, {
    editingStage: 'assignment',
    assignmentDecision: 'assign',
    hcwCategory: 'Technician',
    hcwName: 'Ravi',
    hcwContact: '9999999999',
  }, now);
  assert.equal(camp.lifecycleStage, 'execution');
}

{
  const camp = assignedCamp(isoOffset(1, now));
  assert.equal(promoteAssignedCampToExecutionIfDue(camp, now), true);
  assert.equal(camp.lifecycleStage, 'execution');
}

{
  const camp = assignedCamp(isoOffset(3, now));
  assert.equal(promoteAssignedCampToExecutionIfDue(camp, now), false);
  assert.equal(camp.lifecycleStage, 'assignment');
}

{
  // Reassignment must not demote a camp already in Execution.
  const camp = {
    ...assignedCamp(isoOffset(1, now)),
    lifecycleStage: 'execution',
    hcwContactId: 'hcw-1',
  };
  applyAssignmentStageOutcome(camp, {
    editingStage: 'assignment',
    assignmentDecision: 'assign',
    hcwCategory: 'Technician',
    hcwName: 'Anita',
    hcwContact: '8888888888',
    hcwContactId: 'hcw-2',
  }, now);
  assert.equal(camp.lifecycleStage, 'execution');
  assert.equal(camp.assignmentStatus, 'Assigned');
}

console.log('campOps.executionAdvance.test.js: ok');

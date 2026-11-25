import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildProcessOutcome } from './requestProcess.js';

describe('buildProcessOutcome', () => {
  it('requires finance payment ref and amount', () => {
    assert.throws(() => buildProcessOutcome('REIMBURSEMENT', {}), /Payment reference/i);
    assert.throws(
      () => buildProcessOutcome('REIMBURSEMENT', { processReference: 'UTR-1' }),
      /Amount/i
    );
    const out = buildProcessOutcome(
      'REIMBURSEMENT',
      { processReference: 'UTR-1', processAmount: 1200, processRemark: 'Paid' },
      { currency: 'INR' }
    );
    assert.equal(out.patch.processReference, 'UTR-1');
    assert.equal(out.patch.processAmount, 1200);
    assert.equal(out.actionLabel, 'Process');
  });

  it('requires training schedule and venue', () => {
    assert.throws(
      () => buildProcessOutcome('TRAINING', { scheduledAt: '2026-12-01T10:00:00Z' }),
      /Venue/
    );
    const out = buildProcessOutcome('TRAINING', {
      scheduledAt: '2026-12-01T10:00:00Z',
      scheduleVenue: 'Room A',
    });
    assert.equal(out.patch.scheduleVenue, 'Room A');
    assert.equal(out.actionLabel, 'Schedule');
  });

  it('requires goods issue note', () => {
    assert.throws(() => buildProcessOutcome('LOGISTICS', {}), /Issue note/i);
    const out = buildProcessOutcome('LOGISTICS', { issueNote: 'Dispatched via courier' });
    assert.equal(out.patch.processRemark, 'Dispatched via courier');
    assert.equal(out.actionLabel, 'Issue');
  });

  it('requires repair assignee name and phone', () => {
    assert.throws(() => buildProcessOutcome('REPAIR', { assigneeName: 'Ravi' }), /Phone/i);
    const out = buildProcessOutcome('MAINTENANCE', {
      assigneeName: 'Ravi',
      assigneeContact: '9999999999',
    });
    assert.equal(out.patch.assigneeName, 'Ravi');
    assert.equal(out.actionLabel, 'Assign');
  });

  it('requires other completion remark', () => {
    assert.throws(() => buildProcessOutcome('OTHER', {}), /Completion remark/i);
    const out = buildProcessOutcome('OTHER', { processRemark: 'Done' });
    assert.equal(out.patch.processRemark, 'Done');
    assert.equal(out.actionLabel, 'Complete');
  });
});

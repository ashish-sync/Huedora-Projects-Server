import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildProcessOutcome } from './requestProcess.js';

describe('buildProcessOutcome', () => {
  it('requires finance UTR and exact payment amount', () => {
    assert.throws(() => buildProcessOutcome('REIMBURSEMENT', {}), /UTR/i);
    assert.throws(
      () => buildProcessOutcome('REIMBURSEMENT', { processReference: 'UTR-1' }),
      /Exact payment amount/i
    );
    assert.throws(
      () =>
        buildProcessOutcome('REIMBURSEMENT', {
          utr: 'UTR-1',
          processAmount: 0,
        }),
      /greater than zero/i
    );
    const out = buildProcessOutcome(
      'REIMBURSEMENT',
      { utr: 'UTR-1', processAmount: 1200, processRemark: 'Paid' },
      { currency: 'INR' }
    );
    assert.equal(out.patch.processReference, 'UTR-1');
    assert.equal(out.patch.processAmount, 1200);
    assert.equal(out.actionLabel, 'Process');
    assert.match(out.logMessage, /UTR UTR-1/);
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

  it('requires goods issue note, delivery mode, and AWB for Courier', () => {
    assert.throws(() => buildProcessOutcome('LOGISTICS', {}), /Issue note/i);
    assert.throws(
      () => buildProcessOutcome('LOGISTICS', { issueNote: 'Dispatched' }),
      /Mode of delivery/i
    );
    assert.throws(
      () =>
        buildProcessOutcome('LOGISTICS', {
          issueNote: 'Dispatched',
          transportMode: 'Courier',
        }),
      /AWB number/i
    );
    const courier = buildProcessOutcome('LOGISTICS', {
      issueNote: 'Dispatched via courier',
      transportMode: 'Courier',
      awbNumber: 'AWB-123',
    });
    assert.equal(courier.patch.processRemark, 'Dispatched via courier');
    assert.equal(courier.patch.transportMode, 'Courier');
    assert.equal(courier.patch.awbNumber, 'AWB-123');
    assert.equal(courier.actionLabel, 'Issue');

    const hand = buildProcessOutcome(
      'LOGISTICS',
      { issueNote: 'Handed over', deliveryMode: 'Hand Delivery' },
      {}
    );
    assert.equal(hand.patch.transportMode, 'Hand Delivery');
    assert.equal(hand.patch.awbNumber, '');
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

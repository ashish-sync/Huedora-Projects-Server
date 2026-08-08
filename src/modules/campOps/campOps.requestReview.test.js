import test from 'node:test';
import assert from 'node:assert/strict';
import {
  elapsedWorkingMs,
  isReviewOverdue,
  resolveRequestReviewStatus,
  hasIncompleteRequestDetails,
  applyRequestReviewTransition,
} from './campOps.requestReview.js';

/** Fixed local timestamps for deterministic SLA math. */
function atLocal(y, m, d, hour, minute = 0) {
  return new Date(y, m - 1, d, hour, minute, 0, 0);
}

test('elapsedWorkingMs counts only 9–19 window and skips Sundays', () => {
  // Friday 16:00 → Monday 11:00
  // Fri 16–19 = 3h, Sat 9–19 = 10h, Sun skipped, Mon 9–11 = 2h → 15h
  const start = atLocal(2026, 8, 7, 16, 0); // Friday
  const end = atLocal(2026, 8, 10, 11, 0); // Monday
  const ms = elapsedWorkingMs(start, end);
  assert.equal(ms, 15 * 60 * 60 * 1000);
});

test('isReviewOverdue is false within 6 working hours', () => {
  const submitted = atLocal(2026, 8, 10, 9, 0); // Mon 09:00
  const now = atLocal(2026, 8, 10, 14, 59); // Mon 14:59 → 5h59m
  assert.equal(isReviewOverdue(submitted, now), false);
});

test('isReviewOverdue is true at exactly 6 working hours', () => {
  const submitted = atLocal(2026, 8, 10, 9, 0);
  const now = atLocal(2026, 8, 10, 15, 0);
  assert.equal(isReviewOverdue(submitted, now), true);
});

test('resolveRequestReviewStatus: incomplete wins over overdue clock', () => {
  const camp = {
    status: 'pending_review',
    submittedAt: atLocal(2026, 8, 5, 10, 0).toISOString(),
    requestIncomplete: true,
    district: '',
  };
  assert.equal(
    resolveRequestReviewStatus(camp, atLocal(2026, 8, 10, 12, 0)),
    'information_requested',
  );
});

test('resolveRequestReviewStatus: stored information_requested wins', () => {
  const camp = {
    status: 'pending_review',
    submittedAt: atLocal(2026, 8, 10, 10, 0).toISOString(),
    requestReviewStatus: 'information_requested',
    informationRequestNote: 'Need phone',
  };
  assert.equal(
    resolveRequestReviewStatus(camp, atLocal(2026, 8, 10, 11, 0)),
    'information_requested',
  );
});

test('resolveRequestReviewStatus: complete + recent → review_pending', () => {
  const camp = {
    status: 'pending_review',
    submittedAt: atLocal(2026, 8, 10, 10, 0).toISOString(),
    requestReviewStatus: 'review_pending',
    requestIncomplete: false,
    // Enough fields so blockers stay empty for hasIncompleteRequestDetails path
    source: 'dashboard',
    clientName: 'Demo',
    campaignType: 'Screening',
    campaignName: 'BMD',
    campDate: '2026-08-20',
    startTime: '09:00',
    endTime: '12:00',
    doctorName: 'Demo Doctor',
    doctorCode: 'DEMO-X',
    campAddress: '12 MG Road',
    state: 'Maharashtra',
    district: 'Pune',
    city: 'Pune',
    pincode: '411001',
    hq: 'Pune',
    zone: 'West Zone',
    expectedPatients: 50,
    contactPersons: [{ level: 'Territory Manager', name: 'Amit Sharma', phone: '9876543210' }],
  };
  assert.equal(hasIncompleteRequestDetails(camp), false);
  assert.equal(
    resolveRequestReviewStatus(camp, atLocal(2026, 8, 10, 12, 0)),
    'review_pending',
  );
});

test('resolveRequestReviewStatus: complete + past SLA → review_overdue', () => {
  const camp = {
    status: 'pending_review',
    submittedAt: atLocal(2026, 8, 5, 10, 0).toISOString(),
    requestIncomplete: false,
    source: 'dashboard',
    clientName: 'Demo',
    campaignType: 'Screening',
    campaignName: 'BMD',
    campDate: '2026-08-20',
    startTime: '09:00',
    endTime: '12:00',
    doctorName: 'Demo Doctor',
    doctorCode: 'DEMO-X',
    campAddress: '12 MG Road',
    state: 'Maharashtra',
    district: 'Pune',
    city: 'Pune',
    pincode: '411001',
    hq: 'Pune',
    zone: 'West Zone',
    expectedPatients: 50,
    contactPersons: [{ level: 'Territory Manager', name: 'Amit Sharma', phone: '9876543210' }],
  };
  assert.equal(
    resolveRequestReviewStatus(camp, atLocal(2026, 8, 10, 12, 0)),
    'review_overdue',
  );
});

test('resolveRequestReviewStatus maps approved/rejected', () => {
  assert.equal(resolveRequestReviewStatus({ status: 'approved' }), 'request_approved');
  assert.equal(resolveRequestReviewStatus({ status: 'rejected' }), 'request_rejected');
});

test('applyRequestReviewTransition resets clock on resubmit after info request', () => {
  const camp = {
    requestReviewStatus: 'information_requested',
    informationRequestNote: 'Need phone',
    informationRequestedAt: '2026-08-01T10:00:00.000Z',
    reviewOverdueAt: '2026-08-02T10:00:00.000Z',
  };
  applyRequestReviewTransition(camp, 'submit');
  assert.equal(camp.requestReviewStatus, 'review_pending');
  assert.equal(camp.informationRequestNote, '');
  assert.equal(camp.informationRequestedAt, null);
  assert.equal(camp.reviewOverdueAt, null);
});

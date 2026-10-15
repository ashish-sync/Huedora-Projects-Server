import test from 'node:test';
import assert from 'node:assert/strict';
import {
  applyReturnCampFromPayoutQueue,
  canReturnCampFromPayoutQueue,
  normalizePayoutReturnKey,
  CAMP_PAYOUT_RETURN_CLEAR_KEYS,
} from './campPayoutReturn.js';
import { mergeDocumentFields } from '../../store/dataIntegrity.js';

test('normalizePayoutReturnKey collapses spaces and en-dashes', () => {
  assert.equal(
    normalizePayoutReturnKey('Lead – Technology & Process Implementation'),
    'lead - technology & process implementation',
  );
});

test('Admin wildcard can return camps from payout queue', () => {
  assert.equal(canReturnCampFromPayoutQueue({ email: 'x@y.com' }, new Set(['*'])), true);
});

test('Accounts role or designation can return', () => {
  assert.equal(
    canReturnCampFromPayoutQueue({ roles: [{ name: 'Accounts' }] }, new Set(['finance:write'])),
    true,
  );
  assert.equal(
    canReturnCampFromPayoutQueue({ designation: 'Accounts' }, new Set(['finance:write'])),
    true,
  );
});

test('Lead Technology designation can return (en-dash)', () => {
  assert.equal(
    canReturnCampFromPayoutQueue(
      { designation: 'Lead – Technology & Process Implementation' },
      new Set(['finance:write']),
    ),
    true,
  );
});

test('Zohra by email or name can return', () => {
  assert.equal(
    canReturnCampFromPayoutQueue({ email: 'zohra@tylocare.com' }, new Set(['finance:write'])),
    true,
  );
  assert.equal(
    canReturnCampFromPayoutQueue({ fullName: 'Zohra Sawant' }, new Set(['finance:write'])),
    true,
  );
});

test('Camp Coordinator finance:write alone cannot return', () => {
  assert.equal(
    canReturnCampFromPayoutQueue(
      { designation: 'Healthcare Camp Coordinator', roles: [{ name: 'Camp Coordinator' }] },
      new Set(['finance:write', 'camps:request']),
    ),
    false,
  );
});

test('applyReturnCampFromPayoutQueue restores Pending Confirmation like post-Execution', () => {
  const camp = {
    submittedToFinanceAt: '2026-10-01T00:00:00.000Z',
    submittedToFinanceById: 'u1',
    submittedToFinanceByEmail: 'a@b.com',
    financePaymentStatus: 'under_review',
    paymentSubmitStatus: 'payment_confirmed',
    lifecycleStage: 'financial',
  };
  applyReturnCampFromPayoutQueue(camp);
  assert.equal(camp.submittedToFinanceAt, null);
  assert.equal(camp.submittedToFinanceById, null);
  assert.equal(camp.submittedToFinanceByEmail, '');
  assert.equal(camp.financePaymentStatus, '');
  assert.equal(camp.paymentSubmitStatus, 'payment_not_checked');
  assert.equal(camp.lifecycleStage, 'financial');
});

test('applyReturnCampFromPayoutQueue clears Hold back to Pending Confirmation', () => {
  const camp = {
    submittedToFinanceAt: '2026-10-01T00:00:00.000Z',
    financePaymentStatus: 'under_review',
    paymentSubmitStatus: 'payment_hold',
    lifecycleStage: 'financial',
  };
  applyReturnCampFromPayoutQueue(camp);
  assert.equal(camp.paymentSubmitStatus, 'payment_not_checked');
});

test('applyReturnCampFromPayoutQueue rejects Payment Done', () => {
  assert.throws(
    () => applyReturnCampFromPayoutQueue({
      submittedToFinanceAt: '2026-10-01T00:00:00.000Z',
      financePaymentStatus: 'paid',
    }),
    /Payment Done/,
  );
});

test('return clearKeys are required — blank merge alone keeps queue membership', () => {
  const existing = {
    _id: 'c1',
    submittedToFinanceAt: '2026-10-01T00:00:00.000Z',
    submittedToFinanceById: 'u1',
    submittedToFinanceByEmail: 'a@b.com',
    financePaymentStatus: 'under_review',
    paymentSubmitStatus: 'payment_confirmed',
    lifecycleStage: 'financial',
  };
  const camp = { ...existing };
  applyReturnCampFromPayoutQueue(camp);

  const withoutClear = mergeDocumentFields(existing, camp);
  assert.equal(withoutClear.submittedToFinanceAt, '2026-10-01T00:00:00.000Z');
  assert.equal(withoutClear.financePaymentStatus, 'under_review');
  assert.equal(withoutClear.paymentSubmitStatus, 'payment_not_checked');

  const withClear = mergeDocumentFields(existing, camp, {
    clearKeys: CAMP_PAYOUT_RETURN_CLEAR_KEYS,
  });
  assert.equal(withClear.submittedToFinanceAt, null);
  assert.equal(withClear.submittedToFinanceById, null);
  assert.equal(withClear.submittedToFinanceByEmail, '');
  assert.equal(withClear.financePaymentStatus, '');
  assert.equal(withClear.paymentSubmitStatus, 'payment_not_checked');
});

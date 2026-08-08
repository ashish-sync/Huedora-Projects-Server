import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ARCHIVE_IDLE_DAYS,
  ARCHIVE_WARN_DAYS,
  DAY_MS,
  classifyByClosedAt,
  applyArchiveListFilter,
  isArchived,
} from './archivePolicy.js';
import {
  campClosedAt,
  requestClosedAt,
  commercialClosedAt,
  agreementClosedAt,
  classifyEntity,
} from './ninetyDayArchive.js';

const now = new Date('2026-08-08T12:00:00.000Z');

function daysAgo(days) {
  return new Date(now.getTime() - days * DAY_MS).toISOString();
}

test('classifyByClosedAt warns at 88 and archives at 90', () => {
  assert.equal(ARCHIVE_WARN_DAYS, 88);
  assert.equal(ARCHIVE_IDLE_DAYS, 90);
  assert.equal(classifyByClosedAt(daysAgo(87), { now }), 'ok');
  assert.equal(classifyByClosedAt(daysAgo(88), { now }), 'warn');
  assert.equal(
    classifyByClosedAt(daysAgo(89), { now, archiveWarnedAt: daysAgo(1) }),
    'ok',
  );
  assert.equal(
    classifyByClosedAt(daysAgo(90), { now, archiveWarnedAt: daysAgo(2) }),
    'archive',
  );
});

test('applyArchiveListFilter defaults to excluding archived', () => {
  const filter = { isDeleted: false };
  applyArchiveListFilter(filter, {});
  assert.ok(Array.isArray(filter.$and));
  assert.equal(applyArchiveListFilter({ isDeleted: false }, { archive: '1' }).archivedAt.$ne, null);
});

test('campClosedAt only for terminal camps', () => {
  assert.equal(campClosedAt({ status: 'approved', financePaymentStatus: 'not_paid' }), null);
  assert.ok(campClosedAt({ status: 'rejected', updatedAt: daysAgo(10) }));
  assert.ok(
    campClosedAt({
      status: 'approved',
      financePaymentStatus: 'paid',
      financeProcessedAt: daysAgo(5),
    }),
  );
});

test('requestClosedAt terminal statuses only', () => {
  assert.equal(requestClosedAt({ status: 'APPROVED' }), null);
  assert.ok(requestClosedAt({ status: 'COMPLETED', updatedAt: daysAgo(3) }));
});

test('commercialClosedAt skips drafts and unpaid issued', () => {
  assert.equal(commercialClosedAt({ status: 'Draft' }), null);
  assert.equal(
    commercialClosedAt({ status: 'Issued', paymentStatus: 'Unpaid', issuedAt: daysAgo(100) }),
    null,
  );
  assert.ok(
    commercialClosedAt({
      status: 'Issued',
      paymentStatus: 'Fully paid',
      paidAt: daysAgo(100),
    }),
  );
});

test('agreementClosedAt for completed/terminated; classifyEntity UI path', () => {
  assert.ok(agreementClosedAt({ status: 'COMPLETED', completedAt: daysAgo(100) }));
  assert.equal(
    classifyEntity(
      'agreement',
      { status: 'COMPLETED', completedAt: daysAgo(100), archivedAt: null },
      now,
    ),
    'archive',
  );
  assert.equal(
    classifyEntity('agreement', { status: 'DRAFT', createdAt: daysAgo(200) }, now),
    'ok',
  );
});

test('isArchived', () => {
  assert.equal(isArchived({ archivedAt: null }), false);
  assert.equal(isArchived({ archivedAt: daysAgo(1) }), true);
});

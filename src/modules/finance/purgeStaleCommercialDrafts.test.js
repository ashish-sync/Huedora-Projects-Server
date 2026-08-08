import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DAY_MS,
  DRAFT_IDLE_DELETE_DAYS,
  DRAFT_IDLE_WARN_DAYS,
  classifyDraftIdle,
  idleDays,
  lastEditedAt,
} from './purgeStaleCommercialDrafts.js';

const now = new Date('2026-08-08T12:00:00.000Z');

function draft(overrides = {}) {
  return {
    status: 'Draft',
    isDeleted: false,
    draftStaleWarnedAt: null,
    updatedAt: now.toISOString(),
    createdAt: now.toISOString(),
    ...overrides,
  };
}

function daysAgo(days) {
  return new Date(now.getTime() - days * DAY_MS).toISOString();
}

test('lastEditedAt prefers lastContentEditedAt over updatedAt', () => {
  const edited = lastEditedAt(
    {
      lastContentEditedAt: '2026-06-01T00:00:00.000Z',
      updatedAt: '2026-07-01T00:00:00.000Z',
      createdAt: '2026-01-01T00:00:00.000Z',
    },
    now,
  );
  assert.equal(edited.toISOString(), '2026-06-01T00:00:00.000Z');
});

test('lastEditedAt falls back to updatedAt when no content-edit stamp', () => {
  const edited = lastEditedAt(
    { updatedAt: '2026-07-01T00:00:00.000Z', createdAt: '2026-01-01T00:00:00.000Z' },
    now,
  );
  assert.equal(edited.toISOString(), '2026-07-01T00:00:00.000Z');
});

test('warn does not skip delete after system updatedAt bump when content stamp preserved', () => {
  // Simulates: warned at day 28 (updatedAt now), but lastContentEditedAt still day-30-ago.
  assert.equal(
    classifyDraftIdle(
      draft({
        lastContentEditedAt: daysAgo(DRAFT_IDLE_DELETE_DAYS),
        updatedAt: now.toISOString(),
        draftStaleWarnedAt: daysAgo(2),
      }),
      now,
    ),
    'delete',
  );
});

test('idleDays uses updatedAt', () => {
  const days = idleDays(draft({ updatedAt: daysAgo(10) }), now);
  assert.ok(Math.abs(days - 10) < 0.001);
});

test('classifyDraftIdle stays ok under warn threshold', () => {
  assert.equal(classifyDraftIdle(draft({ updatedAt: daysAgo(27) }), now), 'ok');
  assert.equal(classifyDraftIdle(draft({ updatedAt: daysAgo(0) }), now), 'ok');
});

test('classifyDraftIdle warns at 28 days once', () => {
  assert.equal(DRAFT_IDLE_WARN_DAYS, 28);
  assert.equal(
    classifyDraftIdle(draft({ updatedAt: daysAgo(DRAFT_IDLE_WARN_DAYS) }), now),
    'warn',
  );
  assert.equal(
    classifyDraftIdle(
      draft({
        updatedAt: daysAgo(29),
        draftStaleWarnedAt: daysAgo(1),
      }),
      now,
    ),
    'ok',
  );
});

test('classifyDraftIdle deletes at 30 days even if already warned', () => {
  assert.equal(DRAFT_IDLE_DELETE_DAYS, 30);
  assert.equal(
    classifyDraftIdle(
      draft({
        updatedAt: daysAgo(DRAFT_IDLE_DELETE_DAYS),
        draftStaleWarnedAt: daysAgo(2),
      }),
      now,
    ),
    'delete',
  );
  assert.equal(
    classifyDraftIdle(draft({ updatedAt: daysAgo(45) }), now),
    'delete',
  );
});

test('classifyDraftIdle ignores non-draft and deleted rows', () => {
  assert.equal(
    classifyDraftIdle(draft({ status: 'Issued', updatedAt: daysAgo(40) }), now),
    'ok',
  );
  assert.equal(
    classifyDraftIdle(draft({ isDeleted: true, updatedAt: daysAgo(40) }), now),
    'ok',
  );
});

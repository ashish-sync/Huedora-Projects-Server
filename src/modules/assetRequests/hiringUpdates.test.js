import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildHiringUpdateEntry,
  canCreatorEditHiringDetails,
  hasOpenClarification,
  normalizeHiringProgress,
  normalizeHiringUpdateKind,
  pickHiringDetailPatch,
  resolveOpenClarifications,
} from './hiringUpdates.js';

describe('hiringUpdates helpers', () => {
  it('normalizes progress and kinds', () => {
    assert.equal(normalizeHiringProgress('awaiting info'), 'AWAITING_INFO');
    assert.equal(normalizeHiringProgress('Shortlisting'), 'SHORTLISTING');
    assert.equal(normalizeHiringUpdateKind('clarification'), 'CLARIFICATION');
    assert.equal(normalizeHiringUpdateKind('nope'), '');
  });

  it('detects open clarification and edit window', () => {
    const row = {
      requestType: 'HIRING',
      status: 'REQUESTED',
      hiringProgress: 'OPEN',
      hiringUpdates: [
        {
          id: '1',
          kind: 'CLARIFICATION',
          requiresReply: true,
          resolvedAt: null,
          message: 'Need address',
        },
      ],
    };
    assert.equal(hasOpenClarification(row), true);
    assert.equal(canCreatorEditHiringDetails(row), true);
    assert.equal(
      canCreatorEditHiringDetails({
        ...row,
        hiringUpdates: [{ ...row.hiringUpdates[0], resolvedAt: '2026-01-01' }],
        hiringProgress: 'IN_PROGRESS',
      }),
      false
    );
  });

  it('builds entries and resolves clarifications on reply', () => {
    const entry = buildHiringUpdateEntry({
      kind: 'CLARIFICATION',
      message: 'Confirm pin code',
      actor: { _id: 'u-hr', fullName: 'Recruiter' },
      requiresReply: true,
      progress: 'AWAITING_INFO',
    });
    assert.equal(entry.kind, 'CLARIFICATION');
    assert.equal(entry.requiresReply, true);
    assert.ok(entry.id);

    const resolved = resolveOpenClarifications([entry], 'u-creator', '2026-02-01T00:00:00.000Z');
    assert.equal(resolved[0].resolvedAt, '2026-02-01T00:00:00.000Z');
    assert.equal(resolved[0].resolvedById, 'u-creator');
  });

  it('picks hiring detail patch fields', () => {
    assert.deepEqual(
      pickHiringDetailPatch({
        hiringCity: ' Pune ',
        budgetMin: '10',
        ignored: 'x',
      }),
      { hiringCity: 'Pune', budgetMin: 10 }
    );
  });
});

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  canMergePriorities,
  defaultGroupKey,
  resolveEventMeta,
  NOTIFICATION_PRIORITIES,
  NOTIFICATION_TTL_DAYS,
} from './notificationCatalog.js';
import { buildAuditChanges, mergeChangeLists, summarizeChanges } from './fieldDiff.js';

describe('notificationCatalog', () => {
  it('maps known events to priority and module', () => {
    assert.equal(resolveEventMeta('IMPORT_ERRORS').priority, NOTIFICATION_PRIORITIES.CRITICAL);
    assert.equal(resolveEventMeta('CAMP_REVIEW').module, 'camp');
    assert.equal(resolveEventMeta('UNKNOWN_X').priority, NOTIFICATION_PRIORITIES.INFORMATIONAL);
  });

  it('builds stable group keys', () => {
    assert.equal(
      defaultGroupKey({ type: 'CAMP_REVIEW', entityType: 'camp_ops_camp', entityId: 'abc' }),
      'camp_ops_camp:abc:CAMP_REVIEW'
    );
  });

  it('blocks merging critical into lower priority', () => {
    assert.equal(canMergePriorities('informational', 'critical'), false);
    assert.equal(canMergePriorities('critical', 'critical'), true);
    assert.equal(canMergePriorities('important', 'informational'), true);
  });

  it('uses 7-day TTL', () => {
    assert.equal(NOTIFICATION_TTL_DAYS, 7);
  });
});

describe('fieldDiff', () => {
  it('builds old → new changes', () => {
    const changes = buildAuditChanges(
      { status: 'Draft', amount: 10, secret: 1 },
      { status: 'Issued', amount: 10, secret: 2 },
      { status: 'Stage' }
    );
    assert.equal(changes.length, 2);
    const stage = changes.find((c) => c.field === 'status');
    assert.equal(stage.label, 'Stage');
    assert.equal(stage.from, 'Draft');
    assert.equal(stage.to, 'Issued');
  });

  it('merges change lists keeping original from', () => {
    const merged = mergeChangeLists(
      [{ field: 'status', label: 'Stage', from: 'Draft', to: 'Submitted' }],
      [{ field: 'status', label: 'Stage', from: 'Submitted', to: 'Issued' }]
    );
    assert.equal(merged.length, 1);
    assert.equal(merged[0].from, 'Draft');
    assert.equal(merged[0].to, 'Issued');
  });

  it('summarizes changes', () => {
    const s = summarizeChanges([
      { field: 'a', label: 'A', from: '1', to: '2' },
      { field: 'b', label: 'B', from: 'x', to: 'y' },
    ]);
    assert.match(s, /A: 1 → 2/);
  });
});

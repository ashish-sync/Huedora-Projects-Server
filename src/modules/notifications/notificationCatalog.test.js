import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  canMergePriorities,
  defaultGroupKey,
  resolveEventMeta,
  isApprovalRequestNotification,
  NOTIFICATION_PRIORITIES,
  NOTIFICATION_FYI_TTL_DAYS,
  NOTIFICATION_APPROVAL_TTL_DAYS,
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

  it('uses FYI 7-day and Approvals 14-day TTLs', () => {
    assert.equal(NOTIFICATION_FYI_TTL_DAYS, 7);
    assert.equal(NOTIFICATION_APPROVAL_TTL_DAYS, 14);
    assert.equal(NOTIFICATION_TTL_DAYS, 7);
  });

  it('detects approval-request notifications', () => {
    // Camp One review is FYI, even with legacy “needs approval/review” titles.
    assert.equal(
      isApprovalRequestNotification({ type: 'CAMP_REVIEW', title: 'Camp 26-08-0012 needs approval' }),
      false
    );
    assert.equal(
      isApprovalRequestNotification({
        type: 'CAMP_REVIEW',
        title: 'Camp needs review',
        meta: { kind: 'approval' },
      }),
      false
    );
    assert.equal(
      isApprovalRequestNotification({
        type: 'ASSET_REQUEST_APPROVAL',
        title: 'Request X needs approval',
      }),
      true
    );
    assert.equal(
      isApprovalRequestNotification({
        type: 'CAMP_HCW_GAP_APPROVAL',
        title: 'Camp 26-08-0012 needs approval — HCW gap under 30 minutes',
      }),
      true
    );
    assert.equal(
      isApprovalRequestNotification({
        type: 'ASSET_REQUEST_APPROVAL',
        title: 'Request X approved',
      }),
      false
    );
    assert.equal(
      isApprovalRequestNotification({
        type: 'ASSET_REQUEST_APPROVAL',
        title: 'Request X approved',
        meta: { kind: 'update' },
      }),
      false
    );
    assert.equal(
      isApprovalRequestNotification({
        type: 'ASSET_REQUEST_APPROVAL',
        title: 'opaque',
        meta: { kind: 'approval' },
      }),
      true
    );
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

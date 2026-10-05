import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  NOTIFICATION_APPROVAL_TTL_DAYS,
  NOTIFICATION_APPROVAL_TTL_MS,
  NOTIFICATION_FYI_TTL_DAYS,
  NOTIFICATION_FYI_TTL_MS,
  NOTIFICATION_TTL_ARCHIVE_REASON,
  NOTIFICATION_TTL_MS,
} from './notificationCatalog.js';
import { shouldPurgeNotification } from './notificationArchive.js';

describe('notification TTL constants', () => {
  it('keeps FYI at 7 days and Approvals at 14 days', () => {
    assert.equal(NOTIFICATION_FYI_TTL_DAYS, 7);
    assert.equal(NOTIFICATION_FYI_TTL_MS, 7 * 24 * 60 * 60 * 1000);
    assert.equal(NOTIFICATION_APPROVAL_TTL_DAYS, 14);
    assert.equal(NOTIFICATION_APPROVAL_TTL_MS, 14 * 24 * 60 * 60 * 1000);
    assert.equal(NOTIFICATION_TTL_MS, NOTIFICATION_FYI_TTL_MS);
    assert.equal(NOTIFICATION_TTL_ARCHIVE_REASON, 'notification_ttl_fyi_7d');
  });
});

describe('shouldPurgeNotification', () => {
  const now = new Date('2026-10-05T00:00:00.000Z');

  it('purges FYI after 7 days regardless of read state', () => {
    const createdAt = new Date(now.getTime() - 8 * 24 * 60 * 60 * 1000).toISOString();
    assert.equal(
      shouldPurgeNotification(
        { type: 'CAMP_REVIEW', kind: 'update', createdAt, readAt: null },
        { now },
      ),
      true,
    );
    assert.equal(
      shouldPurgeNotification(
        { type: 'CAMP_REVIEW', kind: 'update', createdAt, readAt: createdAt },
        { now },
      ),
      true,
    );
  });

  it('keeps FYI under 7 days', () => {
    const createdAt = new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000).toISOString();
    assert.equal(
      shouldPurgeNotification(
        { type: 'CAMP_REVIEW', kind: 'update', createdAt },
        { now },
      ),
      false,
    );
  });

  it('keeps unread Approvals even after 14 days', () => {
    const createdAt = new Date(now.getTime() - 20 * 24 * 60 * 60 * 1000).toISOString();
    assert.equal(
      shouldPurgeNotification(
        {
          type: 'ASSET_REQUEST_APPROVAL',
          title: 'Request X needs approval',
          kind: 'approval',
          createdAt,
          readAt: null,
          cancelledAt: null,
        },
        { now },
      ),
      false,
    );
  });

  it('purges Approvals after 14 days only when read or actioned', () => {
    const createdAt = new Date(now.getTime() - 15 * 24 * 60 * 60 * 1000).toISOString();
    assert.equal(
      shouldPurgeNotification(
        {
          type: 'CAMP_HCW_GAP_APPROVAL',
          kind: 'approval',
          createdAt,
          readAt: createdAt,
        },
        { now },
      ),
      true,
    );
    assert.equal(
      shouldPurgeNotification(
        {
          type: 'PICKLIST_SUGGESTION',
          kind: 'approval',
          createdAt,
          cancelledAt: createdAt,
        },
        { now },
      ),
      true,
    );
  });

  it('keeps read Approvals under 14 days', () => {
    const createdAt = new Date(now.getTime() - 5 * 24 * 60 * 60 * 1000).toISOString();
    assert.equal(
      shouldPurgeNotification(
        {
          type: 'ASSET_REQUEST_APPROVAL',
          title: 'Request X needs approval',
          kind: 'approval',
          createdAt,
          readAt: createdAt,
        },
        { now },
      ),
      false,
    );
  });
});

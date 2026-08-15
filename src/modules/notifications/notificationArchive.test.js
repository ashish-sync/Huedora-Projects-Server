import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  NOTIFICATION_TTL_ARCHIVE_REASON,
  NOTIFICATION_TTL_MS,
} from './notificationCatalog.js';

describe('notification TTL constants', () => {
  it('archives after 7 days', () => {
    assert.equal(NOTIFICATION_TTL_MS, 7 * 24 * 60 * 60 * 1000);
    assert.equal(NOTIFICATION_TTL_ARCHIVE_REASON, 'notification_ttl_7d');
  });
});

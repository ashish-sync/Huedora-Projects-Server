import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { applyHotAccessFields } from './ensureHotStorage.js';
import { R2_STORAGE_IA, R2_STORAGE_STANDARD } from '../objectStore.js';
import { FILE_IDLE_ARCHIVE_DAYS } from './coldStorageJob.js';

describe('IA restore resets 90-day idle clock', () => {
  it('sets STANDARD + ready + lastAccessedAt=now on restore fields', () => {
    const now = new Date('2026-09-06T12:00:00.000Z');
    const row = {
      status: 'archived',
      storageClass: R2_STORAGE_IA,
      lastAccessedAt: '2026-01-01T00:00:00.000Z',
    };
    applyHotAccessFields(row, { now });
    assert.equal(row.status, 'ready');
    assert.equal(row.storageClass, R2_STORAGE_STANDARD);
    assert.equal(row.lastAccessedAt, now.toISOString());
  });

  it('cold eligibility requires lastAccessedAt older than 90 days after restore', () => {
    const restoredAt = new Date('2026-09-06T12:00:00.000Z');
    const row = {
      status: 'ready',
      storageClass: R2_STORAGE_STANDARD,
      lastAccessedAt: restoredAt.toISOString(),
    };
    const cutoff = new Date(restoredAt.getTime() - FILE_IDLE_ARCHIVE_DAYS * 24 * 60 * 60 * 1000);
    const accessed = new Date(row.lastAccessedAt);
    // Immediately after restore, accessed is AFTER cutoff → not eligible
    assert.equal(accessed.getTime() <= cutoff.getTime(), false);
    // 91 days later without access → eligible
    const later = new Date(restoredAt.getTime() + 91 * 24 * 60 * 60 * 1000);
    const laterCutoff = new Date(later.getTime() - FILE_IDLE_ARCHIVE_DAYS * 24 * 60 * 60 * 1000);
    assert.equal(accessed.getTime() <= laterCutoff.getTime(), true);
  });
});

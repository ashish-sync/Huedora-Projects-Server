import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  buildStoredUploadFileName,
  formatUploadDateStamp,
  sanitizeOriginalFileName,
} from './uploadKeys.js';

describe('upload naming convention', () => {
  it('sanitizes original names and preserves extension', () => {
    assert.equal(sanitizeOriginalFileName('My Invoice (final).PDF'), 'My_Invoice_final.PDF');
    assert.equal(sanitizeOriginalFileName('../../../etc/passwd'), 'passwd');
    assert.ok(sanitizeOriginalFileName(`${'a'.repeat(200)}.jpeg`).endsWith('.jpeg'));
    assert.ok(sanitizeOriginalFileName(`${'a'.repeat(200)}.jpeg`).length <= 80);
  });

  it('builds dated unique basenames with optional purpose', () => {
    const now = new Date(Date.UTC(2026, 8, 6));
    assert.equal(formatUploadDateStamp(now), '20260906');

    const name = buildStoredUploadFileName('sku photo.jpg', {
      now,
      id: 'a1b2c3d4-eeee-ffff-0000-111122223333',
    });
    assert.equal(name, '20260906-a1b2c3d4__sku_photo.jpg');

    const withPurpose = buildStoredUploadFileName('approval.pdf', {
      now,
      id: '1122334455667788',
      purpose: 'po',
    });
    assert.equal(withPurpose, 'po__20260906-11223344__approval.pdf');
  });

  it('always includes separator before original for searchability', () => {
    const name = buildStoredUploadFileName('bill.pdf', { now: new Date(Date.UTC(2026, 0, 1)), id: 'deadbeef' });
    assert.match(name, /^\d{8}-[a-f0-9]{8}__/i);
    assert.ok(name.includes('__bill.pdf'));
  });
});

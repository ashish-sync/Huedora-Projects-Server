/**
 * Aggregated security regression smoke (must stay green).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { assertSafeUpload } from '../utils/uploadSafety.js';
import {
  assertActorMayAssignAccess,
  assertActorMaySetRolePermissions,
} from '../modules/users/userAccess.js';
import { assertVendorBillSegregationOfDuties } from '../modules/finance/vendorBill.sod.js';
import { assertNotStale } from '../store/dataIntegrity.js';
import { PERMISSIONS } from '../config/constants.js';

const EDITOR = new Set([PERMISSIONS.USERS_WRITE, PERMISSIONS.USERS_READ]);

test('security regression: RBAC escalation blocked', () => {
  const grantStar = assertActorMayAssignAccess(
    EDITOR,
    { roleIds: [], grantedPermissions: ['*'] },
    []
  );
  assert.equal(grantStar.ok, false);
  assert.equal(grantStar.code, 'PRIVILEGE_ESCALATION');

  const roleStar = assertActorMaySetRolePermissions(EDITOR, ['*'], { roleName: 'X' });
  assert.equal(roleStar.ok, false);
});

test('security regression: finance SoD blocks self-verify', () => {
  assert.throws(
    () =>
      assertVendorBillSegregationOfDuties(
        { status: 'under_verification', submittedById: 'u1' },
        'verified',
        'u1'
      ),
    (err) => err.code === 'SOD_VIOLATION'
  );
});

test('security regression: spoofed upload rejected', () => {
  const bad = assertSafeUpload({
    originalname: 'invoice.pdf',
    mimetype: 'application/pdf',
    buffer: Buffer.from([0x4d, 0x5a, 0x90, 0x00]), // MZ exe
  });
  assert.equal(bad.ok, false);
});

test('security regression: stale update rejected', () => {
  assert.throws(
    () => assertNotStale({ updatedAt: '2026-02-01T00:00:00.000Z' }, '2026-01-01T00:00:00.000Z'),
    (err) => err.code === 'STALE_UPDATE'
  );
});

test('security regression: path traversal rejected by resolveUploadPath', async () => {
  const { resolveUploadPath } = await import('../modules/files/file.routes.js');
  assert.throws(
    () => resolveUploadPath('../etc/passwd'),
    (err) => err.status === 400 || err.status === 404
  );
});

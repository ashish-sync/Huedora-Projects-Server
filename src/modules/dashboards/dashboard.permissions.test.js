import test from 'node:test';
import assert from 'node:assert/strict';
import { requirePermission } from '../../middleware/auth.js';
import { PERMISSIONS } from '../../config/constants.js';

const ROLE_FIXTURES = [
  { name: 'Local Admin', permissions: [PERMISSIONS.ALL], allowed: true },
  {
    name: 'Operations Manager',
    permissions: [PERMISSIONS.DASHBOARDS_READ, PERMISSIONS.ASSETS_READ],
    allowed: true,
  },
  { name: 'Read-only user', permissions: [PERMISSIONS.DASHBOARDS_READ], allowed: true },
  { name: 'User without dashboard access', permissions: [PERMISSIONS.ASSETS_READ], allowed: false },
];

test('dashboard backend permission gate matches approved role fixtures', () => {
  const authorize = requirePermission(PERMISSIONS.DASHBOARDS_READ);

  for (const fixture of ROLE_FIXTURES) {
    let nextError;
    let nextCalled = false;
    authorize(
      { permissions: new Set(fixture.permissions) },
      {},
      (error) => {
        nextCalled = true;
        nextError = error;
      },
    );

    assert.equal(nextCalled, true, `${fixture.name} should reach the next middleware`);
    if (fixture.allowed) {
      assert.equal(nextError, undefined, `${fixture.name} should be authorized`);
    } else {
      assert.equal(nextError?.status, 403, `${fixture.name} should receive HTTP 403`);
      assert.equal(nextError?.code, 'FORBIDDEN');
    }
  }
});

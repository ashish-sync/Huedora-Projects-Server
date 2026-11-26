import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { mergeDocumentFields } from '../../store/dataIntegrity.js';

describe('Control Center access PATCH merge', () => {
  it('keeps prior roleIds when empty [] is saved without clearKeys', () => {
    const existing = {
      roleIds: ['role-admin'],
      grantedPermissions: ['camp_ops:read'],
    };
    const incoming = {
      roleIds: [],
      grantedPermissions: ['asset-requests:request'],
    };
    const merged = mergeDocumentFields(existing, incoming);
    assert.deepEqual(merged.roleIds, ['role-admin']);
    assert.deepEqual(merged.grantedPermissions, ['asset-requests:request']);
  });

  it('clears roleIds and grantedPermissions when clearKeys are set', () => {
    const existing = {
      roleIds: ['role-admin'],
      grantedPermissions: ['camp_ops:read', 'users:write'],
    };
    const incoming = {
      roleIds: [],
      grantedPermissions: ['asset-requests:request'],
    };
    const merged = mergeDocumentFields(existing, incoming, {
      clearKeys: ['roleIds', 'grantedPermissions'],
    });
    assert.deepEqual(merged.roleIds, []);
    assert.deepEqual(merged.grantedPermissions, ['asset-requests:request']);
  });

  it('clears grantedPermissions to [] when explicitly cleared', () => {
    const existing = {
      roleIds: ['role-admin'],
      grantedPermissions: ['camp_ops:read'],
    };
    const incoming = {
      roleIds: ['role-admin'],
      grantedPermissions: [],
    };
    const merged = mergeDocumentFields(existing, incoming, {
      clearKeys: ['roleIds', 'grantedPermissions'],
    });
    assert.deepEqual(merged.roleIds, ['role-admin']);
    assert.deepEqual(merged.grantedPermissions, []);
  });
});

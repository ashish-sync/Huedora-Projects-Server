import assert from 'node:assert/strict';
import {
  normalizeSystemRole,
  resolveSystemRole,
  systemRoleFromDesignation,
} from './systemRole.js';

assert.equal(systemRoleFromDesignation('Operations Leader'), 'Admin');
assert.equal(systemRoleFromDesignation('System Analyst'), 'Admin');
assert.equal(systemRoleFromDesignation('Team Leader'), 'Admin');
assert.equal(systemRoleFromDesignation('Business Head'), 'Super Admin');
assert.equal(systemRoleFromDesignation('Lead – Process & Tech'), 'Super Admin');
assert.equal(systemRoleFromDesignation('Lead - Process & Tech'), 'Super Admin');
assert.equal(systemRoleFromDesignation('Senior Manager'), 'Super Admin');
assert.equal(systemRoleFromDesignation('Data Analyst'), 'User');
assert.equal(systemRoleFromDesignation('Healthcare Camp Coordinator'), 'User');
assert.equal(systemRoleFromDesignation('Individual Contributor'), 'User');
assert.equal(systemRoleFromDesignation('Logistics Associate'), 'User');
assert.equal(systemRoleFromDesignation('Training Manager'), 'User');
assert.equal(systemRoleFromDesignation('Unknown Title'), '');

assert.equal(normalizeSystemRole('super admin'), 'Super Admin');
assert.equal(normalizeSystemRole('ADMIN'), 'Admin');
assert.equal(normalizeSystemRole('user'), 'User');
assert.equal(normalizeSystemRole('nope'), '');

assert.equal(
  resolveSystemRole({ systemRole: 'Admin', designation: 'Business Head' }),
  'Admin'
);
assert.equal(
  resolveSystemRole({ systemRole: '', designation: 'Business Head' }),
  'Super Admin'
);

console.log('systemRole.test.js: ok');

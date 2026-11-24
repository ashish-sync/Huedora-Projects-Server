import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeDesignationRenameKey,
  resolveRenamedDesignation,
} from './designationRename.js';

test('normalizeDesignationRenameKey collapses dashes and spaces', () => {
  assert.equal(normalizeDesignationRenameKey('  Lead – Process & Tech '), 'lead - process & tech');
  assert.equal(normalizeDesignationRenameKey('Team Lead'), 'team lead');
});

test('resolveRenamedDesignation maps to the locked designation picklist', () => {
  assert.equal(resolveRenamedDesignation('Accounts'), 'Ops. Support Team');
  assert.equal(resolveRenamedDesignation('Data Analyst'), 'Ops. Support Team');
  assert.equal(resolveRenamedDesignation('Individual Contributor'), 'Ops. Support Team');
  assert.equal(resolveRenamedDesignation('Logistics Associate'), 'Ops. Support Team');
  assert.equal(resolveRenamedDesignation('System Analyst'), 'Ops. Support Team');
  assert.equal(resolveRenamedDesignation('Training Manager'), 'Ops. Support Team');
  assert.equal(resolveRenamedDesignation('Ops Support Team'), 'Ops. Support Team');
  assert.equal(resolveRenamedDesignation('Lead – Process & Tech'), 'Ops. Manager');
  assert.equal(resolveRenamedDesignation('Operations Leader'), 'Ops. Manager');
  assert.equal(resolveRenamedDesignation('Senior Manager'), 'Ops. Manager');
  assert.equal(resolveRenamedDesignation('Manager'), 'Ops. Manager');
  assert.equal(resolveRenamedDesignation('Team Lead'), 'Team Leader');
  assert.equal(resolveRenamedDesignation('Team Leader'), 'Team Leader');
  assert.equal(resolveRenamedDesignation('Healthcare Camp Coordinator'), 'Camp Coordinator');
  assert.equal(resolveRenamedDesignation('Camp Coordinator'), 'Camp Coordinator');
  assert.equal(resolveRenamedDesignation('Director'), 'Business Head');
  assert.equal(resolveRenamedDesignation('Business Head'), 'Business Head');
});

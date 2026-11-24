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

test('resolveRenamedDesignation applies the org rename table', () => {
  assert.equal(resolveRenamedDesignation('Accounts'), 'Ops Support Team');
  assert.equal(resolveRenamedDesignation('Data Analyst'), 'Ops Support Team');
  assert.equal(resolveRenamedDesignation('Individual Contributor'), 'Ops Support Team');
  assert.equal(resolveRenamedDesignation('Logistics Associate'), 'Ops Support Team');
  assert.equal(resolveRenamedDesignation('System Analyst'), 'Ops Support Team');
  assert.equal(resolveRenamedDesignation('Training Manager'), 'Ops Support Team');
  assert.equal(resolveRenamedDesignation('Lead – Process & Tech'), 'Manager');
  assert.equal(resolveRenamedDesignation('Operations Leader'), 'Manager');
  assert.equal(resolveRenamedDesignation('Senior Manager'), 'Manager');
  assert.equal(resolveRenamedDesignation('Team Lead'), 'Team Leader');
  assert.equal(resolveRenamedDesignation('Team Leader'), 'Team Leader');
  assert.equal(resolveRenamedDesignation('Director'), 'Director');
});

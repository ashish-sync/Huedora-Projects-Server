import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildContactPersonsFromImportRow,
  normalizeContactPersonLevel,
  normalizeContactPersons,
  resolveContactPersonFields,
} from './campContactPersons.js';

describe('campContactPersons import', () => {
  it('maps short codes TM/AM/RM/ZM/PM to full level names', () => {
    assert.equal(normalizeContactPersonLevel('TM'), 'Territory Manager');
    assert.equal(normalizeContactPersonLevel('AM'), 'Area Manager');
    assert.equal(normalizeContactPersonLevel('RM'), 'Regional Manager');
    assert.equal(normalizeContactPersonLevel('ZM'), 'Zonal Manager');
    assert.equal(normalizeContactPersonLevel('PM'), 'Product Manager');
  });

  it('builds multiple contacts from TM/AM/RM/ZM/PM columns', () => {
    const contacts = buildContactPersonsFromImportRow({
      tmName: 'tm one',
      tmPhone: '9876543210',
      amName: 'am two',
      amPhone: '9123456780',
      pmName: 'pm three',
      pmPhone: '9988776655',
    });
    assert.equal(contacts.length, 3);
    assert.deepEqual(contacts[0], {
      level: 'Territory Manager',
      name: 'Tm One',
      phone: '9876543210',
    });
    assert.equal(contacts[1].level, 'Area Manager');
    assert.equal(contacts[2].level, 'Product Manager');
  });

  it('still accepts legacy Contact Person Level/Name/Number columns', () => {
    const contacts = buildContactPersonsFromImportRow({
      contactPersonLevel: 'RM',
      fieldPersonName: 'legacy rep',
      fieldPersonPhone: '9000011111',
    });
    assert.equal(contacts.length, 1);
    assert.deepEqual(contacts[0], {
      level: 'Regional Manager',
      name: 'Legacy Rep',
      phone: '9000011111',
    });
  });

  it('merges legacy contact with additional level columns without duplicating level', () => {
    const contacts = buildContactPersonsFromImportRow({
      contactPersonLevel: 'Territory Manager',
      fieldPersonName: 'legacy tm',
      fieldPersonPhone: '9000011111',
      tmName: 'column tm',
      tmPhone: '9111122222',
      amName: 'am only',
      amPhone: '9333344444',
    });
    assert.equal(contacts.length, 2);
    assert.equal(contacts[0].level, 'Territory Manager');
    assert.equal(contacts[0].name, 'Column Tm');
    assert.equal(contacts[1].level, 'Area Manager');
  });

  it('resolveContactPersonFields mirrors primary onto legacy fields', () => {
    const resolved = resolveContactPersonFields({
      tmName: 'Primary Tm',
      tmPhone: '9876543210',
      zmName: 'Zone Lead',
      zmPhone: '9123456789',
    });
    assert.equal(resolved.contactPersons.length, 2);
    assert.equal(resolved.contactPersonLevel, 'Territory Manager');
    assert.equal(resolved.fieldPersonName, 'Primary Tm');
    assert.equal(resolved.fieldPersonPhone, '9876543210');
  });

  it('normalizeContactPersons reads level columns when contactPersons is absent', () => {
    const contacts = normalizeContactPersons({
      rmName: 'Regional One',
      rmPhone: '9555566666',
    });
    assert.equal(contacts.length, 1);
    assert.equal(contacts[0].level, 'Regional Manager');
  });
});

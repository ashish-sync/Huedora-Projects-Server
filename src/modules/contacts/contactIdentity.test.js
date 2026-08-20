import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  configurePersistence,
  clearPersistenceCache,
  hydratePersistence,
  saveCollection,
} from '../../store/persistence.js';
import { findContactForCustodian } from './contactIdentity.js';
import './contact.model.js';

let tempDir = '';

test.before(async () => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'custodian-'));
  configurePersistence({ backend: 'file', dataDirectory: tempDir });
  await hydratePersistence();
});

test.after(() => {
  clearPersistenceCache();
  if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
});

async function seedContacts(rows) {
  clearPersistenceCache();
  await saveCollection('contacts', rows, { allowDestructiveSync: true });
}

test('findContactForCustodian matches email, phone, and exact name', async () => {
  await seedContacts([
    {
      _id: 'c-email',
      name: 'Anita Desai',
      email: 'anita@example.com',
      contact: '9876543210',
      mobile: '9876543210',
      isDeleted: false,
    },
  ]);

  const byEmail = await findContactForCustodian('anita@example.com');
  const byPhone = await findContactForCustodian('9876543210');
  const byName = await findContactForCustodian('Anita Desai');

  assert.equal(String(byEmail?._id), 'c-email');
  assert.equal(String(byPhone?._id), 'c-email');
  assert.equal(String(byName?._id), 'c-email');
});

test('findContactForCustodian can reuse the same contact for multiple assets', async () => {
  await seedContacts([
    {
      _id: 'c-shared',
      name: 'Shared Custodian',
      email: 'shared@example.com',
      contact: '9998887777',
      mobile: '9998887777',
      isDeleted: false,
    },
  ]);

  const first = await findContactForCustodian('shared@example.com', { requireMatch: true });
  const second = await findContactForCustodian('9998887777', { requireMatch: true });
  assert.equal(String(first._id), String(second._id));
});

test('findContactForCustodian requireMatch rejects unknown values', async () => {
  await seedContacts([]);
  await assert.rejects(
    () => findContactForCustodian('nobody@example.com', { requireMatch: true }),
    /must match an existing Contact Directory record/,
  );
});

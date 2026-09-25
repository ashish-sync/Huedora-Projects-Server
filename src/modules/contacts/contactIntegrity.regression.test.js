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
  loadCollection,
} from '../../store/persistence.js';
import { assertNotStale, assignPreservingExisting, resolveClearKeys } from '../../store/dataIntegrity.js';
import {
  findContactByIdentity,
  resolveOrCreateContact,
} from './contactIdentity.js';
import { normalizeContactPayload } from './contact.model.js';
import { FRESH_START_KEEP_COLLECTIONS, freshStartKeepUsers } from '../../utils/freshStartKeepUsers.js';
import './contact.model.js';

let tempDir = '';

test.before(async () => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'contact-integrity-'));
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

test('stale Contact PATCH is rejected with 409', () => {
  assert.throws(
    () => assertNotStale(
      { updatedAt: '2026-09-25T14:00:00.000Z' },
      '2026-09-25T13:00:00.000Z',
      { label: 'Contact' },
    ),
    (err) => err?.code === 'STALE_UPDATE' && err?.status === 409,
  );
});

test('Service Provider roster requires explicit clearKeys to wipe', () => {
  const contact = {
    contactCategory: 'Healthcare Worker',
    resourceType: 'Vendor',
    providerEmployees: [{ id: '1', name: 'Ravi', mobile: '9123456789', profession: '' }],
  };
  const payload = normalizeContactPayload({
    name: 'Agency',
    contactCategory: 'Vendor',
    supplyCategory: 'Medical',
    contact: '9876543210',
    state: 'Maharashtra',
    providerEmployees: [],
  });
  // Without clearKeys — empty array must not wipe.
  assignPreservingExisting(contact, { ...payload, providerEmployees: [] });
  assert.equal(contact.providerEmployees.length, 1);

  const clearKeys = resolveClearKeys(
    { clearProviderEmployees: true },
    { clearProviderEmployees: 'providerEmployees' },
  );
  assignPreservingExisting(
    contact,
    { providerEmployees: [] },
    { clearKeys },
  );
  assert.deepEqual(contact.providerEmployees, []);
});

test('existing contact import merges new fields instead of silent reuse', async () => {
  await seedContacts([
    {
      _id: 'c-merge',
      name: 'Old Name',
      email: 'merge@example.com',
      contact: '9000011111',
      mobile: '9000011111',
      city: 'Pune',
      contactCategory: 'Resource',
      resourceType: 'Full Timer',
      isDeleted: false,
    },
  ]);

  const { contact, reused, merged } = await resolveOrCreateContact(
    {
      name: 'New Name',
      email: 'merge@example.com',
      contact: '9000011111',
      city: 'Mumbai',
      contactCategory: 'Resource',
      resourceType: 'Full Timer',
      profession: 'Technician',
    },
    'actor-1',
  );

  assert.equal(reused, true);
  assert.equal(merged, true);
  assert.equal(contact.name, 'New Name');
  assert.equal(contact.city, 'Mumbai');
  assert.equal(contact.profession, 'Technician');
  assert.equal(String(contact._id), 'c-merge');
});

test('findContactByIdentity uses targeted lookup by email', async () => {
  await seedContacts([
    {
      _id: 'c-email-lookup',
      name: 'Lookup',
      email: 'lookup@example.com',
      contact: '9111222333',
      mobile: '9111222333',
      isDeleted: false,
    },
  ]);
  const found = await findContactByIdentity({ email: 'lookup@example.com' });
  assert.equal(String(found?._id), 'c-email-lookup');
});

test('FRESH_START keeps contacts collection intact', async () => {
  assert.equal(FRESH_START_KEEP_COLLECTIONS.has('contacts'), true);

  await seedContacts([
    {
      _id: 'c-keep',
      name: 'Keep Me',
      email: 'keep@example.com',
      contact: '9222333444',
      mobile: '9222333444',
      isDeleted: false,
    },
  ]);
  await saveCollection('camp_ops_camps', [{ _id: 'camp-1', campId: 'C1', isDeleted: false }], {
    allowDestructiveSync: true,
  });

  const result = await freshStartKeepUsers({ clearUploads: false });
  assert.ok(result.kept.includes('contacts'));
  assert.ok(!result.cleared.includes('contacts'));

  const contacts = await loadCollection('contacts');
  assert.equal(contacts.some((c) => String(c._id) === 'c-keep'), true);
});

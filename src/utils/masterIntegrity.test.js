import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { configurePersistence } from '../store/persistence.js';
import { defineCollection } from '../store/filedb.js';
import { softDelete } from '../modules/common/counter.model.js';
import { assertActiveMasterRef } from './masterIntegrity.js';

const Master = defineCollection('__test_master_refs', {
  ...softDelete,
  name: '',
  isActive: true,
});

test('assertActiveMasterRef rejects missing/deleted/inactive', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tylo-master-'));
  configurePersistence({ backend: 'file', dataDirectory: dir });
  const live = await Master.create({ name: 'A', isActive: true });
  const inactive = await Master.create({ name: 'B', isActive: false });
  const deleted = await Master.create({ name: 'C', isActive: true, isDeleted: true });

  assert.equal((await assertActiveMasterRef({ Model: Master, id: live._id, label: 'Product' })).name, 'A');
  await assert.rejects(
    () => assertActiveMasterRef({ Model: Master, id: inactive._id, label: 'Product' }),
    (err) => err.code === 'INACTIVE_REFERENCE'
  );
  await assert.rejects(
    () => assertActiveMasterRef({ Model: Master, id: deleted._id, label: 'Product' }),
    (err) => err.code === 'INVALID_REFERENCE'
  );
  await assert.rejects(
    () => assertActiveMasterRef({ Model: Master, id: 'missing', label: 'Product' }),
    (err) => err.code === 'INVALID_REFERENCE'
  );
});

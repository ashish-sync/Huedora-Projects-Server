import test from 'node:test';
import assert from 'node:assert/strict';
import { buildContactExportRows, CONTACT_HEADERS } from './contact.excel.js';

test('export includes Service Provider embedded staff as Healthcare Worker rows', () => {
  const rows = buildContactExportRows([
    {
      _id: 'sp1',
      name: 'Care Agency',
      email: 'ops@care.example',
      contactCategory: 'Healthcare Worker',
      resourceType: 'Service Provider',
      contact: '9000000001',
      city: 'Pune',
      state: 'Maharashtra',
      providerEmployees: [
        { id: 'e1', name: 'Ravi Kumar', mobile: '9111000001', profession: 'Nurse' },
        { id: 'e2', name: 'Anita Desai', mobile: '9111000002', profession: 'Doctor' },
      ],
    },
    {
      _id: 'c1',
      name: 'Solo Clinic',
      contactCategory: 'Client',
      resourceType: '',
      contact: '9000000002',
    },
  ]);

  assert.equal(rows.length, 4); // agency + 2 staff + client
  assert.equal(CONTACT_HEADERS.length, rows[0].length);

  const agency = rows.find((r) => r[0] === 'Care Agency');
  assert.ok(agency);
  assert.equal(agency[3], 'Service Provider');

  const ravi = rows.find((r) => r[0] === 'Ravi Kumar');
  assert.ok(ravi, 'embedded staff must appear in export');
  assert.equal(ravi[2], 'Healthcare Worker');
  assert.equal(ravi[3], 'Individual');
  assert.equal(ravi[4], 'Nurse');
  assert.equal(ravi[7], '9111000001');
  assert.equal(ravi[16], 'Care Agency');
  assert.equal(ravi[8], 'Pune');

  const anita = rows.find((r) => r[0] === 'Anita Desai');
  assert.ok(anita);
  assert.equal(anita[16], 'Care Agency');
});

test('export skips roster staff already present as linked Contact rows', () => {
  const rows = buildContactExportRows([
    {
      _id: 'sp1',
      name: 'Care Agency',
      contactCategory: 'Healthcare Worker',
      resourceType: 'Service Provider',
      contact: '9000000001',
      providerEmployees: [
        { id: 'e1', name: 'Ravi Kumar', mobile: '9111000001', profession: 'Nurse' },
      ],
    },
    {
      _id: 'staff1',
      name: 'Ravi Kumar',
      contactCategory: 'Healthcare Worker',
      resourceType: 'Individual',
      contact: '9111000001',
      serviceProviderContactId: 'sp1',
      serviceProviderName: 'Care Agency',
      profession: 'Nurse',
    },
  ]);

  const raviRows = rows.filter((r) => r[0] === 'Ravi Kumar');
  assert.equal(raviRows.length, 1, 'must not duplicate linked + roster staff');
  assert.equal(raviRows[0][16], 'Care Agency');
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildContactExportRows,
  CONTACT_HEADERS,
  CONTACT_SAMPLE_ROWS,
  mergeProviderEmployee,
  normalizeImportEmployee,
} from './contact.excel.js';

test('sample headers match Directory Record form without agency link column', () => {
  assert.deepEqual(CONTACT_HEADERS, [
    'Full Name',
    'Email ID',
    'Contact Number',
    'Contact Category',
    'Resource Type',
    'Profession / Role',
    'Street Address',
    'State',
    'City / District',
    'PAN Number',
    'Aadhaar Number',
    'UPI ID',
    'IFSC Code',
    'Bank Name',
    'Account Number',
    'Employee Full Name',
    'Employee Contact Number',
    'Employee Profession / Role',
  ]);
  assert.ok(!CONTACT_HEADERS.includes('Service Provider (agency)'));

  for (const row of CONTACT_SAMPLE_ROWS) {
    assert.equal(row.length, CONTACT_HEADERS.length);
  }

  const individual = CONTACT_SAMPLE_ROWS.find((r) => r[4] === 'Individual');
  assert.ok(individual);
  assert.equal(individual[15], '');
  assert.equal(individual[16], '');
  assert.equal(individual[17], '');

  const spEmployeeRow = CONTACT_SAMPLE_ROWS.find((r) => r[4] === 'Service Provider');
  assert.ok(spEmployeeRow);
  assert.equal(spEmployeeRow[15], 'Ravi Kumar');
  assert.equal(spEmployeeRow[16], '9111000001');
  assert.equal(spEmployeeRow[17], 'Nurse');
});

test('export puts Service Provider employees into Employee Details columns', () => {
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
      address: '22 Service Lane',
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
      city: 'Mumbai',
      state: 'Maharashtra',
    },
    {
      _id: 'ind1',
      name: 'Solo Nurse',
      contactCategory: 'Healthcare Worker',
      resourceType: 'Individual',
      contact: '9111000099',
      serviceProviderContactId: 'sp1',
      serviceProviderName: 'Care Agency',
    },
  ]);

  assert.equal(rows.length, 4); // 2 SP employee rows + client + individual
  assert.equal(CONTACT_HEADERS.length, rows[0].length);

  const ravi = rows.find((r) => r[15] === 'Ravi Kumar');
  assert.ok(ravi);
  assert.equal(ravi[0], 'Care Agency');
  assert.equal(ravi[4], 'Service Provider');
  assert.equal(ravi[16], '9111000001');

  const individual = rows.find((r) => r[0] === 'Solo Nurse');
  assert.ok(individual);
  assert.equal(individual.length, CONTACT_HEADERS.length);
  assert.equal(individual[15], '');
  assert.equal(individual[4], 'Individual');
});

test('mergeProviderEmployee upserts by mobile and ignores empty employee cells', () => {
  assert.equal(normalizeImportEmployee({ name: '', mobile: '' }), null);

  const contact = { providerEmployees: [] };
  assert.equal(mergeProviderEmployee(contact, { name: 'Ravi', mobile: '9111000001', profession: 'Nurse' }), true);
  assert.equal(contact.providerEmployees.length, 1);
  assert.equal(mergeProviderEmployee(contact, { name: 'Ravi Kumar', mobile: '9111000001', profession: 'Nurse' }), true);
  assert.equal(contact.providerEmployees.length, 1);
  assert.equal(contact.providerEmployees[0].name, 'Ravi Kumar');
});

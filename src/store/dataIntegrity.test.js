import test from 'node:test';
import assert from 'node:assert/strict';
import {
  mergeDocumentFields,
  assignPreservingExisting,
  assertNotStale,
  isBlankValue,
  resolveClearKeys,
} from './dataIntegrity.js';

test('blank GSTIN/PAN never erase existing financial identity', () => {
  const row = { gstin: '27AABCU9603R1ZM', pan: 'AABCU9603R', address: 'Pune' };
  assignPreservingExisting(row, {
    gstin: '',
    pan: null,
    address: '',
    legalName: 'Acme',
  });
  assert.equal(row.gstin, '27AABCU9603R1ZM');
  assert.equal(row.pan, 'AABCU9603R');
  assert.equal(row.address, 'Pune');
  assert.equal(row.legalName, 'Acme');
});

test('stale updatedAt is rejected', () => {
  assert.throws(
    () => assertNotStale({ updatedAt: '2026-01-02T00:00:00.000Z' }, '2026-01-01T00:00:00.000Z'),
    (err) => err?.code === 'STALE_UPDATE' && err?.status === 409
  );
});

test('matching updatedAt is allowed', () => {
  assert.doesNotThrow(() =>
    assertNotStale({ updatedAt: '2026-01-02T00:00:00.000Z' }, '2026-01-02T00:00:00.000Z')
  );
});

test('PIN locality blank on import must not wipe existing locality', () => {
  const existing = {
    pinCode: '110001',
    locality: 'Connaught Place',
    notes: 'Metro hub',
    stateName: 'Delhi',
  };
  const merged = mergeDocumentFields(existing, {
    pinCode: '110001',
    locality: '',
    notes: '',
    stateName: 'Delhi',
  });
  assert.equal(merged.locality, 'Connaught Place');
  assert.equal(merged.notes, 'Metro hub');
});

test('commercial extras blank shipToGstin must not wipe', () => {
  const row = { shipToGstin: '27AAAAA0000A1Z5', declaration: 'Keep me' };
  assignPreservingExisting(row, {
    shipToGstin: '',
    declaration: '',
    shipToName: 'Warehouse B',
  });
  assert.equal(row.shipToGstin, '27AAAAA0000A1Z5');
  assert.equal(row.declaration, 'Keep me');
  assert.equal(row.shipToName, 'Warehouse B');
});

test('empty array does not wipe existing array unless clearKeys', () => {
  const row = {
    executionDocuments: [{ id: 'd1', fileName: 'df.pdf' }],
    consumablesUsed: [{ productId: 'p1', quantityUsed: 2, wastage: 0 }],
  };
  assignPreservingExisting(row, {
    executionDocuments: [],
    consumablesUsed: [],
    chargeableStatus: 'Chargeable',
  });
  assert.equal(row.executionDocuments.length, 1);
  assert.equal(row.consumablesUsed.length, 1);
  assert.equal(row.chargeableStatus, 'Chargeable');
});

test('empty array clears when clearKeys lists the field', () => {
  const row = {
    executionDocuments: [{ id: 'd1' }],
    providerEmployees: [{ id: 'e1', name: 'Ravi' }],
  };
  assignPreservingExisting(
    row,
    { executionDocuments: [], providerEmployees: [] },
    { clearKeys: ['executionDocuments', 'providerEmployees'] },
  );
  assert.deepEqual(row.executionDocuments, []);
  assert.deepEqual(row.providerEmployees, []);
});

test('non-empty array still replaces when present', () => {
  const row = { consumablesUsed: [{ productId: 'p1' }] };
  assignPreservingExisting(row, {
    consumablesUsed: [{ productId: 'p2', quantityUsed: 1, wastage: 0 }],
  });
  assert.equal(row.consumablesUsed[0].productId, 'p2');
});

test('resolveClearKeys reads flags and clearKeys arrays', () => {
  assert.deepEqual(
    resolveClearKeys(
      { clearExecutionDocuments: true, clearKeys: ['consumablesUsed'] },
      {
        clearExecutionDocuments: 'executionDocuments',
        clearConsumablesUsed: 'consumablesUsed',
      },
    ).sort(),
    ['consumablesUsed', 'executionDocuments'],
  );
});

test('archive path metadata strips runtime-only absolute paths before persist shape', () => {
  const packedPaths = [
    {
      originalRel: 'camps/a.pdf',
      archivedRel: 'archive/2026/camp/1/a.pdf.gz',
      originalRef: '/uploads/camps/a.pdf',
      originalAbs: 'C:\\tmp\\a.pdf',
    },
  ];
  const persisted = packedPaths.map(({ originalAbs, ...rest }) => rest);
  assert.equal(persisted[0].originalAbs, undefined);
  assert.equal(persisted[0].originalRel, 'camps/a.pdf');
  assert.equal(persisted[0].archivedRel, 'archive/2026/camp/1/a.pdf.gz');
});

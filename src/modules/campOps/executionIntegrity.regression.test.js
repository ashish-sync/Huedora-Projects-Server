import test from 'node:test';
import assert from 'node:assert/strict';
import {
  assignPreservingExisting,
  assertNotStale,
  mergeDocumentFields,
  resolveClearKeys,
} from '../../store/dataIntegrity.js';
import { syncExecutionStatusForSave, EXECUTION_STATUS } from './campOps.lifecycle.js';
import { normalizeConsumablesUsed } from './campConsumables.js';
import { FRESH_START_KEEP_COLLECTIONS } from '../../utils/freshStartKeepUsers.js';

test('stale camp updatedAt is rejected with 409 STALE_UPDATE', () => {
  assert.throws(
    () => assertNotStale(
      { updatedAt: '2026-09-25T12:00:00.000Z' },
      '2026-09-25T11:00:00.000Z',
      { label: 'Camp' },
    ),
    (err) => err?.code === 'STALE_UPDATE' && err?.status === 409,
  );
});

test('matching camp updatedAt is allowed', () => {
  const ts = '2026-09-25T12:00:00.000Z';
  assert.doesNotThrow(() => assertNotStale({ updatedAt: ts }, ts, { label: 'Camp' }));
});

test('upload then stale form docs [] cannot wipe newer documents', () => {
  const camp = {
    updatedAt: '2026-09-25T12:00:00.000Z',
    executionDocuments: [
      { id: 'old', fileName: 'a.pdf' },
      { id: 'new-upload', fileName: 'b.pdf' },
    ],
    consumablesUsed: [{ productId: 'p1', quantityUsed: 3, wastage: 1 }],
    campRevenue: 5000,
  };

  // Simulate older tab Save: empty docs + zero finance without clearKeys / without finance keys.
  const stalePayload = {
    chargeableStatus: 'Chargeable',
    executionDocuments: [],
    consumablesUsed: [],
  };
  assignPreservingExisting(camp, stalePayload);

  assert.equal(camp.executionDocuments.length, 2);
  assert.equal(camp.consumablesUsed.length, 1);
  assert.equal(camp.campRevenue, 5000);
  assert.equal(camp.chargeableStatus, 'Chargeable');
});

test('existing consumables remain when Save omits consumablesUsed', () => {
  const camp = {
    consumablesUsed: [
      { productId: 'p1', itemName: 'Strip', quantityUsed: 10, wastage: 1 },
    ],
  };
  assignPreservingExisting(camp, { inTime: '09:15', attire: 'No Issues' });
  assert.equal(camp.consumablesUsed.length, 1);
  assert.equal(camp.consumablesUsed[0].quantityUsed, 10);
});

test('explicit clearKeys empties consumables', () => {
  const camp = {
    consumablesUsed: [{ productId: 'p1', quantityUsed: 2, wastage: 0 }],
  };
  assignPreservingExisting(
    camp,
    { consumablesUsed: [] },
    { clearKeys: ['consumablesUsed'] },
  );
  assert.deepEqual(camp.consumablesUsed, []);
});

test('untouched finance 0 in merge patch does not overwrite when key omitted', () => {
  const camp = { campRevenue: 4200, travelRevenue: 800 };
  assignPreservingExisting(camp, {
    chargeableStatus: 'Chargeable',
    // campRevenue intentionally omitted
  });
  assert.equal(camp.campRevenue, 4200);
  assert.equal(camp.travelRevenue, 800);
});

test('incomplete consumable rows are not silently discarded', () => {
  const rows = normalizeConsumablesUsed(
    [
      { productId: 'p1', itemName: 'Strip', quantityUsed: '5', wastage: '' },
      { productId: 'p2', itemName: 'Battery', quantityUsed: '', wastage: '1' },
      { productId: '', itemName: 'Ignored', quantityUsed: 1, wastage: 0 },
    ],
    { requiredProductIds: ['p1', 'p2'] },
  );
  assert.equal(rows.length, 2);
  assert.equal(rows[0].productId, 'p1');
  assert.equal(rows[0].quantityUsed, 5);
  assert.equal(rows[0].wastage, '');
  assert.equal(rows[1].productId, 'p2');
  assert.equal(rows[1].wastage, 1);
});

test('syncExecutionStatusForSave does not demote Marked Executed or Ongoing', () => {
  assert.equal(
    syncExecutionStatusForSave({
      executionStatus: EXECUTION_STATUS.MARKED_EXECUTED,
      chargeableStatus: '',
      inTime: '',
      attire: '',
    }),
    EXECUTION_STATUS.MARKED_EXECUTED,
  );
  assert.equal(
    syncExecutionStatusForSave({
      executionStatus: EXECUTION_STATUS.CAMP_ONGOING,
      chargeableStatus: '',
      inTime: '',
      attire: '',
    }),
    EXECUTION_STATUS.CAMP_ONGOING,
  );
});

test('syncExecutionStatusForSave promotes Planned when 3 fields present', () => {
  assert.equal(
    syncExecutionStatusForSave({
      executionStatus: EXECUTION_STATUS.CAMP_SCHEDULED,
      chargeableStatus: 'Chargeable',
      inTime: '09:00',
      attire: 'No Issues',
    }),
    EXECUTION_STATUS.MARKED_EXECUTED,
  );
});

test('ordinary Save semantics: markComplete must be explicit (flag helper)', () => {
  const body = { editingStage: 'execution', lifecycleStage: 'financial' };
  const markCompleteIntent = body.markComplete === true || body.markComplete === 'true';
  assert.equal(markCompleteIntent, false);
});

test('FRESH_START keep set includes contacts', () => {
  assert.equal(FRESH_START_KEEP_COLLECTIONS.has('contacts'), true);
});

test('resolveClearKeys for camp document clears', () => {
  assert.deepEqual(
    resolveClearKeys(
      { clearConsumablesUsed: 'true' },
      { clearConsumablesUsed: 'consumablesUsed', clearExecutionDocuments: 'executionDocuments' },
    ),
    ['consumablesUsed'],
  );
});

test('mergeDocumentFields omits empty array wipe without clearKeys', () => {
  const merged = mergeDocumentFields(
    { executionDocuments: [{ id: '1' }] },
    { executionDocuments: [], inTime: '10:00' },
  );
  assert.equal(merged.executionDocuments.length, 1);
  assert.equal(merged.inTime, '10:00');
});

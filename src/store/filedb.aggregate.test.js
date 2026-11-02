import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { configurePersistence } from './persistence.js';
import { defineCollection, invalidateIdIndex } from './filedb.js';
import {
  commercialDocOverviewPipeline,
  expenseOverviewPipeline,
  invoiceOverviewPipeline,
} from '../modules/dashboards/dashboard.aggregations.js';

test('file-backed dashboard aggregates support null and compound group keys', async () => {
  const dataDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'tylo-dashboard-aggregate-'));
  configurePersistence({ backend: 'file', dataDirectory });
  invalidateIdIndex();

  try {
    const expenses = defineCollection('dashboard_aggregate_test_expenses');
    await expenses.insertMany([
      { _id: 'expense-1', amount: 100, status: 'Draft', isDeleted: false },
      { _id: 'expense-2', amount: 25, status: 'Paid', isDeleted: false },
      { _id: 'expense-deleted', amount: 1000, status: 'Draft', isDeleted: true },
    ]);
    assert.deepEqual(await expenses.aggregate(expenseOverviewPipeline()), [
      { _id: null, count: 2, total: 125, open: 1 },
    ]);

    const invoices = defineCollection('dashboard_aggregate_test_invoices');
    await invoices.insertMany([
      { _id: 'invoice-1', totalAmount: 300, status: 'Open', isDeleted: false },
      { _id: 'invoice-2', totalAmount: 75, status: 'Paid', isDeleted: false },
    ]);
    assert.deepEqual(await invoices.aggregate(invoiceOverviewPipeline()), [
      { _id: null, count: 2, total: 375, open: 1 },
    ]);

    const documents = defineCollection('dashboard_aggregate_test_documents');
    await documents.insertMany([
      { _id: 'doc-1', documentType: 'client_invoice', status: 'Draft', grandTotal: 500, isDeleted: false },
      { _id: 'doc-2', documentType: 'client_invoice', status: 'Draft', grandTotal: 200, isDeleted: false },
      { _id: 'doc-3', documentType: 'purchase_order', status: 'Submitted', grandTotal: 900, isDeleted: false },
      { _id: 'doc-4', documentType: 'other', status: 'Draft', grandTotal: 1, isDeleted: false },
    ]);
    const rows = await documents.aggregate(
      commercialDocOverviewPipeline(['client_invoice', 'purchase_order']),
    );
    assert.deepEqual(rows, [
      { _id: { documentType: 'client_invoice', status: 'Draft' }, count: 2, grandTotal: 700 },
      { _id: { documentType: 'purchase_order', status: 'Submitted' }, count: 1, grandTotal: 900 },
    ]);
  } finally {
    invalidateIdIndex();
    fs.rmSync(dataDirectory, { recursive: true, force: true });
  }
});

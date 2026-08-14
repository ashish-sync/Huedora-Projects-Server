import test from 'node:test';
import assert from 'node:assert/strict';
import { assignPreservingExisting } from '../../store/dataIntegrity.js';
import {
  isMeaningfulPurchaseOrder,
  resolveCampTermsFilesForPersist,
  resolvePurchaseOrdersForPersist,
} from './clientMaster.campTermsPersist.js';

test('empty purchaseOrders body preserves existing POs', () => {
  const existing = [
    {
      id: 'po-1',
      poNumber: 'PO-100',
      poNetValue: 1000,
      poGrossValue: 1000,
      files: [],
    },
  ];
  const resolved = resolvePurchaseOrdersForPersist([], existing);
  assert.equal(resolved.changed, false);
  assert.equal(resolved.orders[0].poNumber, 'PO-100');
});

test('meaningful purchaseOrders body replaces existing', () => {
  const existing = [{ id: 'po-1', poNumber: 'PO-100', poNetValue: 1000 }];
  const incoming = [{ id: 'po-2', poNumber: 'PO-200', poNetValue: 2500 }];
  const resolved = resolvePurchaseOrdersForPersist(incoming, existing);
  assert.equal(resolved.changed, true);
  assert.equal(resolved.orders[0].poNumber, 'PO-200');
});

test('empty campTermsFiles body preserves agreement attachments', () => {
  const existing = [{ id: 'f1', storedName: 'a.pdf', fileName: 'a.pdf' }];
  const resolved = resolveCampTermsFilesForPersist([], existing);
  assert.equal(resolved.changed, false);
  assert.equal(resolved.files[0].storedName, 'a.pdf');
});

test('agreement save with empty PO placeholders does not wipe stored POs or dates', () => {
  const row = {
    campTerms: 'po_based',
    agreementStartDate: '',
    agreementEffectiveDate: '',
    agreementEndDate: '',
    purchaseOrders: [
      {
        id: 'po-1',
        poNumber: 'PO-100',
        poNetValue: 5000,
        poApplyGst18: false,
        poGstAmount: 0,
        poGrossValue: 5000,
        poIssueDate: '2024-01-01',
        poExpiryDate: '2024-12-31',
        files: [],
      },
    ],
    campTermsFiles: [{ id: 'f1', storedName: 'agree.pdf', fileName: 'agree.pdf' }],
    poNumber: 'PO-100',
  };

  const poResolved = resolvePurchaseOrdersForPersist([], row.purchaseOrders);
  const fileResolved = resolveCampTermsFilesForPersist([], row.campTermsFiles);
  const payload = {
    campTerms: 'agreement_based',
    agreementStartDate: '2024-06-01',
    agreementEffectiveDate: '2024-06-15',
    agreementEndDate: '2025-06-01',
    purchaseOrders: poResolved.orders,
    campTermsFiles: fileResolved.files,
  };

  assignPreservingExisting(row, payload);
  assert.equal(row.campTerms, 'agreement_based');
  assert.equal(row.agreementStartDate, '2024-06-01');
  assert.equal(row.agreementEndDate, '2025-06-01');
  assert.equal(row.purchaseOrders[0].poNumber, 'PO-100');
  assert.equal(row.campTermsFiles[0].storedName, 'agree.pdf');
});

test('isMeaningfulPurchaseOrder requires content', () => {
  assert.equal(isMeaningfulPurchaseOrder({ id: 'x', poNumber: '', poNetValue: 0, files: [] }), false);
  assert.equal(isMeaningfulPurchaseOrder({ id: 'x', poNumber: 'PO-1', poNetValue: 0 }), true);
  assert.equal(isMeaningfulPurchaseOrder({ id: 'x', poIssueDate: '2024-01-01' }), true);
});

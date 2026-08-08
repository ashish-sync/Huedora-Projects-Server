import test from 'node:test';
import assert from 'node:assert/strict';
import { summarizeClientMasterPoBalance } from './poUtilization.service.js';

test('PO balance is PO amount minus committed Billing Center bills', () => {
  const master = {
    _id: 'cm1',
    purchaseOrders: [
      {
        id: 'po-1',
        poNumber: 'PO-100',
        poNetValue: 10000,
        poApplyGst18: true,
        poGstAmount: 1800,
        poGrossValue: 11800,
      },
    ],
  };

  const docs = [
    {
      clientMasterId: 'cm1',
      clientPurchaseOrderId: 'po-1',
      documentType: 'client_invoice',
      status: 'Approved',
      grandTotal: 5000,
    },
    {
      clientMasterId: 'cm1',
      clientPurchaseOrderId: 'po-1',
      documentType: 'credit_note',
      status: 'Approved',
      grandTotal: 500,
    },
  ];

  const summary = summarizeClientMasterPoBalance(master, docs);
  assert.equal(summary.poTotalValue, 11800);
  assert.equal(summary.poBilledAmount, 4500);
  assert.equal(summary.poBalance, 7300);
});

test('returns null balance when Client Master has no POs', () => {
  const summary = summarizeClientMasterPoBalance({ purchaseOrders: [] }, []);
  assert.equal(summary.poBalance, null);
  assert.equal(summary.hasPo, false);
});

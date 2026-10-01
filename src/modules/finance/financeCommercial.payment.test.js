import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  applyCommercialLifecycleStatus,
  applyCommercialPayment,
  assertCancellable,
  daysSinceDocumentApproved,
  displayCommercialStage,
  netReceivableFromPreGst,
  normalizeCommercialStage,
  resolveCommercialDisplayStatus,
  seedLifecycleStatusIfBlank,
} from './financeCommercial.service.js';

describe('commercial payment / Net Receivable', () => {
  it('computes Net Receivable as 90% of pre-GST subtotal', () => {
    assert.equal(netReceivableFromPreGst(100), 90);
    assert.equal(netReceivableFromPreGst(1234.56), 1111.1);
  });

  it('marks Paid when amount matches Net Receivable', () => {
    const row = {
      status: 'Issued',
      documentType: 'client_invoice',
      subtotal: 1000,
      grandTotal: 1180,
      paidAmount: 0,
      paymentStatus: 'Unpaid',
    };
    applyCommercialPayment(row, 900);
    assert.equal(row.paymentStatus, 'Paid');
    assert.equal(row.paidAmount, 900);
  });

  it('marks Partially Paid when amount is below Net Receivable', () => {
    const row = {
      status: 'Issued',
      documentType: 'bill_of_supply',
      subtotal: 1000,
      grandTotal: 1180,
      paidAmount: 0,
      paymentStatus: 'Unpaid',
    };
    applyCommercialPayment(row, 500);
    assert.equal(row.paymentStatus, 'Partially Paid');
  });

  it('rejects payment above Net Receivable', () => {
    const row = {
      status: 'Issued',
      documentType: 'client_invoice',
      subtotal: 1000,
      grandTotal: 1180,
    };
    assert.throws(() => applyCommercialPayment(row, 901), /Net Receivable/);
  });

  it('rejects payment on manual-status document types', () => {
    const row = {
      status: 'Issued',
      documentType: 'quotation',
      subtotal: 1000,
    };
    assert.throws(() => applyCommercialPayment(row, 100), /Tax Invoice/);
  });

  it('counts calendar days since approval', () => {
    const row = { approvedAt: '2026-07-01T10:00:00.000Z' };
    assert.equal(daysSinceDocumentApproved(row, new Date('2026-07-31T12:00:00.000Z')), 30);
    assert.equal(daysSinceDocumentApproved(row, new Date('2026-07-30T12:00:00.000Z')), 29);
  });

  it('shows Unpaid under/over 30D unless Paid or Partially Paid', () => {
    const base = {
      documentType: 'client_invoice',
      status: 'Issued',
      approvedAt: '2026-07-01T10:00:00.000Z',
      paymentStatus: 'Unpaid',
    };
    assert.equal(
      resolveCommercialDisplayStatus(base, new Date('2026-07-20T12:00:00.000Z')),
      'Unpaid under 30D'
    );
    assert.equal(
      resolveCommercialDisplayStatus(base, new Date('2026-08-05T12:00:00.000Z')),
      'Unpaid over 30D'
    );
    assert.equal(
      resolveCommercialDisplayStatus(
        { ...base, paymentStatus: 'Paid' },
        new Date('2026-08-20T12:00:00.000Z')
      ),
      'Paid'
    );
  });

  it('maps Stage display without migrating DB values', () => {
    assert.equal(displayCommercialStage('Draft'), 'Drafting');
    assert.equal(normalizeCommercialStage('Uploaded'), 'Draft');
    assert.equal(normalizeCommercialStage('Approved'), 'Issued');
  });

  it('seeds manual Status on issue without changing Stage', () => {
    const row = {
      documentType: 'quotation',
      status: 'Issued',
      paymentStatus: 'Unpaid',
    };
    assert.equal(seedLifecycleStatusIfBlank(row), true);
    assert.equal(row.paymentStatus, 'Sent');
    assert.equal(row.status, 'Issued');
  });

  it('applies manual lifecycle Status without changing Stage', () => {
    const row = {
      documentType: 'purchase_order',
      status: 'Issued',
      paymentStatus: 'Open',
    };
    applyCommercialLifecycleStatus(row, 'Partially Fulfilled');
    assert.equal(row.paymentStatus, 'Partially Fulfilled');
    assert.equal(row.status, 'Issued');
  });

  it('allows cancel after Issued', () => {
    assert.doesNotThrow(() => assertCancellable('Issued'));
    assert.doesNotThrow(() => assertCancellable('Draft'));
    assert.throws(() => assertCancellable('Cancelled'), /already cancelled/);
  });
});

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
  tdsAmountFromTaxableValue,
} from './financeCommercial.service.js';

describe('commercial payment / Net Receivable', () => {
  it('computes Net Receivable as 90% of pre-GST subtotal', () => {
    assert.equal(netReceivableFromPreGst(100), 90);
    assert.equal(netReceivableFromPreGst(1234.56), 1111.1);
  });

  it('computes TDS from Taxable Value, not Amount', () => {
    assert.equal(tdsAmountFromTaxableValue(1000, 10), 100);
    assert.equal(tdsAmountFromTaxableValue(1000, 1), 10);
    assert.equal(tdsAmountFromTaxableValue(1000, 2), 20);
    assert.notEqual(tdsAmountFromTaxableValue(1000, 10), 118);
  });

  it('marks Paid when amount matches Amount minus TDS', () => {
    const row = {
      status: 'Issued',
      documentType: 'client_invoice',
      subtotal: 1000,
      grandTotal: 1180,
      paidAmount: 0,
      paymentStatus: 'Unpaid',
    };
    applyCommercialPayment(row, 1080, 10);
    assert.equal(row.paymentStatus, 'Paid');
    assert.equal(row.paidAmount, 1080);
    assert.equal(row.tdsRate, 10);
    assert.equal(row.tdsAmount, 100);
  });

  it('marks Paid at full Amount when TDS is 0%', () => {
    const row = {
      status: 'Issued',
      documentType: 'client_invoice',
      subtotal: 1000,
      grandTotal: 1180,
      paidAmount: 0,
      paymentStatus: 'Unpaid',
    };
    applyCommercialPayment(row, 1180, 0);
    assert.equal(row.paymentStatus, 'Paid');
    assert.equal(row.tdsAmount, 0);
  });

  it('marks Partially Paid when amount is below Amount minus TDS', () => {
    const row = {
      status: 'Issued',
      documentType: 'bill_of_supply',
      subtotal: 1000,
      grandTotal: 1180,
      paidAmount: 0,
      paymentStatus: 'Unpaid',
    };
    applyCommercialPayment(row, 500, 10);
    assert.equal(row.paymentStatus, 'Partially Paid');
    assert.equal(row.tdsAmount, 100);
  });

  it('rejects payment above Amount', () => {
    const row = {
      status: 'Issued',
      documentType: 'client_invoice',
      subtotal: 1000,
      grandTotal: 1180,
    };
    assert.throws(() => applyCommercialPayment(row, 1181, 0), /Amount/);
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

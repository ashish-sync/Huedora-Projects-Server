import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  applyCommercialPayment,
  daysSinceDocumentApproved,
  netReceivableFromPreGst,
  resolveCommercialPaymentDisplayStatus,
} from './financeCommercial.service.js';

describe('commercial payment / Net Receivable', () => {
  it('computes Net Receivable as 90% of pre-GST subtotal', () => {
    assert.equal(netReceivableFromPreGst(100), 90);
    assert.equal(netReceivableFromPreGst(1234.56), 1111.1);
  });

  it('marks Paid when amount matches Net Receivable', () => {
    const row = {
      status: 'Issued',
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
      subtotal: 1000,
      grandTotal: 1180,
    };
    assert.throws(() => applyCommercialPayment(row, 901), /Net Receivable/);
  });

  it('counts calendar days since approval', () => {
    const row = { approvedAt: '2026-07-01T10:00:00.000Z' };
    assert.equal(daysSinceDocumentApproved(row, new Date('2026-07-31T12:00:00.000Z')), 30);
    assert.equal(daysSinceDocumentApproved(row, new Date('2026-07-30T12:00:00.000Z')), 29);
  });

  it('shows ageing Status unless Paid or Partially Paid', () => {
    const base = {
      status: 'Issued',
      approvedAt: '2026-07-01T10:00:00.000Z',
      paymentStatus: 'Unpaid',
    };
    assert.equal(
      resolveCommercialPaymentDisplayStatus(base, new Date('2026-07-05T12:00:00.000Z')),
      'Invoice Sent'
    );
    assert.equal(
      resolveCommercialPaymentDisplayStatus(base, new Date('2026-07-20T12:00:00.000Z')),
      'Invoice Due'
    );
    assert.equal(
      resolveCommercialPaymentDisplayStatus(base, new Date('2026-08-05T12:00:00.000Z')),
      'Invoice Overdue'
    );
    assert.equal(
      resolveCommercialPaymentDisplayStatus(base, new Date('2026-08-20T12:00:00.000Z')),
      'MSME Breach'
    );
    assert.equal(
      resolveCommercialPaymentDisplayStatus(
        { ...base, paymentStatus: 'Paid' },
        new Date('2026-08-20T12:00:00.000Z')
      ),
      'Paid'
    );
    assert.equal(
      resolveCommercialPaymentDisplayStatus(
        { ...base, paymentStatus: 'Partially Paid' },
        new Date('2026-08-20T12:00:00.000Z')
      ),
      'Partially Paid'
    );
    assert.equal(
      resolveCommercialPaymentDisplayStatus(
        { ...base, paymentStatus: 'Fully paid' },
        new Date('2026-08-20T12:00:00.000Z')
      ),
      'Paid'
    );
  });
});

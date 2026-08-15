import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  DOCUMENT_NUMBER_PREFIXES,
  formatDocumentNumberExample,
  parseDocumentNumber,
  documentNumberPeriod,
  validateManualDocumentNumber,
} from './documentNumbering.js';

describe('documentNumbering', () => {
  it('uses TC* PREFIX/FY/MM/SEQ examples', () => {
    assert.equal(DOCUMENT_NUMBER_PREFIXES.client_invoice, 'TCIN');
    assert.equal(formatDocumentNumberExample('client_invoice', '2026-08-15'), 'TCIN/26-27/08/001');
    assert.equal(formatDocumentNumberExample('purchase_order', '2026-08-15'), 'TCPO/26-27/08/001');
  });

  it('parses TCIN/26-27/08/001', () => {
    const parsed = parseDocumentNumber('TCIN/26-27/08/001');
    assert.equal(parsed.prefix, 'TCIN');
    assert.equal(parsed.documentType, 'client_invoice');
    assert.equal(parsed.fy, '26-27');
    assert.equal(parsed.mm, '08');
    assert.equal(parsed.sequence, 1);
    assert.equal(parsed.normalized, 'TCIN/26-27/08/001');
  });

  it('builds monthly period keys in local calendar time', () => {
    const period = documentNumberPeriod('2026-08-15');
    assert.deepEqual(period, { fy: '26-27', mm: '08', yy: '26', periodKey: '26-27_08' });
  });

  it('rejects FY-only TYLO numbers for invoices', () => {
    assert.throws(
      () => validateManualDocumentNumber('TYLO/26-27/0001', 'client_invoice'),
      /PREFIX\/FY\/MM\/SEQ/
    );
  });

  it('accepts and canonicalizes matching TC numbers', () => {
    assert.equal(
      validateManualDocumentNumber('TCIN/26-27/08/001', 'client_invoice'),
      'TCIN/26-27/08/001'
    );
  });
});

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  DOCUMENT_NUMBER_PREFIXES,
  documentPrefix,
  formatDocumentNumberExample,
  parseDocumentNumber,
  documentNumberPeriod,
  historyHoldsDocumentNumber,
  validateManualDocumentNumber,
} from './documentNumbering.js';

describe('documentNumbering', () => {
  it('uses TC* PREFIXFY/MM/SEQ examples', () => {
    assert.equal(DOCUMENT_NUMBER_PREFIXES.client_invoice, 'TCIN');
    assert.equal(formatDocumentNumberExample('client_invoice', '2026-08-15'), 'TCIN26-27/08/001');
    assert.equal(formatDocumentNumberExample('purchase_order', '2026-08-15'), 'TCPO26-27/08/001');
    assert.equal(formatDocumentNumberExample('quotation', '2026-08-15'), 'TCQT26-27/08/001');
  });

  it('parses TCIN26-27/08/001', () => {
    const parsed = parseDocumentNumber('TCIN26-27/08/001');
    assert.equal(parsed.prefix, 'TCIN');
    assert.equal(parsed.documentType, 'client_invoice');
    assert.equal(parsed.fy, '26-27');
    assert.equal(parsed.mm, '08');
    assert.equal(parsed.sequence, 1);
    assert.equal(parsed.normalized, 'TCIN26-27/08/001');
  });

  it('still parses legacy TCIN/26-27/08/001 and canonicalizes to no slash after prefix', () => {
    const parsed = parseDocumentNumber('TCIN/26-27/08/001');
    assert.equal(parsed.prefix, 'TCIN');
    assert.equal(parsed.fy, '26-27');
    assert.equal(parsed.mm, '08');
    assert.equal(parsed.sequence, 1);
    assert.equal(parsed.normalized, 'TCIN26-27/08/001');
  });

  it('builds monthly period keys in local calendar time', () => {
    const period = documentNumberPeriod('2026-08-15');
    assert.deepEqual(period, { fy: '26-27', mm: '08', yy: '26', periodKey: '26-27_08' });
  });

  it('rejects FY-only TYLO numbers for invoices', () => {
    assert.throws(
      () => validateManualDocumentNumber('TYLO/26-27/0001', 'client_invoice'),
      /PREFIXFY\/MM\/SEQ/
    );
  });

  it('accepts and canonicalizes matching TC numbers', () => {
    assert.equal(
      validateManualDocumentNumber('TCIN26-27/08/001', 'client_invoice'),
      'TCIN26-27/08/001'
    );
    assert.equal(
      validateManualDocumentNumber('TCIN/26-27/08/001', 'client_invoice'),
      'TCIN26-27/08/001'
    );
  });

  it('builds org-specific prefixes from documentCode + type suffix', () => {
    assert.equal(documentPrefix('client_invoice', 'MD'), 'MDIN');
    assert.equal(documentPrefix('purchase_order', 'RD'), 'RDPO');
    assert.equal(documentPrefix('bill_of_supply', 'RD'), 'RDBS');
    assert.equal(documentPrefix('client_invoice', 'TYLO'), 'TYLOIN');
    assert.equal(formatDocumentNumberExample('client_invoice', '2026-08-15', 'MD'), 'MDIN26-27/08/001');
    assert.equal(formatDocumentNumberExample('proforma', '2026-08-15', 'TYLO'), 'TYLOPI26-27/08/001');
  });

  it('parses MDIN and TYLOIN numbers back to org code + type', () => {
    const md = parseDocumentNumber('MDIN26-27/08/001');
    assert.equal(md.prefix, 'MDIN');
    assert.equal(md.documentType, 'client_invoice');
    assert.equal(md.documentCode, 'MD');
    const tylo = parseDocumentNumber('TYLOIN26-27/08/001');
    assert.equal(tylo.prefix, 'TYLOIN');
    assert.equal(tylo.documentType, 'client_invoice');
    assert.equal(tylo.documentCode, 'TYLO');
  });

  it('accepts a matching org prefix and rejects a mismatched one', () => {
    assert.equal(
      validateManualDocumentNumber('MDIN26-27/08/001', 'client_invoice', { documentCode: 'MD' }),
      'MDIN26-27/08/001'
    );
    assert.throws(
      () => validateManualDocumentNumber('TCIN26-27/08/001', 'client_invoice', { documentCode: 'MD' }),
      /MDIN/
    );
  });

  it('keeps corrected numbers reserved in history', () => {
    const history = [{ from: 'TCIN26-27/08/001', to: 'TCIN26-27/08/040' }];
    assert.equal(historyHoldsDocumentNumber(history, 'TCIN26-27/08/001'), true);
    assert.equal(historyHoldsDocumentNumber(history, 'TCIN/26-27/08/040'), true);
    assert.equal(historyHoldsDocumentNumber(history, 'TCIN26-27/08/002'), false);
  });
});

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  DOCUMENT_NUMBER_PREFIXES,
  documentNumberCounterName,
  formatDocumentNumberExample,
  numberingPreviewForCode,
  parseDocumentNumber,
  documentNumberPeriod,
  prefixForDocumentType,
  validateManualDocumentNumber,
} from './documentNumbering.js';

describe('documentNumbering', () => {
  it('uses TC* PREFIXFY/MM/SEQ examples', () => {
    assert.equal(DOCUMENT_NUMBER_PREFIXES.client_invoice, 'TCIN');
    assert.equal(formatDocumentNumberExample('client_invoice', '2026-08-15'), 'TCIN26-27/08/001');
    assert.equal(formatDocumentNumberExample('purchase_order', '2026-08-15'), 'TCPO26-27/08/001');
    assert.equal(formatDocumentNumberExample('quotation', '2026-08-15'), 'TCQT26-27/08/001');
  });

  it('derives org prefixes from a 2–5 letter document code', () => {
    assert.equal(prefixForDocumentType('client_invoice', 'MD'), 'MDIN');
    assert.equal(prefixForDocumentType('purchase_order', 'RD'), 'RDPO');
    assert.equal(prefixForDocumentType('bill_of_supply', 'TYLO'), 'TYLOBS');
    assert.equal(formatDocumentNumberExample('client_invoice', '2026-08-15', 'MD'), 'MDIN26-27/08/001');
    assert.equal(formatDocumentNumberExample('purchase_order', '2026-08-15', 'RD'), 'RDPO26-27/08/001');
  });

  it('previews every type suffix for a document code', () => {
    const preview = numberingPreviewForCode('MD');
    assert.equal(preview.find((row) => row.documentType === 'client_invoice')?.prefix, 'MDIN');
    assert.equal(preview.find((row) => row.documentType === 'purchase_order')?.example, 'MDPO26-27/08/001');
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

  it('parses org-specific MDIN26-27/08/001', () => {
    const parsed = parseDocumentNumber('MDIN26-27/08/001');
    assert.equal(parsed.prefix, 'MDIN');
    assert.equal(parsed.documentCode, 'MD');
    assert.equal(parsed.documentType, 'client_invoice');
    assert.equal(parsed.normalized, 'MDIN26-27/08/001');
  });

  it('accepts a matching org number and rejects a prefix mismatch', () => {
    assert.equal(
      validateManualDocumentNumber('MDIN26-27/08/001', 'client_invoice', { documentCode: 'MD' }),
      'MDIN26-27/08/001'
    );
    assert.throws(
      () => validateManualDocumentNumber('TCIN26-27/08/001', 'client_invoice', { documentCode: 'MD' }),
      /MDIN/
    );
  });

  it('uses the organisation document code in PREFIXFY examples, not TC', () => {
    assert.throws(
      () => validateManualDocumentNumber('MR26-27/10', 'client_invoice', { documentCode: 'MR' }),
      /MRIN26-27/,
    );
  });

  it('coerces MR26-27/10/058 into MRIN26-27/10/058', () => {
    assert.equal(
      validateManualDocumentNumber('MR26-27/10/058', 'client_invoice', { documentCode: 'MR' }),
      'MRIN26-27/10/058',
    );
    assert.equal(
      validateManualDocumentNumber('MR26-27/10/0058', 'client_invoice', { documentCode: 'MR' }),
      'MRIN26-27/10/058',
    );
  });

  it('keeps historical Tylo counters and scopes other orgs', () => {
    assert.equal(
      documentNumberCounterName('client_invoice', '26-27_08'),
      'financeDoc_client_invoice_26-27_08'
    );
    assert.equal(
      documentNumberCounterName('client_invoice', '26-27_08', {
        orgProfileId: 'default',
        documentCode: 'TC',
      }),
      'financeDoc_client_invoice_26-27_08'
    );
    assert.equal(
      documentNumberCounterName('client_invoice', '26-27_08', {
        orgProfileId: 'org_md',
        documentCode: 'MD',
      }),
      'financeDoc_org_md_client_invoice_26-27_08'
    );
  });
});

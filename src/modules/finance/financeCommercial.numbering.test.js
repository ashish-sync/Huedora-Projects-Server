import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  correctIssuedDocumentNumber,
  resolveNumberingDocumentCode,
} from './financeCommercial.service.js';

describe('correctIssuedDocumentNumber', () => {
  it('rejects correction before issue', async () => {
    await assert.rejects(
      () => correctIssuedDocumentNumber(
        { status: 'Draft', documentType: 'client_invoice', documentNumber: 'TCIN26-27/08/001' },
        'TCIN26-27/08/002',
        'fix typo',
      ),
      /Only issued documents/,
    );
  });

  it('requires a remark', async () => {
    await assert.rejects(
      () => correctIssuedDocumentNumber(
        { status: 'Issued', documentType: 'client_invoice', documentNumber: 'TCIN26-27/08/001' },
        'TCIN26-27/08/002',
        '   ',
      ),
      /Remark is required/,
    );
  });

  it('keeps the frozen org prefix after issue', async () => {
    await assert.rejects(
      () => correctIssuedDocumentNumber(
        {
          status: 'Issued',
          documentType: 'client_invoice',
          documentNumber: 'MDIN26-27/08/001',
          orgSnapshot: { documentCode: 'MD' },
        },
        'TCIN26-27/08/002',
        'wrong prefix',
      ),
      /MDIN/,
    );
  });

  it('uses Organisation Master code when the snapshot has no documentCode', async () => {
    await assert.rejects(
      () => correctIssuedDocumentNumber(
        {
          status: 'Issued',
          documentType: 'client_invoice',
          documentNumber: 'TCIN26-27/10/058',
          orgSnapshot: { legalName: 'MedRento' },
        },
        'TCIN26-27/10/099',
        'should be MedRento prefix',
        {},
        { documentCode: 'MR' },
      ),
      /MRIN/,
    );
  });
});

describe('resolveNumberingDocumentCode', () => {
  it('prefers the live organisation code over a missing snapshot code', () => {
    assert.equal(
      resolveNumberingDocumentCode(
        {
          documentNumber: 'TCIN26-27/10/058',
          orgSnapshot: { legalName: 'MedRento' },
        },
        { documentCode: 'MR' },
      ),
      'MR',
    );
  });
});

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { correctIssuedDocumentNumber } from './financeCommercial.service.js';

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
});

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { commercialExportValue } from './commercialDocumentExport.js';

describe('commercialExportValue', () => {
  it('maps Draft status to Drafting for the Stage column', () => {
    assert.equal(commercialExportValue({ status: 'Draft' }, 'stage'), 'Drafting');
    assert.equal(commercialExportValue({ status: 'Approved' }, 'stage'), 'Issued');
  });

  it('maps document type to its label', () => {
    assert.equal(
      commercialExportValue({ documentType: 'client_invoice' }, 'documentType'),
      'Tax Invoice',
    );
  });
});

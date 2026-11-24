import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { agreementDocumentHasContent } from './assetAgreementDocument.js';

describe('agreementDocumentHasContent', () => {
  it('accepts storageKey files', () => {
    assert.equal(agreementDocumentHasContent({ storageKey: 'agreements/a.pdf' }), true);
  });

  it('accepts textContent documents', () => {
    assert.equal(agreementDocumentHasContent({ textContent: 'Lease body' }), true);
  });

  it('rejects empty documents', () => {
    assert.equal(agreementDocumentHasContent({}), false);
    assert.equal(agreementDocumentHasContent({ storageKey: '', textContent: '  ' }), false);
    assert.equal(agreementDocumentHasContent(null), false);
  });
});

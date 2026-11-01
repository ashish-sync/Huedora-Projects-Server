import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { isPdfUpload, vendorPdfFileRef } from './vendorDocument.js';

describe('vendorDocument', () => {
  it('accepts PDF by extension or mime type', () => {
    assert.equal(isPdfUpload({ originalname: 'gst.pdf', mimetype: 'application/octet-stream' }), true);
    assert.equal(isPdfUpload({ name: 'scan.PDF', type: 'application/pdf' }), true);
    assert.equal(isPdfUpload({ originalname: 'photo.png', mimetype: 'image/png' }), false);
    assert.equal(isPdfUpload(null), false);
  });

  it('builds a stored vendor PDF reference', () => {
    assert.deepEqual(
      vendorPdfFileRef({
        filename: 'abc123.pdf',
        originalname: 'GST Certificate.pdf',
        mimetype: 'application/pdf',
      }),
      {
        filename: 'abc123.pdf',
        name: 'GST Certificate.pdf',
        url: '/uploads/logistics/vendors/abc123.pdf',
        mimeType: 'application/pdf',
      }
    );
    assert.equal(vendorPdfFileRef(null), null);
  });
});

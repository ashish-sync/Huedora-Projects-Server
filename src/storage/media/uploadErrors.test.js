import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { friendlyUploadMessage, isTabularImportPath } from '../../utils/uploadErrors.js';
import { friendlyImportMessage, IMPORT_ERROR } from '../../utils/importErrors.js';

describe('upload vs import error copy', () => {
  it('uses document size wording for multer LIMIT_FILE_SIZE (not 1000 rows)', () => {
    const msg = friendlyUploadMessage(
      { code: 'LIMIT_FILE_SIZE', message: 'File too large' },
      { maxBytes: 10 * 1024 * 1024 },
    );
    assert.match(msg, /10 MB/i);
    assert.doesNotMatch(msg, /1,000 rows|csv|excel/i);
  });

  it('keeps import wording only for import helpers', () => {
    const msg = friendlyImportMessage({ code: 'LIMIT_FILE_SIZE' });
    assert.match(msg, /3 MB/i);
    assert.match(msg, /1,000 rows/i);
  });

  it('detects tabular import paths narrowly', () => {
    assert.equal(isTabularImportPath({ originalUrl: '/api/v1/camps/import' }), true);
    assert.equal(isTabularImportPath({ originalUrl: '/api/v1/masters/products/import' }), true);
    assert.equal(
      isTabularImportPath({ originalUrl: '/api/v1/camp-ops/camps/abc/execution-documents' }),
      false,
    );
    assert.equal(isTabularImportPath({ path: '/records/x/rounds/1' }), false);
    assert.ok(IMPORT_ERROR.TOO_LARGE);
  });
});

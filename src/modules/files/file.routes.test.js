import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import jwt from 'jsonwebtoken';
import {
  relativeUploadPathFromUrl,
  signUploadFileUrl,
  toSignedUploadUrl,
} from './file.routes.js';
import { env } from '../../config/env.js';

describe('file upload URL signing', () => {
  it('extracts relative paths from /uploads URLs', () => {
    assert.equal(relativeUploadPathFromUrl('/uploads/contacts/a.pdf'), 'contacts/a.pdf');
    assert.equal(
      relativeUploadPathFromUrl('https://api.example.com/uploads/camp-ops/x%20y.pdf'),
      'camp-ops/x y.pdf'
    );
    assert.equal(relativeUploadPathFromUrl('/api/v1/files/signed?token=abc'), '');
  });

  it('converts stored upload paths to signed file links', () => {
    const signed = toSignedUploadUrl('/uploads/logistics/demo.pdf');
    assert.match(signed, /^\/api\/v1\/files\/signed\?token=/);
    const token = decodeURIComponent(signed.split('token=')[1]);
    const payload = jwt.verify(token, env.jwtAccessSecret);
    assert.equal(payload.kind, 'file');
    assert.equal(payload.path, 'logistics/demo.pdf');
  });

  it('leaves already-signed and non-upload URLs unchanged', () => {
    assert.equal(toSignedUploadUrl('/api/v1/files/signed?token=abc'), '/api/v1/files/signed?token=abc');
    assert.equal(toSignedUploadUrl('/api/v1/documents/1/download'), '/api/v1/documents/1/download');
    assert.equal(toSignedUploadUrl(''), '');
  });

  it('signUploadFileUrl strips accidental uploads/ prefix', () => {
    const signed = signUploadFileUrl('uploads/contacts/a.pdf');
    const token = decodeURIComponent(signed.split('token=')[1]);
    const payload = jwt.verify(token, env.jwtAccessSecret);
    assert.equal(payload.path, 'contacts/a.pdf');
  });
});

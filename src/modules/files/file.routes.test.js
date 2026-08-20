import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import http from 'http';
import jwt from 'jsonwebtoken';
import {
  relativeUploadPathFromUrl,
  signUploadFileUrl,
  toSignedUploadUrl,
} from './file.routes.js';
import { env } from '../../config/env.js';
import { createApp } from '../../app.js';

function requestApp(app, method, urlPath) {
  return new Promise((resolve, reject) => {
    const server = http.createServer(app);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      const req = http.request(
        {
          hostname: '127.0.0.1',
          port,
          path: urlPath,
          method,
          headers: { connection: 'close' },
        },
        (res) => {
          const chunks = [];
          res.on('data', (c) => chunks.push(c));
          res.on('end', () => {
            server.close();
            resolve({
              status: res.statusCode,
              headers: res.headers,
              body: Buffer.concat(chunks).toString('utf8'),
            });
          });
        }
      );
      req.on('error', (err) => {
        server.close();
        reject(err);
      });
      req.end();
    });
  });
}

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

describe('P1-01 secure file access', () => {
  const app = createApp();

  it('does not mint signed URLs from direct /uploads access', async () => {
    const res = await requestApp(app, 'GET', '/uploads/contacts/secret.pdf');
    assert.equal(res.status, 404);
    assert.equal(res.headers.location, undefined);
    assert.doesNotMatch(res.body, /files\/signed/);
  });

  it('rejects unauthenticated path-based /api/v1/files/* downloads', async () => {
    const res = await requestApp(app, 'GET', '/api/v1/files/contacts/secret.pdf');
    assert.ok([401, 403].includes(res.status), `expected 401/403 got ${res.status}`);
  });

  it('rejects invalid signed file tokens', async () => {
    const res = await requestApp(app, 'GET', '/api/v1/files/signed?token=not-a-jwt');
    assert.equal(res.status, 401);
  });
});

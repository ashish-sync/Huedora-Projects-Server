import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { configurePersistence } from '../store/persistence.js';
import { checkPersistenceReady } from './db.js';

test('checkPersistenceReady succeeds for writable file store', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tylo-ready-'));
  configurePersistence({ backend: 'file', dataDirectory: dir });
  const result = await checkPersistenceReady();
  assert.equal(result.ready, true);
  assert.equal(result.persistence, 'file');
});

test('liveness health handler does not require Mongo', async () => {
  const { createApp } = await import('../app.js');
  const app = createApp();
  const http = await import('http');
  const result = await new Promise((resolve, reject) => {
    const server = http.createServer(app);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      http
        .get(`http://127.0.0.1:${port}/api/v1/health`, (res) => {
          const chunks = [];
          res.on('data', (c) => chunks.push(c));
          res.on('end', () => {
            server.close();
            resolve({
              status: res.statusCode,
              body: JSON.parse(Buffer.concat(chunks).toString('utf8')),
            });
          });
        })
        .on('error', (err) => {
          server.close();
          reject(err);
        });
    });
  });
  assert.equal(result.status, 200);
  assert.equal(result.body.data.live, true);
  assert.equal(result.body.data.ready, undefined);
});

async function getReady(app) {
  const http = await import('http');
  return new Promise((resolve, reject) => {
    const server = http.createServer(app);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      http
        .get(`http://127.0.0.1:${port}/api/v1/ready`, (res) => {
          const chunks = [];
          res.on('data', (c) => chunks.push(c));
          res.on('end', () => {
            server.close();
            resolve({
              status: res.statusCode,
              body: JSON.parse(Buffer.concat(chunks).toString('utf8')),
            });
          });
        })
        .on('error', (err) => {
          server.close();
          reject(err);
        });
    });
  });
}

test('ready returns 503 when Mongo/persistence is down', async () => {
  const { createApp } = await import('../app.js');
  const app = createApp({
    checkReady: async () => ({
      ready: false,
      reason: 'MongoDB ping failed',
      persistence: 'mongo',
    }),
  });
  const result = await getReady(app);
  assert.equal(result.status, 503);
  assert.equal(result.body.data.ready, false);
  assert.match(String(result.body.data.reason || ''), /MongoDB/i);
});

test('ready recovers to 200 when persistence becomes healthy again', async () => {
  const { createApp } = await import('../app.js');
  let healthy = false;
  const app = createApp({
    checkReady: async () =>
      healthy
        ? { ready: true, persistence: 'mongo', mongoHost: 'atlas-test' }
        : { ready: false, reason: 'MongoDB ping failed', persistence: 'mongo' },
  });
  const down = await getReady(app);
  assert.equal(down.status, 503);
  healthy = true;
  const up = await getReady(app);
  assert.equal(up.status, 200);
  assert.equal(up.body.data.ready, true);
});

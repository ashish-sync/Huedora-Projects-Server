import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'http';
import express from 'express';
import { responseSizeGuard } from './responseSizeGuard.js';

test('responseSizeGuard serializes once and warns on large payloads', async () => {
  const app = express();
  app.use(responseSizeGuard({ warnBytes: 100 }));
  app.get('/big', (_req, res) => {
    res.json({ data: 'x'.repeat(200) });
  });
  app.get('/small', (_req, res) => {
    res.json({ data: 'ok' });
  });

  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();

  const big = await fetchJson(port, '/big');
  assert.equal(big.status, 200);
  assert.equal(big.headers['x-response-size-warning'], 'true');
  assert.ok(Number(big.headers['x-response-size-bytes']) >= 100);
  assert.equal(big.body.data.length, 200);

  const small = await fetchJson(port, '/small');
  assert.equal(small.status, 200);
  assert.equal(small.headers['x-response-size-warning'], undefined);
  assert.deepEqual(small.body, { data: 'ok' });

  await new Promise((resolve) => server.close(resolve));
});

function fetchJson(port, path) {
  return new Promise((resolve, reject) => {
    http
      .get(`http://127.0.0.1:${port}${path}`, (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          resolve({
            status: res.statusCode,
            headers: res.headers,
            body: JSON.parse(Buffer.concat(chunks).toString('utf8')),
          });
        });
      })
      .on('error', reject);
  });
}

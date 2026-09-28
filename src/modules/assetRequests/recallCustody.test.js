import test from 'node:test';
import assert from 'node:assert/strict';

test('recall complete uses Tylo Office custody not Warehouse', async () => {
  // Guard against regressing invalid custody value on Goods Issuance recall complete.
  const fs = await import('fs');
  const path = await import('path');
  const { fileURLToPath } = await import('url');
  const here = path.dirname(fileURLToPath(import.meta.url));
  const src = fs.readFileSync(path.join(here, 'assetRequest.routes.js'), 'utf8');
  assert.match(src, /custody:\s*'Tylo Office'/);
  assert.doesNotMatch(src, /custody:\s*'Warehouse'/);
});

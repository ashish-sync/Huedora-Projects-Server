/**
 * Static API × RBAC matrix: every mutating /api route module must declare
 * authenticate + requirePermission (or requireAdmin / public allowlist).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const modulesRoot = path.resolve(__dirname, '../modules');

/** Routes that use token auth, parent-mounted auth, or signed-URL patterns */
const PUBLIC_ROUTE_FILES = new Set([
  'auth.routes.js',
  'recipient.routes.js', // signing links
  'selfVerify.routes.js', // invite token
  'requestUpload.routes.js', // custodian upload token
  'campOps.whatsapp.routes.js', // webhook
  'file.routes.js', // signed JWT file links + authenticate on path catch-all
]);

function walk(dir, out = []) {
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name);
    const st = fs.statSync(full);
    if (st.isDirectory()) walk(full, out);
    else if (name.endsWith('.routes.js')) out.push(full);
  }
  return out;
}

function analyzeRouteFile(filePath) {
  const src = fs.readFileSync(filePath, 'utf8');
  const base = path.basename(filePath);
  const hasAuthenticate =
    (/authenticate/.test(src) && /router\.use\(\s*authenticate/.test(src)) ||
    /authenticate\s*,/.test(src) ||
    /,\s*authenticate\s*,/.test(src) ||
    /router\.(get|post|put|patch|delete)\([^)]*authenticate/.test(src);
  const hasRequirePermission = /requirePermission\s*\(/.test(src);
  const hasRequireAdmin = /requireAdmin\s*\(/.test(src);
  const mutating = /router\.(post|put|patch|delete)\s*\(/.test(src);
  const getters = /router\.get\s*\(/.test(src);
  return {
    base,
    filePath,
    hasAuthenticate,
    hasRequirePermission,
    hasRequireAdmin,
    mutating,
    getters,
    publicAllow: PUBLIC_ROUTE_FILES.has(base),
  };
}

test('API×RBAC matrix: authenticated modules gate mutations with permissions', () => {
  const files = walk(modulesRoot);
  assert.ok(files.length > 20, 'expected many route modules');
  const gaps = [];
  for (const file of files) {
    const info = analyzeRouteFile(file);
    if (info.publicAllow) continue;
    if (!info.mutating && !info.getters) continue;
    if (!info.hasAuthenticate) {
      gaps.push(`${info.base}: missing router.use(authenticate)`);
      continue;
    }
    if (info.mutating && !info.hasRequirePermission && !info.hasRequireAdmin) {
      gaps.push(`${info.base}: mutating routes without requirePermission/requireAdmin`);
    }
  }
  assert.deepEqual(gaps, [], gaps.join('\n'));
});

test('IDOR hardening: entity GET-by-id handlers must not omit isDeleted filter when soft-delete exists', () => {
  const files = walk(modulesRoot);
  const risky = [];
  for (const file of files) {
    const src = fs.readFileSync(file, 'utf8');
    const base = path.basename(file);
    if (PUBLIC_ROUTE_FILES.has(base)) continue;
    // Flag findOne({ _id: req.params.id }) without isDeleted nearby (heuristic)
    const re = /findOne\(\s*\{\s*_id:\s*req\.params\.id\s*\}\s*\)/g;
    let m;
    while ((m = re.exec(src))) {
      const window = src.slice(Math.max(0, m.index - 80), m.index + 120);
      if (!/isDeleted/.test(window)) {
        risky.push(`${base}: findOne(_id) without isDeleted in window`);
      }
    }
  }
  // Soft warning threshold — any hits are potential IDOR/soft-delete leaks
  assert.deepEqual(risky, [], risky.join('\n'));
});

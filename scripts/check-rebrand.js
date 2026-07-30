/**
 * Fail CI if the old product brand string appears in app source (excluding Indian place names).
 * Run from server/: node scripts/check-rebrand.js
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../..');

const SCAN_DIRS = [
  path.join(root, 'client', 'src'),
  path.join(root, 'client', 'index.html'),
  path.join(root, 'server', 'src'),
  path.join(root, 'docs'),
];

const SKIP_PATH_PARTS = [
  `${path.sep}node_modules${path.sep}`,
  `${path.sep}dist${path.sep}`,
  `${path.sep}geo${path.sep}seed${path.sep}`,
  `${path.sep}legacyMigration.js`,
  `${path.sep}check-rebrand.js`,
];

const BRAND_PATTERN = /dhub(?!ri)/i;

function collectFiles(target) {
  if (!fs.existsSync(target)) return [];
  const stat = fs.statSync(target);
  if (stat.isFile()) return [target];
  const out = [];
  for (const entry of fs.readdirSync(target, { withFileTypes: true })) {
    const full = path.join(target, entry.name);
    if (entry.isDirectory()) out.push(...collectFiles(full));
    else out.push(full);
  }
  return out;
}

function shouldScan(file) {
  if (!/\.(js|jsx|ts|tsx|css|html|md|json|txt|ps1)$/i.test(file)) return false;
  return !SKIP_PATH_PARTS.some((part) => file.includes(part));
}

const hits = [];
for (const dir of SCAN_DIRS) {
  for (const file of collectFiles(dir)) {
    if (!shouldScan(file)) continue;
    const text = fs.readFileSync(file, 'utf8');
    const lines = text.split(/\r?\n/);
    lines.forEach((line, index) => {
      if (BRAND_PATTERN.test(line)) {
        hits.push(`${path.relative(root, file)}:${index + 1}: ${line.trim()}`);
      }
    });
  }
}

if (hits.length) {
  console.error('[check-rebrand] Old brand references found:\n' + hits.join('\n'));
  process.exit(1);
}

console.log('[check-rebrand] OK — no old brand strings in scanned source.');

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { spawnSync } from 'node:child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const serverRoot = path.resolve(__dirname, '..');

test('bulk-import-users --generate-template writes 25 data rows', () => {
  const templatePath = path.join(__dirname, 'data', 'team-users.template.csv');
  if (fs.existsSync(templatePath)) fs.unlinkSync(templatePath);

  const result = spawnSync(process.execPath, ['scripts/bulk-import-users.js', '--generate-template'], {
    cwd: serverRoot,
    encoding: 'utf8',
  });

  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.ok(fs.existsSync(templatePath));

  const lines = fs.readFileSync(templatePath, 'utf8').trim().split('\n');
  assert.equal(lines.length, 26, 'header + 25 rows');
  assert.ok(lines[0].startsWith('email,fullName,designation'));
});

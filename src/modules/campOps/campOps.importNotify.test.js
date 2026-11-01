import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

function readSource(name) {
  return fs.readFileSync(path.join(here, name), 'utf8');
}

test('paste import notifies created camps the same way as dashboard create', () => {
  const source = readSource('manualPaste.service.js');
  assert.match(source, /import \{\s*notifyCampCreates\s*\} from '\.\/campOps\.notifications\.js'/);
  assert.match(source, /await notifyCampCreates\(createdCamps, actor\?\.id\)/);
});

test('excel import confirm notifies created camps the same way as dashboard create', () => {
  const source = readSource('campOps.routes.js');
  assert.match(source, /notifyCampCreates,/);
  assert.match(source, /await notifyCampCreates\(createdCamps, a\.id\)/);
  assert.match(source, /await notifyCampWorkflow\(\{ camp, action: 'create', actorId: a\.id \}\)/);
  assert.match(source, /await notifyCampCreates\(\[camp\], actor\(req\)\.id\)/);
});

test('public program-form create notifies with the program owner fallback', () => {
  const source = readSource('campRequestForm.service.js');
  assert.match(source, /notifyCampCreates/);
  assert.match(source, /fallbackSubjectId:\s*master\.updatedById \|\| master\.createdById \|\| null/);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { RETIRED_MESSAGE } from './movement.routes.js';

test('legacy movement API advertises retirement message', () => {
  assert.match(RETIRED_MESSAGE, /Request One/i);
  assert.match(RETIRED_MESSAGE, /Movement One/i);
  assert.match(RETIRED_MESSAGE, /retired/i);
});

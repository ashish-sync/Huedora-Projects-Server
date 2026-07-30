import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  alternateLegacyLocalEmail,
  LEGACY_LOCAL_EMAIL_SUFFIX,
  normalizeLoginEmail,
  TYLO_LOCAL_EMAIL_SUFFIX,
} from './legacyMigration.js';

test('normalizeLoginEmail maps legacy local suffix to tylo.local', () => {
  assert.equal(normalizeLoginEmail(`ops${LEGACY_LOCAL_EMAIL_SUFFIX}`), `ops${TYLO_LOCAL_EMAIL_SUFFIX}`);
  assert.equal(normalizeLoginEmail(`ops${TYLO_LOCAL_EMAIL_SUFFIX}`), `ops${TYLO_LOCAL_EMAIL_SUFFIX}`);
});

test('alternateLegacyLocalEmail returns legacy local variant', () => {
  assert.equal(
    alternateLegacyLocalEmail(`ops${TYLO_LOCAL_EMAIL_SUFFIX}`),
    `ops${LEGACY_LOCAL_EMAIL_SUFFIX}`
  );
});

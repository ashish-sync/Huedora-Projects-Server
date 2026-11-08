import test from 'node:test';
import assert from 'node:assert/strict';
import {
  allowedClientOrigins,
  corsOriginCallback,
  isAllowedClientOrigin,
} from './corsOrigins.js';

test('allows apex and www twins for Prod', () => {
  const origins = allowedClientOrigins('https://tylo.systems');
  assert.ok(origins.includes('https://tylo.systems'));
  assert.ok(origins.includes('https://www.tylo.systems'));
  assert.equal(isAllowedClientOrigin('https://www.tylo.systems', 'https://tylo.systems'), true);
  assert.equal(isAllowedClientOrigin('https://evil.example', 'https://tylo.systems'), false);
});

test('accepts a comma-separated CLIENT_ORIGIN list', () => {
  const origins = allowedClientOrigins('https://tylo.systems, https://qa.tylo.systems');
  assert.ok(origins.includes('https://qa.tylo.systems'));
  assert.ok(origins.includes('https://www.qa.tylo.systems'));
});

test('CORS middleware callback applies the configured aliases and rejects unknown browsers', () => {
  const evaluate = (origin) => {
    let result;
    corsOriginCallback(origin, (_err, allowed) => {
      result = allowed;
    }, 'https://tylo.systems, https://qa.tylo.systems');
    return result;
  };

  assert.equal(evaluate('https://www.tylo.systems'), true);
  assert.equal(evaluate('https://qa.tylo.systems'), true);
  assert.equal(evaluate('https://evil.example'), false);
  assert.equal(evaluate(undefined), true);
});

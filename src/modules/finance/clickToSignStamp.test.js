import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CLICK_TO_SIGN_MODE,
  formatDigitallySignedOn,
  isClickToSignSignature,
  normalizeSignatoryDisplayName,
} from './clickToSignStamp.js';

test('normalizeSignatoryDisplayName uppercases', () => {
  assert.equal(normalizeSignatoryDisplayName('Bikram Binay Srivastava'), 'BIKRAM BINAY SRIVASTAVA');
});

test('formatDigitallySignedOn includes seconds', () => {
  const stamp = formatDigitallySignedOn('2026-10-01T17:55:11.000');
  assert.match(stamp, /^Digitally signed on \d{2}-\d{2}-2026 \d{2}:\d{2}:\d{2}$/);
});

test('isClickToSignSignature requires mode name and signedAt', () => {
  assert.equal(isClickToSignSignature({ mode: CLICK_TO_SIGN_MODE, signatoryName: 'A', signedAt: '2026-01-01' }), true);
  assert.equal(isClickToSignSignature({ mode: CLICK_TO_SIGN_MODE, signatoryName: '', signedAt: '2026-01-01' }), false);
  assert.equal(isClickToSignSignature({ signatoryName: 'A', signedAt: '2026-01-01' }), false);
});

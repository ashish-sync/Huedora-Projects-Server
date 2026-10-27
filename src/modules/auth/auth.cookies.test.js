import test from 'node:test';
import assert from 'node:assert/strict';
import { refreshCookieOptions } from './auth.cookies.js';

test('production refresh cookie is SameSite=None and Secure for cross-origin SPA', () => {
  const prev = process.env.COOKIE_SAMESITE;
  delete process.env.COOKIE_SAMESITE;
  try {
    const opts = refreshCookieOptions({ nodeEnv: 'production' });
    assert.equal(opts.sameSite, 'none');
    assert.equal(opts.secure, true);
    assert.equal(opts.httpOnly, true);
    assert.equal(opts.path, '/api/v1/auth');
  } finally {
    if (prev == null) delete process.env.COOKIE_SAMESITE;
    else process.env.COOKIE_SAMESITE = prev;
  }
});

test('non-production refresh cookie stays SameSite=Lax', () => {
  const prev = process.env.COOKIE_SAMESITE;
  delete process.env.COOKIE_SAMESITE;
  try {
    const qa = refreshCookieOptions({ nodeEnv: 'qa', secure: true });
    assert.equal(qa.sameSite, 'lax');
    assert.equal(qa.secure, true);

    const dev = refreshCookieOptions({ nodeEnv: 'development' });
    assert.equal(dev.sameSite, 'lax');
    assert.equal(dev.secure, false);
  } finally {
    if (prev == null) delete process.env.COOKIE_SAMESITE;
    else process.env.COOKIE_SAMESITE = prev;
  }
});

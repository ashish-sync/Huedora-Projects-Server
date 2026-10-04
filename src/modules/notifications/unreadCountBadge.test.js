import test from 'node:test';
import assert from 'node:assert/strict';
import { shouldReturnNotModified, weakUnreadEtag } from './unreadCountBadge.js';

test('weakUnreadEtag is stable for identical badge payloads', () => {
  const a = weakUnreadEtag(2, 5, ['id-a', 'id-b']);
  const b = weakUnreadEtag(2, 5, ['id-a', 'id-b']);
  assert.equal(a, b);
  assert.match(a, /^W\/"n:2:5:2:id-a"$/);
});

test('weakUnreadEtag changes when counts or sample head change', () => {
  const base = weakUnreadEtag(2, 5, ['id-a']);
  assert.notEqual(base, weakUnreadEtag(3, 5, ['id-a']));
  assert.notEqual(base, weakUnreadEtag(2, 6, ['id-a']));
  assert.notEqual(base, weakUnreadEtag(2, 5, ['id-z']));
});

test('shouldReturnNotModified is true only on exact ETag match', () => {
  const etag = weakUnreadEtag(1, 0, ['n1']);
  assert.equal(shouldReturnNotModified(etag, etag), true);
  assert.equal(shouldReturnNotModified(` ${etag} `, etag), true);
  assert.equal(shouldReturnNotModified('', etag), false);
  assert.equal(shouldReturnNotModified(weakUnreadEtag(2, 0, ['n1']), etag), false);
});

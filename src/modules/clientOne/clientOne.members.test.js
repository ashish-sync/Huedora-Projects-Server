import test from 'node:test';
import assert from 'node:assert/strict';
import {
  actorCapabilities,
  applyMemberCampVisibility,
  buildMemberTree,
  publicMemberDto,
} from './clientOne.members.js';

test('publicMemberDto never exposes pinHash', () => {
  const dto = publicMemberDto({
    _id: 'm1',
    fullName: 'Ada',
    mobile: '9876543210',
    level: 'ho',
    pinHash: 'secret-hash',
    status: 'active',
    regions: [],
    locations: [],
  });
  assert.equal(dto.id, 'm1');
  assert.equal(dto.fullName, 'Ada');
  assert.equal(dto.pin, undefined);
  assert.equal(dto.pinHash, undefined);
});

test('publicMemberDto can include one-time pin when requested', () => {
  const dto = publicMemberDto({
    _id: 'm1',
    fullName: 'Ada',
    mobile: '9876543210',
    level: 'ho',
    pinHash: 'secret-hash',
    status: 'active',
  }, { includePin: true, pin: '123456' });
  assert.equal(dto.pin, '123456');
  assert.equal(dto.pinHash, undefined);
});

test('buildMemberTree nests HO → Regional → Location', () => {
  const tree = buildMemberTree([
    { _id: 'loc1', fullName: 'Loc', level: 'location', parentId: 'reg1', status: 'active' },
    { _id: 'ho1', fullName: 'Head', level: 'ho', parentId: null, status: 'active' },
    { _id: 'reg1', fullName: 'Reg', level: 'regional', parentId: 'ho1', status: 'active' },
  ]);
  assert.equal(tree.length, 1);
  assert.equal(tree[0].id, 'ho1');
  assert.equal(tree[0].children.length, 1);
  assert.equal(tree[0].children[0].id, 'reg1');
  assert.equal(tree[0].children[0].children[0].id, 'loc1');
});

test('actorCapabilities: programme shared-PIN acts as HO admin', () => {
  const caps = actorCapabilities({ access: { accessId: 'A1' }, member: null, isPreview: false });
  assert.equal(caps.canManage, true);
  assert.equal(caps.role, 'programme');
  assert.equal(caps.maxCreateLevel, 'ho');
});

test('actorCapabilities: regional may only create location', () => {
  const caps = actorCapabilities({
    access: { accessId: 'A1' },
    member: { _id: 'r1', level: 'regional', status: 'active' },
    isPreview: false,
  });
  assert.equal(caps.canManage, true);
  assert.equal(caps.maxCreateLevel, 'location');
});

test('actorCapabilities: location cannot manage others', () => {
  const caps = actorCapabilities({
    access: { accessId: 'A1' },
    member: { _id: 'l1', level: 'location', status: 'active' },
    isPreview: false,
  });
  assert.equal(caps.canManage, false);
  assert.equal(caps.maxCreateLevel, null);
});

test('applyMemberCampVisibility scopes regional and location', () => {
  const base = { clientId: 'c1', isDeleted: false };
  const regional = applyMemberCampVisibility(base, {
    level: 'regional',
    regions: ['Maharashtra', 'Goa'],
  });
  assert.deepEqual(regional.state.$in, ['Maharashtra', 'Goa']);

  const location = applyMemberCampVisibility(base, {
    level: 'location',
    locations: ['Pune', 'Nashik'],
  });
  assert.deepEqual(location.city.$in, ['Pune', 'Nashik']);

  const ho = applyMemberCampVisibility(base, { level: 'ho' });
  assert.equal(ho.state, undefined);
  assert.equal(ho.city, undefined);
});

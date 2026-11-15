import test from 'node:test';
import assert from 'node:assert/strict';
import {
  actorCapabilities,
  applyMemberCampVisibility,
  buildMemberTree,
  publicMemberDto,
  validateHierarchyPayload,
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

test('buildMemberTree nests 4-tier hierarchy: Zonal → Regional → Area → Territory', () => {
  const tree = buildMemberTree([
    { _id: 'ter1', fullName: 'Territory Rep', designation: 'Territory', level: 'territory', parentId: 'ar1', status: 'active' },
    { _id: 'zon1', fullName: 'Zonal Head', designation: 'Zonal', level: 'zonal', parentId: null, status: 'active' },
    { _id: 'ar1', fullName: 'Area Manager', designation: 'Area', level: 'area', parentId: 'reg1', status: 'active' },
    { _id: 'reg1', fullName: 'Regional Lead', designation: 'Regional', level: 'regional', parentId: 'zon1', status: 'active' },
  ]);
  assert.equal(tree.length, 1);
  assert.equal(tree[0].id, 'zon1');
  assert.equal(tree[0].children.length, 1);
  assert.equal(tree[0].children[0].id, 'reg1');
  assert.equal(tree[0].children[0].children.length, 1);
  assert.equal(tree[0].children[0].children[0].id, 'ar1');
  assert.equal(tree[0].children[0].children[0].children.length, 1);
  assert.equal(tree[0].children[0].children[0].children[0].id, 'ter1');
});

test('validateHierarchyPayload enforces strict 4-tier reporting rules and geo restrictions', () => {
  // Zonal: cannot have parent
  assert.throws(
    () => validateHierarchyPayload({ designation: 'Zonal', parent: { _id: 'p1', designation: 'Zonal' }, regions: [], locations: [] }),
    /Zonal users do not report to another member/
  );
  const zonalValid = validateHierarchyPayload({ designation: 'Zonal', parent: null, regions: ['Maharashtra'], locations: ['Mumbai'] });
  assert.equal(zonalValid.parentId, null);

  // Regional: must report to Zonal
  assert.throws(
    () => validateHierarchyPayload({ designation: 'Regional', parent: null, regions: ['Maharashtra'], locations: [] }),
    /Regional users must report to an active Zonal user/
  );
  assert.throws(
    () => validateHierarchyPayload({ designation: 'Regional', parent: { _id: 'p1', designation: 'Area' }, regions: ['Maharashtra'], locations: [] }),
    /Regional users must report to an active Zonal user/
  );
  // Regional: geo check against Zonal parent
  assert.throws(
    () => validateHierarchyPayload({
      designation: 'Regional',
      parent: { _id: 'z1', designation: 'Zonal', regions: ['Maharashtra', 'Gujarat'] },
      regions: ['Karnataka'], // Not in parent's regions
      locations: [],
    }),
    /Selected states \(Karnataka\) must be within reporting manager's assigned states/
  );
  const regionalValid = validateHierarchyPayload({
    designation: 'Regional',
    parent: { _id: 'z1', designation: 'Zonal', regions: ['Maharashtra', 'Gujarat'] },
    regions: ['Maharashtra'],
    locations: ['Mumbai'],
  });
  assert.equal(regionalValid.parentId, 'z1');

  // Area: must report to Regional
  assert.throws(
    () => validateHierarchyPayload({ designation: 'Area', parent: { _id: 'z1', designation: 'Zonal' }, regions: [], locations: [] }),
    /Area users must report to an active Regional user/
  );
  // Area: geo check against Regional parent
  assert.throws(
    () => validateHierarchyPayload({
      designation: 'Area',
      parent: { _id: 'r1', designation: 'Regional', regions: ['Maharashtra'], locations: ['Pune', 'Mumbai'] },
      regions: ['Maharashtra'],
      locations: ['Nashik'], // Not in parent's locations
    }),
    /Selected cities \(Nashik\) must be within reporting manager's assigned cities/
  );
  const areaValid = validateHierarchyPayload({
    designation: 'Area',
    parent: { _id: 'r1', designation: 'Regional', regions: ['Maharashtra'], locations: ['Pune', 'Mumbai'] },
    regions: ['Maharashtra'],
    locations: ['Pune'],
  });
  assert.equal(areaValid.parentId, 'r1');

  // Territory: must report to Area
  assert.throws(
    () => validateHierarchyPayload({ designation: 'Territory', parent: { _id: 'z1', designation: 'Zonal' }, regions: [], locations: [] }),
    /Territory users must report to an active Area user/
  );
  const territoryValid = validateHierarchyPayload({
    designation: 'Territory',
    parent: { _id: 'a1', designation: 'Area', regions: ['Maharashtra'], locations: ['Pune'] },
    regions: ['Maharashtra'],
    locations: ['Pune'],
  });
  assert.equal(territoryValid.parentId, 'a1');
});

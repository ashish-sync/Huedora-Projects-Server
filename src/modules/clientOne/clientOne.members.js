import { AppError } from '../../utils/helpers.js';
import { ClientOneAccess, ClientOneMember } from './clientOne.model.js';
import {
  hashClientOnePin,
  mintClientOnePin,
  normalizeClientOnePin,
  resolveClientOnePinInput,
} from './clientOne.service.js';

export const MEMBER_LEVELS = Object.freeze([
  'zonal',
  'regional',
  'area',
  'territory',
  'ho',
  'location',
]);

export const DESIGNATION_OPTIONS = Object.freeze([
  'Zonal',
  'Regional',
  'Area',
  'Territory',
]);

export function normalizeTier(value) {
  const norm = String(value || '').trim().toLowerCase();
  if (norm === 'zonal' || norm === 'ho') return 'zonal';
  if (norm === 'regional') return 'regional';
  if (norm === 'area') return 'area';
  if (norm === 'territory' || norm === 'location') return 'territory';
  return norm;
}

export function tierToCanonicalLevel(value) {
  const t = normalizeTier(value);
  if (t === 'zonal') return 'zonal';
  if (t === 'regional') return 'regional';
  if (t === 'area') return 'area';
  if (t === 'territory') return 'territory';
  return t || 'zonal';
}

export function tierToCanonicalDesignation(value) {
  const t = normalizeTier(value);
  if (t === 'zonal') return 'Zonal';
  if (t === 'regional') return 'Regional';
  if (t === 'area') return 'Area';
  if (t === 'territory') return 'Territory';
  return String(value || '').trim() || 'Zonal';
}

const TIER_RANKS = Object.freeze({
  zonal: 0,
  ho: 0,
  regional: 1,
  area: 2,
  territory: 3,
  location: 3,
});

function trimStr(value) {
  return String(value || '').trim();
}

function normalizeMobile(raw) {
  return String(raw || '').replace(/\D+/g, '');
}

function normalizeLabels(list) {
  if (!Array.isArray(list)) return [];
  const seen = new Set();
  const out = [];
  for (const item of list) {
    const label = trimStr(item);
    if (!label) continue;
    const key = label.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(label);
  }
  return out;
}

export function publicMemberDto(row, { includePin = false, pin = null } = {}) {
  if (!row) return null;
  const dto = {
    id: String(row._id),
    clientMasterId: row.clientMasterId ? String(row.clientMasterId) : null,
    clientId: row.clientId ? String(row.clientId) : null,
    accessId: row.accessId || '',
    fullName: trimStr(row.fullName),
    mobile: trimStr(row.mobile),
    email: trimStr(row.email),
    designation: trimStr(row.designation),
    level: row.level,
    parentId: row.parentId ? String(row.parentId) : null,
    regions: Array.isArray(row.regions) ? row.regions.slice() : [],
    locations: Array.isArray(row.locations) ? row.locations.slice() : [],
    status: row.status === 'inactive' ? 'inactive' : 'active',
    lastLoginAt: row.lastLoginAt || null,
    createdAt: row.createdAt || null,
    updatedAt: row.updatedAt || null,
  };
  if (includePin && pin) dto.pin = pin;
  return dto;
}

export function buildMemberTree(members = []) {
  const nodes = new Map();
  const roots = [];
  for (const row of members) {
    const dto = publicMemberDto(row);
    nodes.set(dto.id, { ...dto, children: [] });
  }
  for (const node of nodes.values()) {
    if (node.parentId && nodes.has(node.parentId)) {
      nodes.get(node.parentId).children.push(node);
    } else {
      roots.push(node);
    }
  }
  const sortRec = (list) => {
    list.sort((a, b) => {
      const rankA = TIER_RANKS[normalizeTier(a.level || a.designation)] ?? 99;
      const rankB = TIER_RANKS[normalizeTier(b.level || b.designation)] ?? 99;
      const levelRank = rankA - rankB;
      if (levelRank !== 0) return levelRank;
      return String(a.fullName).localeCompare(String(b.fullName));
    });
    list.forEach((n) => sortRec(n.children));
  };
  sortRec(roots);
  return roots;
}

async function assertPinHashAvailable(pinHash, { excludeMemberId = null, excludeAccessId = null } = {}) {
  if (!pinHash) throw new AppError('Invalid PIN', 400, 'VALIDATION_ERROR');
  const memberClash = await ClientOneMember.findOne({ pinHash, status: 'active' });
  if (memberClash && String(memberClash._id) !== String(excludeMemberId || '')) {
    throw new AppError('That PIN is already in use. Choose a different 6-digit PIN.', 409, 'PIN_IN_USE');
  }
  const accessClash = await ClientOneAccess.findOne({ pinHash, isActive: true, revokedAt: null });
  if (accessClash && String(accessClash._id) !== String(excludeAccessId || '')) {
    throw new AppError('That PIN is already in use. Choose a different 6-digit PIN.', 409, 'PIN_IN_USE');
  }
}

export async function mintUniqueMemberPin(exclude = {}) {
  let pin = mintClientOnePin();
  let pinHash = hashClientOnePin(pin);
  for (let i = 0; i < 12; i += 1) {
    try {
      await assertPinHashAvailable(pinHash, exclude);
      return { pin, pinHash };
    } catch (err) {
      if (err?.code !== 'PIN_IN_USE') throw err;
      pin = mintClientOnePin();
      pinHash = hashClientOnePin(pin);
    }
  }
  throw new AppError('Unable to allocate a unique PIN. Try again.', 500, 'PIN_ALLOCATION_FAILED');
}

export function actorCapabilities(session = {}) {
  const { access, member, isPreview } = session;
  if (isPreview || access?.isPreview) {
    return { canManage: true, role: 'preview', actorMemberId: null, maxCreateLevel: 'ho' };
  }
  if (member) {
    if (member.status === 'inactive') {
      return { canManage: false, role: 'inactive', actorMemberId: String(member._id), maxCreateLevel: null };
    }
    const tier = normalizeTier(member.level || member.designation);
    if (tier === 'zonal' || member.level === 'ho') {
      return { canManage: true, role: 'ho', actorMemberId: String(member._id), maxCreateLevel: 'ho' };
    }
    if (tier === 'regional') {
      return { canManage: true, role: 'regional', actorMemberId: String(member._id), maxCreateLevel: 'location' };
    }
    if (tier === 'area') {
      return { canManage: true, role: 'area', actorMemberId: String(member._id), maxCreateLevel: 'location' };
    }
    return { canManage: false, role: 'location', actorMemberId: String(member._id), maxCreateLevel: null };
  }
  // Legacy programme shared-PIN session — treat as programme HO admin during migration.
  return { canManage: true, role: 'programme', actorMemberId: null, maxCreateLevel: 'ho' };
}

function collectDescendantIds(members, rootId) {
  const byParent = new Map();
  for (const row of members) {
    const pid = row.parentId ? String(row.parentId) : '';
    if (!byParent.has(pid)) byParent.set(pid, []);
    byParent.get(pid).push(String(row._id));
  }
  const out = new Set();
  const stack = [String(rootId)];
  while (stack.length) {
    const id = stack.pop();
    const kids = byParent.get(id) || [];
    for (const kid of kids) {
      if (out.has(kid)) continue;
      out.add(kid);
      stack.push(kid);
    }
  }
  return out;
}

export function filterMembersForActor(members, session) {
  const caps = actorCapabilities(session);
  const list = Array.isArray(members) ? members : [];
  if (caps.role === 'preview' || caps.role === 'programme' || caps.role === 'zonal' || caps.role === 'ho') {
    return list;
  }
  if ((caps.role === 'regional' || caps.role === 'area') && caps.actorMemberId) {
    const allowed = collectDescendantIds(list, caps.actorMemberId);
    allowed.add(caps.actorMemberId);
    return list.filter((row) => allowed.has(String(row._id)));
  }
  if ((caps.role === 'territory' || caps.role === 'location') && caps.actorMemberId) {
    return list.filter((row) => String(row._id) === caps.actorMemberId);
  }
  return [];
}

export async function listMembersForAccess(access, session) {
  const masterId = access?.clientMasterId;
  if (!masterId) return [];
  const rows = await ClientOneMember.find({ clientMasterId: masterId });
  const list = Array.isArray(rows) ? rows : [];
  return filterMembersForActor(list, session);
}

async function loadParentOrThrow(parentId, access) {
  if (!parentId) return null;
  const parent = await ClientOneMember.findOne({
    _id: String(parentId),
    clientMasterId: access.clientMasterId,
  });
  if (!parent) throw new AppError('Reporting manager not found', 400, 'VALIDATION_ERROR');
  if (parent.status === 'inactive') {
    throw new AppError('Reporting manager is inactive', 400, 'VALIDATION_ERROR');
  }
  return parent;
}

function validateHierarchyPayload({ level, designation, parent, regions, locations }) {
  const tier = normalizeTier(designation || level);
  if (!['zonal', 'regional', 'area', 'territory', 'ho', 'location'].includes(tier)) {
    throw new AppError('Designation must be Zonal, Regional, Area, or Territory', 400, 'VALIDATION_ERROR');
  }

  if (tier === 'zonal') {
    if (parent) {
      throw new AppError('Zonal users do not report to another member', 400, 'VALIDATION_ERROR');
    }
    return { parentId: null, regions, locations };
  }

  if (tier === 'regional') {
    if (!parent || normalizeTier(parent.level || parent.designation) !== 'zonal') {
      throw new AppError('Regional users must report to an active Zonal user', 400, 'VALIDATION_ERROR');
    }
    // Geographical access restriction: states must be within parent's states if parent has any assigned
    if (Array.isArray(parent.regions) && parent.regions.length > 0 && regions.length > 0) {
      const parentRegSet = new Set(parent.regions.map((r) => r.toLowerCase()));
      const invalid = regions.filter((r) => !parentRegSet.has(r.toLowerCase()));
      if (invalid.length > 0) {
        throw new AppError(
          `Selected states (${invalid.join(', ')}) must be within reporting manager's assigned states`,
          400,
          'VALIDATION_ERROR',
        );
      }
    }
    return { parentId: String(parent._id), regions, locations };
  }

  if (tier === 'area') {
    if (!parent || normalizeTier(parent.level || parent.designation) !== 'regional') {
      throw new AppError('Area users must report to an active Regional user', 400, 'VALIDATION_ERROR');
    }
    // Geographical access restriction: states and cities must be within parent's assigned scope
    if (Array.isArray(parent.regions) && parent.regions.length > 0 && regions.length > 0) {
      const parentRegSet = new Set(parent.regions.map((r) => r.toLowerCase()));
      const invalid = regions.filter((r) => !parentRegSet.has(r.toLowerCase()));
      if (invalid.length > 0) {
        throw new AppError(
          `Selected states (${invalid.join(', ')}) must be within reporting manager's assigned states`,
          400,
          'VALIDATION_ERROR',
        );
      }
    }
    if (Array.isArray(parent.locations) && parent.locations.length > 0 && locations.length > 0) {
      const parentLocSet = new Set(parent.locations.map((l) => l.toLowerCase()));
      const invalid = locations.filter((l) => !parentLocSet.has(l.toLowerCase()));
      if (invalid.length > 0) {
        throw new AppError(
          `Selected cities (${invalid.join(', ')}) must be within reporting manager's assigned cities`,
          400,
          'VALIDATION_ERROR',
        );
      }
    }
    return { parentId: String(parent._id), regions, locations };
  }

  // territory / location
  if (tier === 'territory') {
    const parentTier = normalizeTier(parent?.level || parent?.designation);
    if (!parent || (parentTier !== 'area' && parentTier !== 'regional')) {
      throw new AppError('Territory users must report to an active Area user', 400, 'VALIDATION_ERROR');
    }
    // Geographical access restriction: states and cities must be within parent's assigned scope
    if (Array.isArray(parent.regions) && parent.regions.length > 0 && regions.length > 0) {
      const parentRegSet = new Set(parent.regions.map((r) => r.toLowerCase()));
      const invalid = regions.filter((r) => !parentRegSet.has(r.toLowerCase()));
      if (invalid.length > 0) {
        throw new AppError(
          `Selected states (${invalid.join(', ')}) must be within reporting manager's assigned states`,
          400,
          'VALIDATION_ERROR',
        );
      }
    }
    if (Array.isArray(parent.locations) && parent.locations.length > 0 && locations.length > 0) {
      const parentLocSet = new Set(parent.locations.map((l) => l.toLowerCase()));
      const invalid = locations.filter((l) => !parentLocSet.has(l.toLowerCase()));
      if (invalid.length > 0) {
        throw new AppError(
          `Selected cities (${invalid.join(', ')}) must be within reporting manager's assigned cities`,
          400,
          'VALIDATION_ERROR',
        );
      }
    }
    return { parentId: String(parent._id), regions, locations };
  }

  throw new AppError('Invalid designation or hierarchy level', 400, 'VALIDATION_ERROR');
}

function assertActorMayWrite(caps, { level, designation, parentId, target } = {}) {
  if (!caps.canManage) {
    throw new AppError('You do not have permission to manage users', 403, 'FORBIDDEN');
  }
  const tier = normalizeTier(designation || level);
  if (caps.role === 'regional') {
    if (tier && tier !== 'area' && tier !== 'territory' && tier !== 'location') {
      throw new AppError('Regional users may only create Area or Territory users', 403, 'FORBIDDEN');
    }
  }
  if (caps.role === 'area') {
    if (tier && tier !== 'territory' && tier !== 'location') {
      throw new AppError('Area users may only create Territory users', 403, 'FORBIDDEN');
    }
  }
}

export async function createMember(access, session, body = {}) {
  const caps = actorCapabilities(session);
  const designationRaw = trimStr(body.designation);
  const tier = normalizeTier(designationRaw || body.level);
  const designation = tierToCanonicalDesignation(designationRaw || tier);
  const level = tierToCanonicalLevel(tier || body.level);

  assertActorMayWrite(caps, { level, designation, parentId: body.parentId });

  const fullName = trimStr(body.fullName);
  const mobile = normalizeMobile(body.mobile);
  if (!fullName) throw new AppError('Full name is required', 400, 'VALIDATION_ERROR');
  if (mobile.length < 10) throw new AppError('Enter a valid mobile number', 400, 'VALIDATION_ERROR');

  const mobileClash = await ClientOneMember.findOne({
    clientId: access.clientId,
    mobile,
  });
  if (mobileClash) {
    throw new AppError('Mobile number already exists for this client', 409, 'MOBILE_IN_USE');
  }

  const parent = await loadParentOrThrow(body.parentId, access);
  const regions = normalizeLabels(body.regions || body.regionNames || (body.region ? [body.region] : []));
  const locations = normalizeLabels(body.locations || body.locationNames || (body.location ? [body.location] : []));
  const scoped = validateHierarchyPayload({ level, designation, parent, regions, locations });

  const { pin, pinHash } = await mintUniqueMemberPin({
    excludeAccessId: access._id,
  });

  const now = new Date().toISOString();
  const created = await ClientOneMember.create({
    clientMasterId: access.clientMasterId,
    clientId: access.clientId,
    accessId: access.accessId,
    fullName,
    mobile,
    email: trimStr(body.email).toLowerCase(),
    designation,
    level,
    parentId: scoped.parentId,
    regions: scoped.regions,
    locations: scoped.locations,
    pinHash,
    status: body.status === 'inactive' ? 'inactive' : 'active',
    failedAttempts: 0,
    lockedUntil: null,
    lastLoginAt: null,
    createdByMemberId: caps.actorMemberId,
    createdByAccessId: access.accessId || '',
    createdAt: now,
    updatedAt: now,
  });

  return publicMemberDto(created, { includePin: true, pin });
}

export async function importMembers(access, session, rows = []) {
  const list = Array.isArray(rows) ? rows : [];
  if (!list.length) {
    throw new AppError('No rows provided for import', 400, 'VALIDATION_ERROR');
  }

  const created = [];
  const errors = [];

  const existingMembers = await ClientOneMember.find({ clientMasterId: access.clientMasterId });
  const membersByMobile = new Map();
  for (const m of existingMembers) {
    membersByMobile.set(normalizeMobile(m.mobile), m);
  }

  const parseList = (val) => {
    if (Array.isArray(val)) return val;
    return String(val || '')
      .split(/[,;|]+/)
      .map((s) => s.trim())
      .filter(Boolean);
  };

  for (let idx = 0; idx < list.length; idx += 1) {
    const raw = list[idx] || {};
    const rowNum = idx + 1;
    try {
      const fullName = trimStr(raw.fullName || raw.name || raw['full name']);
      const mobile = normalizeMobile(raw.mobile || raw.phone || raw['mobile number']);
      const designationRaw = trimStr(raw.designation);

      if (!fullName) throw new Error('Full name is required');
      if (mobile.length < 10) throw new Error('Valid 10-digit mobile number is required');

      let parentId = raw.parentId ? String(raw.parentId) : null;
      const reportingMobile = normalizeMobile(
        raw.reportingToMobile || raw.reportingTo || raw.reportingManagerMobile || raw['reporting manager'] || raw['reporting to'],
      );
      if (!parentId && reportingMobile && membersByMobile.has(reportingMobile)) {
        parentId = String(membersByMobile.get(reportingMobile)._id || membersByMobile.get(reportingMobile).id);
      }

      const regions = parseList(raw.states || raw.state || raw.regions || raw.region);
      const locations = parseList(raw.cities || raw.city || raw.locations || raw.location);

      const memberDto = await createMember(access, session, {
        fullName,
        mobile,
        designation: designationRaw,
        parentId,
        regions,
        locations,
        status: raw.status || 'active',
      });

      membersByMobile.set(mobile, memberDto);
      created.push(memberDto);
    } catch (err) {
      errors.push({
        row: rowNum,
        name: raw.fullName || raw.name || `Row ${rowNum}`,
        error: err.message || 'Validation failed',
      });
    }
  }

  return { created, errors, total: list.length };
}

export async function updateMember(access, session, memberId, body = {}) {
  const caps = actorCapabilities(session);
  const row = await ClientOneMember.findOne({
    _id: String(memberId),
    clientMasterId: access.clientMasterId,
  });
  if (!row) throw new AppError('User not found', 404, 'NOT_FOUND');

  const nextDesignationRaw = body.designation != null ? trimStr(body.designation) : row.designation;
  const nextTier = normalizeTier(nextDesignationRaw || body.level || row.level);
  const nextDesignation = tierToCanonicalDesignation(nextDesignationRaw || nextTier);
  const nextLevel = tierToCanonicalLevel(nextTier || body.level || row.level);

  assertActorMayWrite(caps, {
    target: row,
    level: nextLevel,
    designation: nextDesignation,
    parentId: body.parentId !== undefined ? body.parentId : row.parentId,
  });

  if (body.fullName != null) {
    const fullName = trimStr(body.fullName);
    if (!fullName) throw new AppError('Full name is required', 400, 'VALIDATION_ERROR');
    row.fullName = fullName;
  }
  if (body.mobile != null) {
    const mobile = normalizeMobile(body.mobile);
    if (mobile.length < 10) throw new AppError('Enter a valid mobile number', 400, 'VALIDATION_ERROR');
    const clash = await ClientOneMember.findOne({ clientId: access.clientId, mobile });
    if (clash && String(clash._id) !== String(row._id)) {
      throw new AppError('Mobile number already exists for this client', 409, 'MOBILE_IN_USE');
    }
    row.mobile = mobile;
  }
  if (body.email != null) row.email = trimStr(body.email).toLowerCase();
  if (body.designation != null) row.designation = nextDesignation;
  if (body.status != null) {
    row.status = body.status === 'inactive' ? 'inactive' : 'active';
  }

  const parentId = body.parentId !== undefined ? body.parentId : row.parentId;
  const parent = await loadParentOrThrow(parentId, access);
  const regions = body.regions != null || body.region != null || body.regionNames != null
    ? normalizeLabels(body.regions || body.regionNames || (body.region ? [body.region] : []))
    : (Array.isArray(row.regions) ? row.regions : []);
  const locations = body.locations != null || body.location != null || body.locationNames != null
    ? normalizeLabels(body.locations || body.locationNames || (body.location ? [body.location] : []))
    : (Array.isArray(row.locations) ? row.locations : []);

  if (body.level != null || body.designation != null || body.parentId !== undefined || body.regions != null || body.locations != null
    || body.region != null || body.location != null) {
    const scoped = validateHierarchyPayload({
      level: nextLevel,
      designation: nextDesignation,
      parent,
      regions,
      locations,
    });
    // Prevent cycles: parent cannot be self or descendant
    if (scoped.parentId && String(scoped.parentId) === String(row._id)) {
      throw new AppError('A user cannot report to themselves', 400, 'VALIDATION_ERROR');
    }
    if (scoped.parentId) {
      const all = await ClientOneMember.find({ clientMasterId: access.clientMasterId });
      const descendants = collectDescendantIds(all, row._id);
      if (descendants.has(String(scoped.parentId))) {
        throw new AppError('Reporting manager cannot be a subordinate', 400, 'VALIDATION_ERROR');
      }
    }
    row.level = nextLevel;
    row.designation = nextDesignation;
    row.parentId = scoped.parentId;
    row.regions = scoped.regions;
    row.locations = scoped.locations;
  }

  row.updatedAt = new Date().toISOString();
  await row.save();
  return publicMemberDto(row);
}

export async function rotateMemberPin(access, session, memberId) {
  const caps = actorCapabilities(session);
  const row = await ClientOneMember.findOne({
    _id: String(memberId),
    clientMasterId: access.clientMasterId,
  });
  if (!row) throw new AppError('User not found', 404, 'NOT_FOUND');
  assertActorMayWrite(caps, { target: row });
  if (row.status === 'inactive') {
    throw new AppError('Activate the user before rotating the PIN', 400, 'VALIDATION_ERROR');
  }
  const { pin, pinHash } = await mintUniqueMemberPin({
    excludeMemberId: row._id,
    excludeAccessId: access._id,
  });
  row.pinHash = pinHash;
  row.failedAttempts = 0;
  row.lockedUntil = null;
  row.updatedAt = new Date().toISOString();
  await row.save();
  return publicMemberDto(row, { includePin: true, pin });
}

export async function findActiveMemberByPinHash(pinHash, { accessId = '' } = {}) {
  if (!pinHash) return null;
  const filter = { pinHash, status: 'active' };
  if (trimStr(accessId)) {
    const access = await ClientOneAccess.findOne({ accessId: trimStr(accessId), isActive: true, revokedAt: null });
    if (!access) return null;
    filter.clientMasterId = access.clientMasterId;
  }
  return ClientOneMember.findOne(filter);
}

export async function changeMemberPin(member, { currentPin, newPin } = {}) {
  if (!member?._id) throw new AppError('PIN can only be changed from an active member session', 403, 'FORBIDDEN');
  const currentHash = hashClientOnePin(currentPin);
  if (!currentHash || member.pinHash !== currentHash) {
    throw new AppError('Current PIN is incorrect', 401, 'INVALID_PIN');
  }
  const pin = resolveClientOnePinInput(newPin);
  if (pin === normalizeClientOnePin(currentPin)) {
    throw new AppError('New PIN must be different from the current PIN', 400, 'VALIDATION_ERROR');
  }
  const pinHash = hashClientOnePin(pin);
  await assertPinHashAvailable(pinHash, { excludeMemberId: member._id });
  member.pinHash = pinHash;
  member.failedAttempts = 0;
  member.lockedUntil = null;
  member.updatedAt = new Date().toISOString();
  await member.save();
  return { memberId: String(member._id), pin };
}

/** Narrow camp filters for regional/area/territory members. */
export function applyMemberCampVisibility(filter, member) {
  if (!member) return filter;
  const tier = normalizeTier(member.level || member.designation);
  if (tier === 'zonal' || tier === 'ho') return filter;
  const next = { ...filter };
  if (tier === 'regional') {
    const regions = Array.isArray(member.regions) ? member.regions.filter(Boolean) : [];
    if (regions.length) next.state = { $in: regions };
  } else if (tier === 'area') {
    const locations = Array.isArray(member.locations) ? member.locations.filter(Boolean) : [];
    const regions = Array.isArray(member.regions) ? member.regions.filter(Boolean) : [];
    if (locations.length) next.city = { $in: locations };
    else if (regions.length) next.state = { $in: regions };
  } else if (tier === 'territory' || tier === 'location') {
    const locations = Array.isArray(member.locations) ? member.locations.filter(Boolean) : [];
    if (locations.length) next.city = { $in: locations };
  }
  return next;
}

export { assertPinHashAvailable, normalizeMobile, normalizeLabels, validateHierarchyPayload };

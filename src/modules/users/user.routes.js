import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { authenticate, requirePermission } from '../../middleware/auth.js';
import { asyncHandler, parsePagination, paginated, AppError } from '../../utils/helpers.js';
import { PERMISSIONS } from '../../config/constants.js';
import { User } from './user.model.js';
import { Role } from './role.model.js';
import { PERMISSION_CATALOG, MODULE_ACCESS_CATALOG, ALL_PERMISSION_KEYS, ACCESS_ACTIONS } from './permission.catalog.js';
import { writeAudit } from '../../utils/audit.js';
import { publicUser } from '../auth/auth.service.js';
import { sendExcel } from '../../utils/excelExport.js';

const router = Router();

function asRoleIdList(roleIds) {
  if (!Array.isArray(roleIds)) return [];
  return [...new Set(roleIds.map((id) => String(id?._id || id)).filter(Boolean))];
}

router.use(authenticate);

router.get(
  '/permissions',
  asyncHandler(async (_req, res) => {
    res.json({
      data: {
        modules: MODULE_ACCESS_CATALOG,
        actions: ACCESS_ACTIONS,
        catalog: PERMISSION_CATALOG,
        keys: ALL_PERMISSION_KEYS,
      },
    });
  })
);

router.get(
  '/roles/export',
  asyncHandler(async (_req, res) => {
    const roles = await Role.find({ isDeleted: false }).sort('name');
    sendExcel(
      res,
      'Roles_Master.xlsx',
      ['Role Name', 'Description', 'System', 'Permissions'],
      roles.map((r) => [
        r.name,
        r.description,
        r.isSystem ? 'Yes' : 'No',
        Array.isArray(r.permissions) ? r.permissions.join(', ') : '',
      ]),
      { sheetName: 'Roles' }
    );
  })
);

router.get(
  '/export',
  requirePermission(PERMISSIONS.USERS_WRITE, PERMISSIONS.USERS_READ, PERMISSIONS.ALL),
  asyncHandler(async (_req, res) => {
    const users = await User.find({ isDeleted: false })
      .populate('roleIds', 'name')
      .sort('fullName');
    sendExcel(
      res,
      'Users_Master.xlsx',
      ['Full Name', 'Email', 'Username', 'Phone', 'Active', 'Roles'],
      users.map((u) => [
        u.fullName,
        u.email,
        u.username,
        u.phone,
        u.isActive === false ? 'No' : 'Yes',
        (u.roleIds || []).map((r) => r.name || r).filter(Boolean).join(', '),
      ]),
      { sheetName: 'Users' }
    );
  })
);

router.get(
  '/roles',
  asyncHandler(async (_req, res) => {
    const roles = await Role.find({ isDeleted: false }).sort('name');
    res.json({ data: roles });
  })
);

router.get(
  '/roles/:id',
  asyncHandler(async (req, res) => {
    const role = await Role.findOne({ _id: req.params.id, isDeleted: false });
    if (!role) throw new AppError('Role not found', 404);
    res.json({ data: role });
  })
);

router.post(
  '/roles',
  requirePermission(PERMISSIONS.USERS_WRITE),
  asyncHandler(async (req, res) => {
    const name = String(req.body.name || '').trim();
    if (!name) throw new AppError('Role name is required', 400, 'VALIDATION_ERROR');
    const existing = await Role.findOne({ name, isDeleted: false });
    if (existing) throw new AppError('Role name already exists', 409, 'DUPLICATE');

    let permissions = Array.isArray(req.body.permissions) ? req.body.permissions.map(String) : [];
    permissions = permissions.filter((p) => ALL_PERMISSION_KEYS.includes(p) || p === PERMISSIONS.ALL);
    if (permissions.includes(PERMISSIONS.ALL)) permissions = [PERMISSIONS.ALL];

    const role = await Role.create({
      name,
      description: String(req.body.description || '').trim(),
      permissions,
      isSystem: false,
    });

    await writeAudit({
      actorId: req.user._id,
      actorEmail: req.user.email,
      action: 'ROLE.CREATE',
      entityType: 'Role',
      entityId: role._id,
      after: { name: role.name, permissions: role.permissions },
      requestId: req.requestId,
    });

    res.status(201).json({ data: role });
  })
);

router.patch(
  '/roles/:id',
  requirePermission(PERMISSIONS.USERS_WRITE),
  asyncHandler(async (req, res) => {
    const role = await Role.findOne({ _id: req.params.id, isDeleted: false });
    if (!role) throw new AppError('Role not found', 404);

    const before = { name: role.name, description: role.description, permissions: role.permissions };

    if (req.body.name !== undefined) {
      const name = String(req.body.name).trim();
      if (!name) throw new AppError('Role name is required', 400, 'VALIDATION_ERROR');
      if (role.name === 'Admin' && name !== 'Admin') {
        throw new AppError('Cannot rename the Admin role', 400, 'LOCKED');
      }
      role.name = name;
    }
    if (req.body.description !== undefined) {
      role.description = String(req.body.description || '').trim();
    }
    if (req.body.permissions !== undefined) {
      let permissions = Array.isArray(req.body.permissions)
        ? req.body.permissions.map(String)
        : [];
      permissions = permissions.filter((p) => ALL_PERMISSION_KEYS.includes(p) || p === PERMISSIONS.ALL);
      if (role.name === 'Admin') {
        permissions = [PERMISSIONS.ALL];
      } else if (permissions.includes(PERMISSIONS.ALL)) {
        permissions = [PERMISSIONS.ALL];
      }
      role.permissions = permissions;
    }

    await role.save();

    await writeAudit({
      actorId: req.user._id,
      actorEmail: req.user.email,
      action: 'ROLE.UPDATE',
      entityType: 'Role',
      entityId: role._id,
      before,
      after: { name: role.name, description: role.description, permissions: role.permissions },
      requestId: req.requestId,
    });

    res.json({ data: role });
  })
);

router.delete(
  '/roles/:id',
  requirePermission(PERMISSIONS.USERS_WRITE),
  asyncHandler(async (req, res) => {
    const role = await Role.findOne({ _id: req.params.id, isDeleted: false });
    if (!role) throw new AppError('Role not found', 404);
    if (role.isSystem || role.name === 'Admin') {
      throw new AppError('System roles cannot be deleted', 400, 'LOCKED');
    }
    role.isDeleted = true;
    await role.save();
    await writeAudit({
      actorId: req.user._id,
      actorEmail: req.user.email,
      action: 'ROLE.DELETE',
      entityType: 'Role',
      entityId: role._id,
      requestId: req.requestId,
    });
    res.json({ data: { ok: true } });
  })
);

router.get(
  '/',
  requirePermission(PERMISSIONS.USERS_WRITE, PERMISSIONS.USERS_READ, PERMISSIONS.ALL),
  asyncHandler(async (req, res) => {
    const { page, limit, skip, sort } = parsePagination(req.query);
    const filter = { isDeleted: false };
    if (req.query.q) {
      filter.$or = [
        { email: new RegExp(req.query.q, 'i') },
        { fullName: new RegExp(req.query.q, 'i') },
        { username: new RegExp(req.query.q, 'i') },
      ];
    }
    const [rows, total] = await Promise.all([
      User.find(filter).populate('roleIds').sort(sort).skip(skip).limit(limit),
      User.countDocuments(filter),
    ]);
    res.json(paginated(rows.map(publicUser), total, page, limit));
  })
);

router.post(
  '/',
  requirePermission(PERMISSIONS.USERS_WRITE),
  asyncHandler(async (req, res) => {
    const { email, username, fullName, password, phone, roleIds } = req.body;
    if (!email || !username || !fullName || !password || !roleIds?.length) {
      throw new AppError('Missing required fields', 400, 'VALIDATION_ERROR');
    }
    if (password.length < 12) throw new AppError('Password must be at least 12 characters', 400, 'VALIDATION_ERROR');
    const passwordHash = await bcrypt.hash(password, 12);
    const user = await User.create({
      email: email.toLowerCase().trim(),
      username: username.trim(),
      fullName,
      phone,
      roleIds: asRoleIdList(roleIds),
      passwordHash,
      passwordChangedAt: new Date().toISOString(),
    });
    await user.populate('roleIds');
    await writeAudit({
      actorId: req.user._id,
      actorEmail: req.user.email,
      action: 'USER.CREATE',
      entityType: 'User',
      entityId: user._id,
      after: publicUser(user),
      requestId: req.requestId,
    });
    res.status(201).json({ data: publicUser(user) });
  })
);

router.patch(
  '/:id',
  requirePermission(PERMISSIONS.USERS_WRITE),
  asyncHandler(async (req, res) => {
    const user = await User.findOne({ _id: req.params.id, isDeleted: false });
    if (!user) throw new AppError('User not found', 404);

    // Snapshot before mutating, and always keep roleIds as string ids in the DB
    // (populate() would otherwise persist nested role docs and break later loads).
    const beforeDoc = await User.findOne({ _id: user._id, isDeleted: false });
    await beforeDoc.populate('roleIds');
    const before = publicUser(beforeDoc);

    // Normalize any previously populated / nested role ids back to strings
    user.roleIds = asRoleIdList(user.roleIds);

    if (req.body.fullName !== undefined) user.fullName = req.body.fullName;
    if (req.body.phone !== undefined) user.phone = req.body.phone;
    if (req.body.isActive !== undefined) {
      if (String(req.user._id) === String(user._id) && req.body.isActive === false) {
        throw new AppError('You cannot deactivate your own account', 400, 'LOCKED');
      }
      user.isActive = req.body.isActive;
    }
    if (req.body.roleIds !== undefined) {
      const nextIds = asRoleIdList(req.body.roleIds);
      if (!nextIds.length) throw new AppError('Select at least one role', 400, 'VALIDATION_ERROR');
      const roleRows = await Role.find({ isDeleted: false });
      const valid = new Set(roleRows.map((r) => String(r._id)));
      if (nextIds.some((id) => !valid.has(id))) {
        throw new AppError('One or more roles are invalid', 400, 'VALIDATION_ERROR');
      }
      user.roleIds = nextIds;
    }
    if (req.body.password) {
      if (String(req.body.password).length < 12) {
        throw new AppError('Password must be at least 12 characters', 400, 'VALIDATION_ERROR');
      }
      user.passwordHash = await bcrypt.hash(String(req.body.password), 12);
      user.passwordChangedAt = new Date().toISOString();
      user.tokenVersion = (user.tokenVersion || 0) + 1;
    }
    await user.save();
    await user.populate('roleIds');
    await writeAudit({
      actorId: req.user._id,
      actorEmail: req.user.email,
      action: 'USER.UPDATE',
      entityType: 'User',
      entityId: user._id,
      before,
      after: publicUser(user),
      requestId: req.requestId,
    });
    res.json({ data: publicUser(user) });
  })
);

router.delete(
  '/:id',
  requirePermission(PERMISSIONS.USERS_WRITE),
  asyncHandler(async (req, res) => {
    const user = await User.findOne({ _id: req.params.id, isDeleted: false });
    if (!user) throw new AppError('User not found', 404);
    if (String(req.user._id) === String(user._id)) {
      throw new AppError('You cannot delete your own account', 400, 'LOCKED');
    }
    user.isDeleted = true;
    user.isActive = false;
    user.tokenVersion = (user.tokenVersion || 0) + 1;
    await user.save();
    await writeAudit({
      actorId: req.user._id,
      actorEmail: req.user.email,
      action: 'USER.DELETE',
      entityType: 'User',
      entityId: user._id,
      requestId: req.requestId,
    });
    res.json({ data: { ok: true } });
  })
);

export default router;

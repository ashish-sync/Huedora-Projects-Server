import { Router } from 'express';
import { authenticate, requirePermission, requireAdmin } from '../../middleware/auth.js';
import { asyncHandler, parsePagination, paginated, AppError } from '../../utils/helpers.js';
import { PERMISSIONS } from '../../config/constants.js';
import { writeAudit } from '../../utils/audit.js';
import { escapeRegex } from '../../utils/escapeRegex.js';
import { assignPreservingExisting } from '../../store/dataIntegrity.js';
import { FormMaster, normalizeFormPayload } from './form.model.js';
import {
  FORM_CATEGORIES,
  FORM_FIELD_FORMATS,
  FORM_FIELD_TYPES,
  FORM_FIELD_WIDTHS,
  FORM_SHOW_OPERATORS,
  HCW_ACTIVITY_TEMPLATE,
  PUBLIC_CAMP_REQUEST_TEMPLATE,
} from './form.constants.js';

const router = Router();
router.use(authenticate);

const canReadForms = requirePermission(
  PERMISSIONS.AGREEMENTS_READ,
  PERMISSIONS.AGREEMENTS_WRITE,
  PERMISSIONS.MASTERS_READ,
  PERMISSIONS.CAMPS_READ,
  PERMISSIONS.CAMPS_REQUEST,
);
router.use((req, res, next) => {
  if (req.method !== 'GET') return next();
  return canReadForms(req, res, next);
});

router.get(
  '/meta',
  asyncHandler(async (_req, res) => {
    res.json({
      data: {
        categories: FORM_CATEGORIES,
        fieldTypes: FORM_FIELD_TYPES,
        fieldWidths: FORM_FIELD_WIDTHS,
        fieldFormats: FORM_FIELD_FORMATS,
        showOperators: FORM_SHOW_OPERATORS,
        templates: [PUBLIC_CAMP_REQUEST_TEMPLATE, HCW_ACTIVITY_TEMPLATE],
      },
    });
  }),
);

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const { page, limit, skip, sort } = parsePagination(req.query);
    const filter = { isDeleted: false };
    if (req.query.active !== 'false') filter.isActive = true;
    if (req.query.all === 'true') delete filter.isActive;
    if (req.query.category) filter.category = String(req.query.category).trim().toUpperCase();
    if (req.query.q) {
      const q = escapeRegex(String(req.query.q));
      filter.$or = [
        { name: new RegExp(q, 'i') },
        { code: new RegExp(q, 'i') },
        { description: new RegExp(q, 'i') },
        { category: new RegExp(q, 'i') },
      ];
    }

    const [data, total] = await Promise.all([
      FormMaster.find(filter).sort(sort || 'category name').skip(skip).limit(limit),
      FormMaster.countDocuments(filter),
    ]);
    res.json(paginated(data, total, page, limit));
  }),
);

router.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const row = await FormMaster.findOne({ _id: req.params.id, isDeleted: false });
    if (!row) throw new AppError('Form format not found', 404);
    res.json({ data: row });
  }),
);

router.post(
  '/',
  requirePermission(PERMISSIONS.AGREEMENTS_WRITE),
  asyncHandler(async (req, res) => {
    const payload = normalizeFormPayload(req.body);
    if (!payload.name) throw new AppError('Form name is required', 400, 'VALIDATION_ERROR');
    if (!payload.code) throw new AppError('Form code is required', 400, 'VALIDATION_ERROR');
    if (!payload.fields.length) {
      throw new AppError('Add at least one field to the form format', 400, 'VALIDATION_ERROR');
    }

    const duplicate = await FormMaster.findOne({
      code: payload.code,
      isDeleted: false,
    });
    if (duplicate) {
      throw new AppError(`Form code ${payload.code} already exists`, 400, 'DUPLICATE');
    }

    const row = await FormMaster.create({
      ...payload,
      createdBy: req.user._id,
      updatedBy: req.user._id,
    });

    await writeAudit({
      actorId: req.user._id,
      actorEmail: req.user.email,
      action: 'FORM_MASTER.CREATE',
      entityType: 'FormMaster',
      entityId: row._id,
      after: { name: row.name, code: row.code, category: row.category, fieldCount: row.fields?.length || 0 },
      requestId: req.requestId,
    });

    res.status(201).json({ data: row });
  }),
);

router.patch(
  '/:id',
  requirePermission(PERMISSIONS.AGREEMENTS_WRITE),
  asyncHandler(async (req, res) => {
    const row = await FormMaster.findOne({ _id: req.params.id, isDeleted: false });
    if (!row) throw new AppError('Form format not found', 404);

    const payload = normalizeFormPayload({ ...row, ...req.body });
    if (!payload.name) throw new AppError('Form name is required', 400, 'VALIDATION_ERROR');
    if (!payload.code) throw new AppError('Form code is required', 400, 'VALIDATION_ERROR');
    if (!payload.fields.length) {
      throw new AppError('Add at least one field to the form format', 400, 'VALIDATION_ERROR');
    }

    if (payload.code !== row.code) {
      const duplicate = await FormMaster.findOne({
        code: payload.code,
        isDeleted: false,
        _id: { $ne: row._id },
      });
      if (duplicate) {
        throw new AppError(`Form code ${payload.code} already exists`, 400, 'DUPLICATE');
      }
    }

    assignPreservingExisting(row, payload);
    row.updatedBy = req.user._id;
    await row.save();

    await writeAudit({
      actorId: req.user._id,
      actorEmail: req.user.email,
      action: 'FORM_MASTER.UPDATE',
      entityType: 'FormMaster',
      entityId: row._id,
      after: {
        name: row.name,
        code: row.code,
        category: row.category,
        isActive: row.isActive,
        fieldCount: row.fields?.length || 0,
      },
      requestId: req.requestId,
    });

    res.json({ data: row });
  }),
);

router.delete(
  '/:id',
  requireAdmin,
  asyncHandler(async (req, res) => {
    const row = await FormMaster.findOne({ _id: req.params.id, isDeleted: false });
    if (!row) throw new AppError('Form format not found', 404);
    row.isDeleted = true;
    row.isActive = false;
    row.updatedBy = req.user._id;
    await row.save();

    await writeAudit({
      actorId: req.user._id,
      actorEmail: req.user.email,
      action: 'FORM_MASTER.DELETE',
      entityType: 'FormMaster',
      entityId: row._id,
      requestId: req.requestId,
    });

    res.json({ data: { ok: true } });
  }),
);

export default router;

import { Router } from 'express';
import { authenticate, requirePermission } from '../../middleware/auth.js';
import { asyncHandler, parsePagination, paginated, AppError } from '../../utils/helpers.js';
import { PERMISSIONS } from '../../config/constants.js';
import { Hcw } from './hcw.model.js';
import { Asset } from '../assets/asset.model.js';
import { writeAudit } from '../../utils/audit.js';
import { throwIfIdentityClash } from '../../utils/identityNormalize.js';

const router = Router();
router.use(authenticate);

async function assertHcwIdentityAvailable({ hcwId, contact, excludeId } = {}) {
  const rows = await Hcw.find({ isDeleted: false }).limit(20000);
  if (hcwId) {
    const idKey = String(hcwId).trim().toLowerCase();
    const clash = rows.find(
      (r) =>
        (!excludeId || String(r._id) !== String(excludeId)) &&
        String(r.hcwId || '')
          .trim()
          .toLowerCase() === idKey
    );
    if (clash) throw new AppError('A custodian with this HCW ID already exists', 409, 'DUPLICATE_HCW_ID');
  }
  if (contact) {
    throwIfIdentityClash(rows, {
      phone: contact,
      excludeId,
      phoneFields: ['contact'],
      label: 'Custodian',
    });
  }
}

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const { page, limit, skip, sort } = parsePagination(req.query);
    const filter = { isDeleted: false };
    if (req.query.status) filter.status = req.query.status;
    if (req.query.city) filter.city = req.query.city;
    if (req.query.q) {
      filter.$or = [
        { name: new RegExp(req.query.q, 'i') },
        { hcwId: new RegExp(req.query.q, 'i') },
        { contact: new RegExp(req.query.q, 'i') },
      ];
    }
    const [data, total] = await Promise.all([
      Hcw.find(filter).sort(sort).skip(skip).limit(limit),
      Hcw.countDocuments(filter),
    ]);
    res.json(paginated(data, total, page, limit));
  })
);

router.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const hcw = await Hcw.findOne({ _id: req.params.id, isDeleted: false });
    if (!hcw) throw new AppError('Custodian not found', 404);
    res.json({ data: hcw });
  })
);

router.post(
  '/',
  requirePermission(PERMISSIONS.HCWS_WRITE),
  asyncHandler(async (req, res) => {
    const { hcwId, name } = req.body;
    if (!hcwId || !name) throw new AppError('hcwId and name required', 400, 'VALIDATION_ERROR');
    await assertHcwIdentityAvailable({ hcwId, contact: req.body.contact });
    const hcw = await Hcw.create({ ...req.body, createdBy: req.user._id, updatedBy: req.user._id });
    await writeAudit({
      actorId: req.user._id,
      actorEmail: req.user.email,
      action: 'HCW.CREATE',
      entityType: 'Hcw',
      entityId: hcw._id,
      after: hcw.toObject(),
      requestId: req.requestId,
    });
    res.status(201).json({ data: hcw });
  })
);

router.patch(
  '/:id',
  requirePermission(PERMISSIONS.HCWS_WRITE),
  asyncHandler(async (req, res) => {
    const hcw = await Hcw.findOne({ _id: req.params.id, isDeleted: false });
    if (!hcw) throw new AppError('Custodian not found', 404);

    if (req.body.status === 'INACTIVE' || req.body.isDeleted === true) {
      const held = await Asset.countDocuments({
        hcwId: hcw._id,
        isDeleted: false,
        status: { $in: ['Assigned', 'Verified'] },
      });
      if (held > 0) {
        throw new AppError('Transfer active custody assets before inactivating HCW', 400, 'HCW_HAS_ASSETS');
      }
    }

    await assertHcwIdentityAvailable({
      hcwId: req.body.hcwId !== undefined ? req.body.hcwId : hcw.hcwId,
      contact: req.body.contact !== undefined ? req.body.contact : hcw.contact,
      excludeId: hcw._id,
    });

    const before = hcw.toObject();
    Object.assign(hcw, req.body, { updatedBy: req.user._id });
    await hcw.save();
    await writeAudit({
      actorId: req.user._id,
      actorEmail: req.user.email,
      action: 'HCW.UPDATE',
      entityType: 'Hcw',
      entityId: hcw._id,
      before,
      after: hcw.toObject(),
      requestId: req.requestId,
    });
    res.json({ data: hcw });
  })
);

export default router;

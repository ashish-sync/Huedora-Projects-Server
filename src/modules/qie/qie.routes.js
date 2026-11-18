import { Router } from 'express';
import { authenticate, requirePermission } from '../../middleware/auth.js';
import { PERMISSIONS } from '../../config/constants.js';
import { asyncHandler, AppError } from '../../utils/helpers.js';
import {
  applyQieHrDecision,
  getQieVerification,
  listQieForContact,
  reanalyzeQieVerification,
} from './qie.service.js';
import { deriveQieIndicator } from './qieStatus.js';

const router = Router();
router.use(authenticate);

function serialize(record) {
  const obj = record?.toObject ? record.toObject() : { ...record };
  obj.indicator = deriveQieIndicator(obj);
  return obj;
}

router.get(
  '/verifications',
  requirePermission(PERMISSIONS.AGREEMENTS_READ),
  asyncHandler(async (req, res) => {
    const contactId = String(req.query.contactId || '').trim();
    if (!contactId) throw new AppError('contactId is required', 400, 'VALIDATION_ERROR');
    const data = await listQieForContact(contactId);
    res.json({ data: data.map(serialize) });
  }),
);

router.get(
  '/verifications/:id',
  requirePermission(PERMISSIONS.AGREEMENTS_READ),
  asyncHandler(async (req, res) => {
    const record = await getQieVerification(req.params.id);
    res.json({ data: serialize(record) });
  }),
);

router.post(
  '/verifications/:id/reanalyze',
  requirePermission(PERMISSIONS.AGREEMENTS_WRITE),
  asyncHandler(async (req, res) => {
    const record = await reanalyzeQieVerification(req.params.id, {
      actorId: req.user._id,
      actorEmail: req.user.email,
    });
    res.json({ data: serialize(record) });
  }),
);

router.post(
  '/verifications/:id/hr-decision',
  requirePermission(PERMISSIONS.AGREEMENTS_WRITE),
  asyncHandler(async (req, res) => {
    const record = await applyQieHrDecision(
      req.params.id,
      {
        action: req.body?.action,
        notes: req.body?.notes,
      },
      {
        actorId: req.user._id,
        actorEmail: req.user.email,
      },
    );
    res.json({ data: serialize(record) });
  }),
);

export default router;

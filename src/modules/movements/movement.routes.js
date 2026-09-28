import { Router } from 'express';
import { authenticate, requirePermission } from '../../middleware/auth.js';
import { asyncHandler, parsePagination, paginated, AppError } from '../../utils/helpers.js';
import { PERMISSIONS } from '../../config/constants.js';
import { Movement } from './movement.model.js';
import { sendExcel } from '../../utils/excelExport.js';
import { clearStaleLegacyMovementLocks } from './retireLegacyMovements.js';

/**
 * Legacy ALMS asset-transfer API — read-only after Movement One redesign (1A+2A).
 * New custody / goods issuance flows use Request One + Movement One Goods Issue.
 */
const router = Router();
router.use(authenticate);

const RETIRED_MESSAGE =
  'Legacy asset Movement API is retired. Use Request One → Goods Issuance, then Movement One → Goods Issue.';

function retiredWrite(_req, _res, next) {
  next(new AppError(RETIRED_MESSAGE, 410, 'MOVEMENT_API_RETIRED'));
}

const canReadMovements = requirePermission(
  PERMISSIONS.MOVEMENTS_READ,
  PERMISSIONS.MOVEMENTS_REQUEST,
  PERMISSIONS.MOVEMENTS_APPROVE,
  PERMISSIONS.ASSET_REQUESTS_READ,
  PERMISSIONS.ASSET_REQUESTS_REQUEST,
  PERMISSIONS.ASSET_REQUESTS_APPROVE
);
router.use((req, res, next) => {
  if (req.method !== 'GET') return next();
  return canReadMovements(req, res, next);
});

/** One-shot cleanup of openMovementId values that pointed at legacy Movement docs */
let legacyLockCleanupPromise = null;
function ensureLegacyLockCleanup() {
  if (!legacyLockCleanupPromise) {
    legacyLockCleanupPromise = clearStaleLegacyMovementLocks().catch((err) => {
      console.error('[movements] legacy lock cleanup failed', err?.message || err);
      legacyLockCleanupPromise = null;
    });
  }
  return legacyLockCleanupPromise;
}

router.get(
  '/',
  asyncHandler(async (req, res) => {
    ensureLegacyLockCleanup();
    const { page, limit, skip, sort } = parsePagination(req.query);
    const filter = { isDeleted: false };
    if (req.query.status) filter.status = req.query.status;
    const [data, total] = await Promise.all([
      Movement.find(filter)
        .populate('requestorId', 'fullName email')
        .populate('approverId', 'fullName email')
        .populate('to.contactId', 'name email contact city')
        .populate('to.hcwId', 'hcwId name')
        .sort(sort)
        .skip(skip)
        .limit(limit),
      Movement.countDocuments(filter),
    ]);
    res.set('Deprecation', 'true');
    res.set('Sunset', 'Movement One redesign');
    res.json({
      ...paginated(data, total, page, limit),
      meta: {
        ...(paginated(data, total, page, limit).meta || {}),
        deprecated: true,
        message: RETIRED_MESSAGE,
      },
    });
  })
);

router.get(
  '/export',
  asyncHandler(async (_req, res) => {
    const rows = await Movement.find({ isDeleted: false })
      .populate('requestorId', 'fullName email')
      .populate('approverId', 'fullName email')
      .populate('to.contactId', 'name email contact city')
      .sort('-createdAt');
    sendExcel(
      res,
      'Movements_Legacy.xlsx',
      [
        'Movement Number',
        'Status',
        'Reason',
        'Requestor',
        'Approver',
        'To Custodian',
        'City',
        'Created At',
      ],
      rows.map((m) => [
        m.movementNumber || m._id,
        m.status,
        m.reason,
        m.requestorId?.fullName || m.requestorId?.email || '',
        m.approverId?.fullName || m.approverId?.email || '',
        m.to?.contactId?.name || m.to?.hcwId?.name || '',
        m.to?.contactId?.city || m.to?.location?.city || '',
        m.createdAt,
      ]),
      { sheetName: 'Legacy Movements' }
    );
  })
);

router.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const movement = await Movement.findOne({ _id: req.params.id, isDeleted: false })
      .populate('requestorId', 'fullName email')
      .populate('approverId', 'fullName email')
      .populate('assets.assetId');
    if (!movement) throw new AppError('Movement not found', 404);
    res.set('Deprecation', 'true');
    res.json({ data: movement, meta: { deprecated: true, message: RETIRED_MESSAGE } });
  })
);

router.post('/', retiredWrite);
router.post('/:id/approve', retiredWrite);
router.post('/:id/reject', retiredWrite);
router.post('/:id/ship', retiredWrite);
router.post('/:id/receive', retiredWrite);
router.post('/:id/cancel', retiredWrite);

export { RETIRED_MESSAGE };
export default router;

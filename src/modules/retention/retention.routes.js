import { Router } from 'express';
import { authenticate, requirePermission, requireAdmin } from '../../middleware/auth.js';
import { asyncHandler, AppError } from '../../utils/helpers.js';
import { PERMISSIONS } from '../../config/constants.js';
import { writeAudit } from '../../utils/audit.js';
import { CampOpsCamp } from '../campOps/campOps.model.js';
import { AssetRequest } from '../assetRequests/assetRequest.model.js';
import { Asset } from '../assets/asset.model.js';
import { Movement } from '../movements/movement.model.js';
import { FinanceCommercialDocument, FinanceInvoice } from '../finance/finance.model.js';
import { Agreement } from '../agreements/agreement.model.js';
import { runNinetyDayArchive, restoreArchivedRecord } from './ninetyDayArchive.js';

const router = Router();
router.use(authenticate);

const LOADERS = {
  camp: (id) => CampOpsCamp.findOne({ _id: id, isDeleted: false }),
  asset_request: (id) => AssetRequest.findOne({ _id: id, isDeleted: false }),
  asset: (id) => Asset.findOne({ _id: id, isDeleted: false }),
  movement: (id) => Movement.findOne({ _id: id, isDeleted: false }),
  finance_commercial: (id) => FinanceCommercialDocument.findOne({ _id: id, isDeleted: false }),
  vendor_bill: (id) => FinanceInvoice.findOne({ _id: id, isDeleted: false }),
  agreement: (id) => Agreement.findOne({ _id: id, isDeleted: false }),
};

router.post(
  '/run',
  requireAdmin,
  asyncHandler(async (req, res) => {
    const dryRun = req.body?.dryRun === true || req.query.dryRun === '1';
    const result = await runNinetyDayArchive({ dryRun });
    res.json({ data: result, dryRun });
  })
);

router.post(
  '/:entityType/:id/restore',
  requirePermission(
    PERMISSIONS.FINANCE_WRITE,
    PERMISSIONS.CAMPS_APPROVE,
    PERMISSIONS.ASSETS_WRITE,
    PERMISSIONS.AGREEMENTS_WRITE,
    PERMISSIONS.ASSET_REQUESTS_APPROVE,
  ),
  asyncHandler(async (req, res) => {
    const entityType = String(req.params.entityType || '');
    const loader = LOADERS[entityType];
    if (!loader) throw new AppError('Unsupported entity type for restore', 400);
    const row = await loader(req.params.id);
    if (!row) throw new AppError('Record not found', 404);
    const result = await restoreArchivedRecord(row, { entityType, restoreFiles: true });
    if (!result.ok) throw new AppError(result.reason || 'Restore failed', 400);
    await writeAudit({
      actorId: req.user._id,
      actorEmail: req.user.email,
      action: 'RETENTION.RESTORE',
      entityType,
      entityId: row._id,
      requestId: req.requestId,
      message: 'Restored from 90-day archive',
    });
    res.json({ data: row });
  })
);

export default router;

import { Router } from 'express';
import { authenticate, requirePermission, hasPermission } from '../../middleware/auth.js';
import { asyncHandler } from '../../utils/helpers.js';
import { PERMISSIONS } from '../../config/constants.js';
import { Asset } from '../assets/asset.model.js';
import { Agreement } from '../agreements/agreement.model.js';
import { RepairTicket } from '../repairs/repair.model.js';
import { Movement } from '../movements/movement.model.js';
import { Contact } from '../contacts/contact.model.js';
import { DocumentTemplate } from '../templates/template.model.js';
import { SignatureMaster } from '../signatures/signature.model.js';
import { Role } from '../users/role.model.js';
import { User } from '../users/user.model.js';
import { sendMultiSheetExcel } from '../../utils/excelExport.js';
import {
  ASSET_STATUS_OPTIONS,
  AGREEMENT_SIGNED_EQUIVALENTS,
} from '../devices/device.constants.js';
import {
  computeDeviceCondition,
  periodKeyFromDate,
} from '../verifications/verification.condition.js';
import { VerificationCampaign, VerificationRecord } from '../verifications/verification.model.js';

const router = Router();
router.use(authenticate);
router.use(requirePermission(PERMISSIONS.DASHBOARDS_READ));

async function ensureCampaign(periodKey, userId) {
  let campaign = await VerificationCampaign.findOne({ periodKey, isDeleted: false });
  if (!campaign) {
    campaign = await VerificationCampaign.create({
      periodKey,
      label: periodKey,
      status: 'OPEN',
      requireRound2: true,
      createdBy: userId,
    });
  }
  return campaign;
}

async function ensureRecord(campaign, asset, userId) {
  let record = await VerificationRecord.findOne({
    campaignId: campaign._id,
    assetId: asset._id,
    isDeleted: false,
  });
  if (!record) {
    record = await VerificationRecord.create({
      campaignId: campaign._id,
      periodKey: campaign.periodKey,
      assetId: asset._id,
      serialNumber: asset.serialNumber || null,
      brandModelTest: asset.deviceNameSnapshot || null,
      custodianName: null,
      status: 'IN_PROGRESS',
      round1: {},
      round2: {},
      createdBy: userId,
      updatedBy: userId,
    });
  }
  return record;
}

router.get(
  '/summary',
  asyncHandler(async (_req, res) => {
    const [
      assetsByStatus,
      agreementByStatus,
      openRepairs,
      pendingMovements,
      contactCount,
      assetCount,
      verificationExceptions,
    ] = await Promise.all([
      Asset.aggregate([
        { $match: { isDeleted: false } },
        { $group: { _id: '$status', count: { $sum: 1 } } },
      ]),
      Agreement.aggregate([
        { $match: { isDeleted: false } },
        { $group: { _id: '$status', count: { $sum: 1 } } },
      ]),
      RepairTicket.countDocuments({
        isDeleted: false,
        status: { $nin: ['CLOSED'] },
      }),
      Movement.countDocuments({ isDeleted: false, status: 'REQUESTED' }),
      Contact.countDocuments({ isDeleted: false }),
      Asset.countDocuments({ isDeleted: false }),
      VerificationRecord.countDocuments({ isDeleted: false, status: 'EXCEPTION' }),
    ]);

    res.json({
      data: {
        assetCount,
        contactCount,
        hcwCount: contactCount,
        openRepairs,
        pendingMovements,
        verificationExceptions,
        assetsByStatus: Object.fromEntries(assetsByStatus.map((x) => [x._id, x.count])),
        agreementsByStatus: Object.fromEntries(agreementByStatus.map((x) => [x._id, x.count])),
      },
    });
  })
);

/** Tracking board: Asset Inventory status (Qty + Value) + Asset Verification (Qty + Value) */
router.get(
  '/tracking',
  asyncHandler(async (req, res) => {
    const fromRaw = req.query.from ? String(req.query.from).trim() : '';
    const toRaw = req.query.to ? String(req.query.to).trim() : '';

    const parseDay = (raw, endOfDay = false) => {
      if (!raw || !/^\d{4}-\d{2}-\d{2}$/.test(raw)) return null;
      const [y, m, d] = raw.split('-').map(Number);
      if (endOfDay) return new Date(y, m - 1, d, 23, 59, 59, 999);
      return new Date(y, m - 1, d, 0, 0, 0, 0);
    };

    const fromDate = parseDay(fromRaw, false);
    const toDate = parseDay(toRaw, true);

    if ((fromRaw && !fromDate) || (toRaw && !toDate)) {
      return res.status(400).json({
        error: { message: 'from and to must be YYYY-MM-DD', code: 'VALIDATION_ERROR' },
      });
    }
    if (fromDate && toDate && fromDate.getTime() > toDate.getTime()) {
      return res.status(400).json({
        error: { message: 'from must be on or before to', code: 'VALIDATION_ERROR' },
      });
    }

    // Verification period = month of `to` (or explicit periodKey / today)
    const periodKey = String(
      req.query.periodKey ||
        (toDate
          ? `${toDate.getFullYear()}-${String(toDate.getMonth() + 1).padStart(2, '0')}`
          : periodKeyFromDate())
    ).trim();
    const [py, pm] = periodKey.split('-').map(Number);
    const periodAnchor = toDate || new Date(py, (pm || 1) - 1, Math.min(new Date().getDate(), 28));

    const assetOnboardDate = (a) => {
      if (a.purchaseDate) {
        const d = new Date(a.purchaseDate);
        if (!Number.isNaN(d.getTime())) return d;
      }
      const added = String(a.addedMonth || '');
      if (/^(0[1-9]|1[0-2])\/\d{4}$/.test(added)) {
        const [mm, yyyy] = added.split('/');
        return new Date(Number(yyyy), Number(mm) - 1, 1);
      }
      if (a.createdAt) {
        const d = new Date(a.createdAt);
        if (!Number.isNaN(d.getTime())) return d;
      }
      return null;
    };

    const inRange = (a) => {
      if (!fromDate && !toDate) return true;
      const onboard = assetOnboardDate(a);
      if (!onboard) return false;
      if (fromDate && onboard.getTime() < fromDate.getTime()) return false;
      if (toDate && onboard.getTime() > toDate.getTime()) return false;
      return true;
    };

    const assets = (await Asset.find({ isDeleted: false }).sort('-updatedAt')).filter(inRange);

    const assetValue = (a) => {
      const n = Number(a.deviceValue);
      return Number.isFinite(n) && n >= 0 ? n : 0;
    };

    const statusBuckets = Object.fromEntries(
      ASSET_STATUS_OPTIONS.map((status) => [status, { status, qty: 0, value: 0 }])
    );
    let inventoryQty = 0;
    let inventoryValue = 0;

    for (const asset of assets) {
      const raw = String(asset.agreementStatus || 'Not Initiated').trim();
      const status =
        raw.toLowerCase() === 'active'
          ? 'Agreement Signed'
          : ASSET_STATUS_OPTIONS.includes(raw)
            ? raw
            : raw || 'Not Initiated';
      const qty = 1;
      const value = assetValue(asset);
      inventoryQty += qty;
      inventoryValue += value;
      if (!statusBuckets[status]) {
        statusBuckets[status] = { status, qty: 0, value: 0 };
      }
      statusBuckets[status].qty += qty;
      statusBuckets[status].value += value;
    }

    // Canonical 8 statuses first, then any legacy extras
    const assetStatus = [
      ...ASSET_STATUS_OPTIONS.map((status) => statusBuckets[status]),
      ...Object.values(statusBuckets).filter((b) => !ASSET_STATUS_OPTIONS.includes(b.status)),
    ];

    const signed = assets.filter(
      (a) =>
        AGREEMENT_SIGNED_EQUIVALENTS.includes(a.agreementStatus) ||
        String(a.agreementStatus || '').trim().toLowerCase() === 'active'
    );

    const campaign = await ensureCampaign(periodKey, req.user._id);
    const verificationMap = {
      SAFE: { key: 'SAFE', label: 'Safe', qty: 0, value: 0 },
      CAUTION: { key: 'CAUTION', label: 'Caution', qty: 0, value: 0 },
      DANGER: { key: 'DANGER', label: 'Danger', qty: 0, value: 0 },
    };

    for (const asset of signed) {
      const record = await ensureRecord(campaign, asset, req.user._id);
      const condition = computeDeviceCondition(asset, record, periodAnchor);
      const bucket = verificationMap[condition.condition] || verificationMap.DANGER;
      bucket.qty += 1;
      bucket.value += assetValue(asset);
    }

    const verification = ['SAFE', 'CAUTION', 'DANGER'].map((k) => verificationMap[k]);
    const verificationTotals = {
      qty: verification.reduce((s, r) => s + r.qty, 0),
      value: verification.reduce((s, r) => s + r.value, 0),
    };

    const showValue = hasPermission(req, PERMISSIONS.ASSETS_VIEW_VALUE);
    const mapStatus = (row) =>
      showValue ? row : { status: row.status, qty: row.qty };
    const mapCondition = (row) =>
      showValue
        ? row
        : { key: row.key, label: row.label, qty: row.qty };

    res.json({
      data: {
        periodKey,
        from: fromRaw || null,
        to: toRaw || null,
        inventory: {
          qty: inventoryQty,
          value: showValue ? inventoryValue : undefined,
          statuses: assetStatus.map(mapStatus),
        },
        verification: {
          qty: verificationTotals.qty,
          value: showValue ? verificationTotals.value : undefined,
          conditions: verification.map(mapCondition),
        },
      },
    });
  })
);

router.get(
  '/export',
  asyncHandler(async (_req, res) => {
    const [
      assetCount,
      contactCount,
      agreementCount,
      templateCount,
      signatureCount,
      roleCount,
      userCount,
      openRepairs,
      pendingMovements,
      verificationExceptions,
      assetsByStatus,
      agreementsByStatus,
      movementsByStatus,
      verificationByStatus,
    ] = await Promise.all([
      Asset.countDocuments({ isDeleted: false }),
      Contact.countDocuments({ isDeleted: false }),
      Agreement.countDocuments({ isDeleted: false }),
      DocumentTemplate.countDocuments({ isDeleted: false }),
      SignatureMaster.countDocuments({ isDeleted: false }),
      Role.countDocuments({ isDeleted: false }),
      User.countDocuments({ isDeleted: false }),
      RepairTicket.countDocuments({ isDeleted: false, status: { $nin: ['CLOSED'] } }),
      Movement.countDocuments({ isDeleted: false, status: 'REQUESTED' }),
      VerificationRecord.countDocuments({ isDeleted: false, status: 'EXCEPTION' }),
      Asset.aggregate([
        { $match: { isDeleted: false } },
        { $group: { _id: '$status', count: { $sum: 1 } } },
      ]),
      Agreement.aggregate([
        { $match: { isDeleted: false } },
        { $group: { _id: '$status', count: { $sum: 1 } } },
      ]),
      Movement.aggregate([
        { $match: { isDeleted: false } },
        { $group: { _id: '$status', count: { $sum: 1 } } },
      ]),
      VerificationRecord.aggregate([
        { $match: { isDeleted: false } },
        { $group: { _id: '$status', count: { $sum: 1 } } },
      ]),
    ]);

    const exportedAt = new Date().toISOString();

    sendMultiSheetExcel(res, 'DHub_Dashboard_Summary.xlsx', [
      {
        name: 'Summary',
        headers: ['Metric', 'Count'],
        rows: [
          ['Exported At', exportedAt],
          ['Asset Inventory', assetCount],
          ['Contacts', contactCount],
          ['Agreements', agreementCount],
          ['Document Templates', templateCount],
          ['Signatures', signatureCount],
          ['Roles', roleCount],
          ['Users', userCount],
          ['Open Repairs', openRepairs],
          ['Pending Movements', pendingMovements],
          ['Verification Exceptions', verificationExceptions],
        ],
      },
      {
        name: 'Assets by Status',
        headers: ['Status', 'Count'],
        rows: assetsByStatus.map((x) => [x._id || '—', x.count]),
      },
      {
        name: 'Agreements by Status',
        headers: ['Status', 'Count'],
        rows: agreementsByStatus.map((x) => [x._id || '—', x.count]),
      },
      {
        name: 'Movements by Status',
        headers: ['Status', 'Count'],
        rows: movementsByStatus.map((x) => [x._id || '—', x.count]),
      },
      {
        name: 'Verifications by Status',
        headers: ['Status', 'Count'],
        rows: verificationByStatus.map((x) => [x._id || '—', x.count]),
      },
    ]);
  })
);

router.get(
  '/verification-compliance',
  asyncHandler(async (req, res) => {
    const periodKey = req.query.periodKey;
    const match = { isDeleted: false };
    if (periodKey) match.periodKey = periodKey;
    const rows = await VerificationRecord.aggregate([
      { $match: match },
      { $group: { _id: '$status', count: { $sum: 1 } } },
    ]);
    res.json({ data: Object.fromEntries(rows.map((r) => [r._id, r.count])) });
  })
);

router.get(
  '/agreements-health',
  asyncHandler(async (_req, res) => {
    const now = new Date();
    const in30 = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
    const [active, expiring, expired] = await Promise.all([
      Agreement.countDocuments({ isDeleted: false, status: 'ACTIVE', endDate: { $gte: in30 } }),
      Agreement.countDocuments({
        isDeleted: false,
        status: { $in: ['ACTIVE', 'EXPIRING'] },
        endDate: { $gte: now, $lt: in30 },
      }),
      Agreement.countDocuments({
        isDeleted: false,
        $or: [{ status: 'EXPIRED' }, { status: 'ACTIVE', endDate: { $lt: now } }],
      }),
    ]);
    res.json({ data: { active, expiring, expired } });
  })
);

router.get(
  '/repairs-sla',
  asyncHandler(async (_req, res) => {
    const now = new Date();
    const open = await RepairTicket.find({
      isDeleted: false,
      status: { $nin: ['CLOSED'] },
    })
      .select('ticketNumber status slaDueAt priority assetId')
      .populate('assetId', 'assetTag')
      .limit(50)
      .sort({ slaDueAt: 1 });
    const breached = open.filter((t) => t.slaDueAt && t.slaDueAt < now).length;
    res.json({ data: { openCount: open.length, breached, items: open } });
  })
);

router.get(
  '/movements-pipeline',
  asyncHandler(async (_req, res) => {
    const rows = await Movement.aggregate([
      { $match: { isDeleted: false } },
      { $group: { _id: '$status', count: { $sum: 1 } } },
    ]);
    res.json({ data: Object.fromEntries(rows.map((r) => [r._id, r.count])) });
  })
);

export default router;

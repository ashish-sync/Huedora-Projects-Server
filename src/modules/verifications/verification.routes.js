import { Router } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { v4 as uuid } from 'uuid';
import { authenticate, requirePermission } from '../../middleware/auth.js';
import { asyncHandler, parsePagination, paginated, AppError } from '../../utils/helpers.js';
import { PERMISSIONS } from '../../config/constants.js';
import { VerificationCampaign, VerificationRecord, VerificationInvite, VerificationActivity } from './verification.model.js';
import { Asset } from '../assets/asset.model.js';
import { Contact } from '../contacts/contact.model.js';
import { env } from '../../config/env.js';
import {
  computeDeviceCondition,
  periodKeyFromDate,
  startOfDay,
  endOfDay,
  verifiedInRange,
} from './verification.condition.js';
import {
  completeVerificationRound,
  createSelfVerifyInvite,
  logCallAttempt,
} from './verification.service.js';
import { AGREEMENT_SIGNED_EQUIVALENTS } from '../devices/device.constants.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const uploadRoot = path.resolve(__dirname, '../../../uploads/verifications');
fs.mkdirSync(uploadRoot, { recursive: true });

const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, uploadRoot),
    filename: (_req, file, cb) => {
      const ext = path.extname(file.originalname || '').toLowerCase() || '.jpg';
      cb(null, `${uuid()}${ext}`);
    },
  }),
  limits: { fileSize: env.uploadMaxBytes },
  fileFilter: (_req, file, cb) => {
    if (!String(file.mimetype || '').startsWith('image/')) {
      return cb(new AppError('GPS photo must be an image', 400, 'VALIDATION_ERROR'));
    }
    cb(null, true);
  },
});

const router = Router();
router.use(authenticate);

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
  '/board',
  requirePermission(PERMISSIONS.VERIFICATIONS_READ),
  asyncHandler(async (req, res) => {
    const from = req.query.from ? startOfDay(req.query.from) : null;
    const to = req.query.to ? endOfDay(req.query.to) : null;
    if ((req.query.from && !from) || (req.query.to && !to)) {
      throw new AppError('Invalid date range. Use YYYY-MM-DD.', 400, 'VALIDATION_ERROR');
    }
    if (from && to && from.getTime() > to.getTime()) {
      throw new AppError('From date must be on or before To date', 400, 'VALIDATION_ERROR');
    }

    const periodKey = String(
      req.query.periodKey || (to ? periodKeyFromDate(to) : periodKeyFromDate())
    ).trim();
    if (!/^\d{4}-\d{2}$/.test(periodKey)) {
      throw new AppError('periodKey must be YYYY-MM', 400, 'VALIDATION_ERROR');
    }

    // Condition rules use days-in-month of the active period (To date's month)
    const [py, pm] = periodKey.split('-').map(Number);
    const periodAnchor = new Date(py, pm - 1, Math.min(to?.getDate() || 15, 28));

    const campaign = await ensureCampaign(periodKey, req.user._id);
    const assets = await Asset.find({
      isDeleted: false,
      agreementStatus: { $in: AGREEMENT_SIGNED_EQUIVALENTS },
    }).sort({ updatedAt: -1 });

    // Backfill legacy "Active" → picklist value on read
    for (const asset of assets) {
      if (asset.agreementStatus === 'Active') {
        asset.agreementStatus = 'Agreement Signed';
        await asset.save();
      }
    }

    const rows = [];
    const counts = { SAFE: 0, CAUTION: 0, DANGER: 0 };

    for (const asset of assets) {
      const record = await ensureRecord(campaign, asset, req.user._id);
      const condition = computeDeviceCondition(asset, record, periodAnchor);

      let holder = null;
      if (asset.contactId) {
        const contact = await Contact.findOne({ _id: asset.contactId, isDeleted: false });
        if (contact) {
          holder = {
            _id: contact._id,
            name: contact.name,
            email: contact.email || '',
            phone: contact.contact || contact.mobile || '',
            city: contact.city || '',
          };
        }
      }

      let pendingLink = null;
      if (condition.nextRound) {
        const invites = await VerificationInvite.find({
          recordId: record._id,
          round: condition.nextRound,
          status: 'PENDING',
          isDeleted: false,
        });
        const invite = invites[0];
        if (invite) {
          pendingLink = {
            _id: invite._id,
            shortCode: invite.shortCode,
            sentAt: invite.sentAt,
            expiresAt: invite.expiresAt,
            holderName: invite.holderName,
          };
        }
      }

      if (from && to) {
        const inRange = verifiedInRange(asset, record, from, to);
        const pendingThisPeriod = Boolean(condition.nextRound);
        // Date-range search: activity in range, or still pending for the active period
        if (!inRange && !pendingThisPeriod) continue;
      }

      counts[condition.condition] = (counts[condition.condition] || 0) + 1;
      rows.push({
        asset: {
          _id: asset._id,
          assetTag: asset.assetTag,
          serialNumber: asset.serialNumber,
          deviceNameSnapshot: asset.deviceNameSnapshot,
          agreementStatus: asset.agreementStatus,
          custody: asset.custody,
          status: asset.status,
          lastVerifiedAt: asset.lastVerifiedAt || null,
          contactId: asset.contactId || null,
        },
        holder,
        pendingLink,
        record: {
          _id: record._id,
          status: record.status,
          round1: record.round1 || {},
          round2: record.round2 || {},
          periodKey: record.periodKey,
          callRemark: record.callRemark || '',
          callbackAt: record.callbackAt || null,
        },
        condition,
      });
    }

    let filtered = rows;
    if (req.query.condition) {
      const want = String(req.query.condition).toUpperCase();
      filtered = rows.filter((r) => r.condition.condition === want);
    }

    res.json({
      data: {
        periodKey,
        from: from ? formatYmd(from) : null,
        to: to ? formatYmd(to) : null,
        campaign: { _id: campaign._id, periodKey: campaign.periodKey, label: campaign.label },
        counts: filtered.reduce(
          (acc, r) => {
            acc[r.condition.condition] = (acc[r.condition.condition] || 0) + 1;
            return acc;
          },
          { SAFE: 0, CAUTION: 0, DANGER: 0 }
        ),
        daysInMonth: conditionDaysInMonth(periodKey),
        rows: filtered,
      },
    });
  })
);

function conditionDaysInMonth(periodKey) {
  const [y, m] = periodKey.split('-').map(Number);
  return new Date(y, m, 0).getDate();
}

function formatYmd(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

router.get(
  '/campaigns',
  asyncHandler(async (req, res) => {
    const { page, limit, skip, sort } = parsePagination(req.query);
    const filter = { isDeleted: false };
    const [data, total] = await Promise.all([
      VerificationCampaign.find(filter).sort(sort).skip(skip).limit(limit),
      VerificationCampaign.countDocuments(filter),
    ]);
    res.json(paginated(data, total, page, limit));
  })
);

router.post(
  '/campaigns',
  requirePermission(PERMISSIONS.VERIFICATIONS_WRITE),
  asyncHandler(async (req, res) => {
    if (!req.body.periodKey) throw new AppError('periodKey required (YYYY-MM)', 400, 'VALIDATION_ERROR');
    const campaign = await ensureCampaign(req.body.periodKey, req.user._id);
    res.status(201).json({ data: campaign });
  })
);

router.get(
  '/records',
  asyncHandler(async (req, res) => {
    const { page, limit, skip, sort } = parsePagination(req.query);
    const filter = { isDeleted: false };
    if (req.query.campaignId) filter.campaignId = req.query.campaignId;
    if (req.query.periodKey) filter.periodKey = req.query.periodKey;
    if (req.query.status) filter.status = req.query.status;
    const [data, total] = await Promise.all([
      VerificationRecord.find(filter)
        .populate('assetId', 'assetTag serialNumber status agreementStatus custody')
        .sort(sort)
        .skip(skip)
        .limit(limit),
      VerificationRecord.countDocuments(filter),
    ]);
    res.json(paginated(data, total, page, limit));
  })
);

router.post(
  '/records/:id/rounds/:round',
  requirePermission(PERMISSIONS.VERIFICATIONS_WRITE),
  upload.single('photo'),
  asyncHandler(async (req, res) => {
    const roundNum = Number(req.params.round);
    const record = await VerificationRecord.findOne({ _id: req.params.id, isDeleted: false });
    if (!record) throw new AppError('Verification record not found', 404);

    const lat = req.body.latitude != null && req.body.latitude !== '' ? Number(req.body.latitude) : null;
    const lng =
      req.body.longitude != null && req.body.longitude !== '' ? Number(req.body.longitude) : null;

    const result = await completeVerificationRound({
      record,
      roundNum,
      payload: {
        photoFilename: req.file?.filename,
        photoName: req.file?.originalname,
        latitude: lat,
        longitude: lng,
        accuracy: req.body.accuracy,
        physical: req.body.physical,
        functionality: req.body.functionality,
        callRemark: req.body.callRemark,
        currentLocation: req.body.currentLocation,
        zone: req.body.zone,
        custodianName: req.body.custodianName,
        custodianContact: req.body.custodianContact,
      },
      actor: req.user,
      requestId: req.requestId,
      method: 'MANUAL',
    });

    res.json({ data: result });
  })
);

router.post(
  '/records/:id/send-link',
  requirePermission(PERMISSIONS.VERIFICATIONS_WRITE),
  asyncHandler(async (req, res) => {
    const roundNum = Number(req.body.round);
    if (![1, 2].includes(roundNum)) {
      throw new AppError('round must be 1 or 2', 400, 'VALIDATION_ERROR');
    }

    const record = await VerificationRecord.findOne({ _id: req.params.id, isDeleted: false });
    if (!record) throw new AppError('Verification record not found', 404);

    const asset = await Asset.findOne({ _id: record.assetId, isDeleted: false });
    if (!asset) throw new AppError('Asset not found', 404);

    const { invite, contact } = await createSelfVerifyInvite({
      record,
      asset,
      roundNum,
      actor: req.user,
      requestId: req.requestId,
    });

    res.json({
      data: {
        invite: {
          _id: invite._id,
          shortCode: invite.shortCode,
          accessToken: invite.accessToken,
          round: invite.round,
          expiresAt: invite.expiresAt,
          holderName: contact.name,
          holderEmail: contact.email,
          holderPhone: contact.contact || contact.mobile,
        },
      },
    });
  })
);

router.post(
  '/records/:id/call-attempt',
  requirePermission(PERMISSIONS.VERIFICATIONS_WRITE),
  asyncHandler(async (req, res) => {
    const roundNum = Number(req.body.round);
    if (![1, 2].includes(roundNum)) {
      throw new AppError('round must be 1 or 2', 400, 'VALIDATION_ERROR');
    }

    const record = await VerificationRecord.findOne({ _id: req.params.id, isDeleted: false });
    if (!record) throw new AppError('Verification record not found', 404);

    const result = await logCallAttempt({
      record,
      roundNum,
      outcome: req.body.outcome,
      note: req.body.note,
      callbackAt: req.body.callbackAt,
      actor: req.user,
      requestId: req.requestId,
    });

    res.json({ data: result });
  })
);

router.get(
  '/records/:id/activity',
  requirePermission(PERMISSIONS.VERIFICATIONS_READ),
  asyncHandler(async (req, res) => {
    const record = await VerificationRecord.findOne({ _id: req.params.id, isDeleted: false });
    if (!record) throw new AppError('Verification record not found', 404);

    const activities = await VerificationActivity.find({ recordId: record._id }).sort('-at').limit(100);
    res.json({ data: activities });
  })
);

router.post(
  '/records',
  requirePermission(PERMISSIONS.VERIFICATIONS_WRITE),
  asyncHandler(async (req, res) => {
    const campaign = await VerificationCampaign.findOne({
      _id: req.body.campaignId,
      isDeleted: false,
    });
    if (!campaign) throw new AppError('Campaign not found', 404);

    let asset = null;
    if (req.body.assetId) {
      asset = await Asset.findById(req.body.assetId);
    } else if (req.body.serialNumber) {
      asset = await Asset.findOne({ serialNumber: req.body.serialNumber, isDeleted: false });
    }

    const record = await VerificationRecord.create({
      ...req.body,
      periodKey: campaign.periodKey,
      assetId: asset?._id || req.body.assetId || null,
      createdBy: req.user._id,
      updatedBy: req.user._id,
      status: req.body.status || 'IN_PROGRESS',
    });

    res.status(201).json({ data: record });
  })
);

router.patch(
  '/records/:id',
  requirePermission(PERMISSIONS.VERIFICATIONS_WRITE),
  asyncHandler(async (req, res) => {
    const record = await VerificationRecord.findOne({ _id: req.params.id, isDeleted: false });
    if (!record) throw new AppError('Record not found', 404);
    const fields = [
      'round1',
      'round2',
      'finalStatus',
      'status',
      'callRemark',
      'deviceValue',
      'zone',
      'currentLocation',
      'custodianName',
      'custodianContact',
    ];
    for (const f of fields) {
      if (req.body[f] !== undefined) record[f] = req.body[f];
    }
    record.updatedBy = req.user._id;
    if (record.round1?.verifiedOn && record.round2?.verifiedOn) {
      record.status = record.status === 'EXCEPTION' ? 'EXCEPTION' : 'COMPLETED';
      if (!record.finalStatus) record.finalStatus = 'OK';
    }
    await record.save();
    res.json({ data: record });
  })
);

export default router;

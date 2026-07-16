import { Router } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { v4 as uuid } from 'uuid';
import { asyncHandler, AppError } from '../../utils/helpers.js';
import { VerificationRecord, VerificationInvite } from './verification.model.js';
import { Asset } from '../assets/asset.model.js';
import { Contact } from '../contacts/contact.model.js';
import { findInviteByAccessKey } from './verificationAccess.js';
import {
  completeVerificationRound,
  completeInviteAfterSelfVerify,
} from './verification.service.js';
import { env } from '../../config/env.js';

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
      return cb(new AppError('Verification photo must be an image', 400, 'VALIDATION_ERROR'));
    }
    cb(null, true);
  },
});

const photoUpload = upload.fields([
  { name: 'photoFull', maxCount: 1 },
  { name: 'photoSerial', maxCount: 1 },
  { name: 'photosExtra', maxCount: 8 },
]);

function photosFromUpload(req) {
  const full = req.files?.photoFull?.[0];
  const serial = req.files?.photoSerial?.[0];
  const extras = req.files?.photosExtra || [];
  const photos = [];
  if (full) {
    photos.push({ kind: 'FULL_DEVICE', filename: full.filename, name: full.originalname });
  }
  if (serial) {
    photos.push({ kind: 'SERIAL_VISIBLE', filename: serial.filename, name: serial.originalname });
  }
  for (const f of extras) {
    photos.push({ kind: 'ADDITIONAL', filename: f.filename, name: f.originalname });
  }
  if (!photos.length && req.file) {
    photos.push({ kind: 'FULL_DEVICE', filename: req.file.filename, name: req.file.originalname });
  }
  return photos;
}

const router = Router();

function publicContext(invite, record, asset, contact) {
  return {
    inviteId: invite._id,
    round: invite.round,
    periodKey: invite.periodKey,
    expiresAt: invite.expiresAt,
    holder: {
      name: invite.holderName,
      email: invite.holderEmail ? maskEmail(invite.holderEmail) : null,
    },
    asset: {
      name: asset.deviceNameSnapshot || asset.assetTag,
      serialNumber: asset.serialNumber || null,
      assetTag: asset.assetTag || null,
      custody: asset.custody || null,
    },
    record: {
      _id: record._id,
      callRemark: record.callRemark || '',
      currentLocation: record.currentLocation || '',
      zone: record.zone || '',
    },
    sentBy: 'Tylo Care',
  };
}

function maskEmail(email) {
  const [user, domain] = String(email).split('@');
  if (!domain) return '***';
  const visible = user.slice(0, 2);
  return `${visible}***@${domain}`;
}

async function resolveInvite(token) {
  const invite = await findInviteByAccessKey(token);
  if (!invite) throw new AppError('Invalid or expired verification link', 404);

  if (invite.expiresAt && new Date(invite.expiresAt).getTime() < Date.now()) {
    invite.status = 'EXPIRED';
    await invite.save();
    throw new AppError('This verification link has expired', 410, 'LINK_EXPIRED');
  }

  const record = await VerificationRecord.findOne({ _id: invite.recordId, isDeleted: false });
  if (!record) throw new AppError('Verification record not found', 404);

  const asset = await Asset.findOne({ _id: invite.assetId, isDeleted: false });
  if (!asset) throw new AppError('Asset not found', 404);

  const key = invite.round === 1 ? 'round1' : 'round2';
  if (record[key]?.verifiedOn) {
    invite.status = 'COMPLETED';
    await invite.save();
    throw new AppError('This verification round is already complete', 400, 'ALREADY_VERIFIED');
  }

  return { invite, record, asset };
}

router.get(
  '/:token',
  asyncHandler(async (req, res) => {
    const { invite, record, asset } = await resolveInvite(req.params.token);
    const contact = invite.holderContactId
      ? await Contact.findOne({ _id: invite.holderContactId, isDeleted: false })
      : null;
    res.json({ data: publicContext(invite, record, asset, contact) });
  })
);

router.post(
  '/:token',
  photoUpload,
  asyncHandler(async (req, res) => {
    const { invite, record, asset } = await resolveInvite(req.params.token);

    const lat = req.body.latitude != null && req.body.latitude !== '' ? Number(req.body.latitude) : null;
    const lng =
      req.body.longitude != null && req.body.longitude !== '' ? Number(req.body.longitude) : null;

    const actor = {
      email: invite.holderEmail || invite.holderPhone || 'asset-holder',
      fullName: invite.holderName,
    };

    const result = await completeVerificationRound({
      record,
      roundNum: invite.round,
      payload: {
        photos: photosFromUpload(req),
        latitude: lat,
        longitude: lng,
        accuracy: req.body.accuracy,
        physical: req.body.physical,
        functionality: req.body.functionality,
        callRemark: req.body.callRemark,
        currentLocation: req.body.currentLocation,
        zone: req.body.zone,
        custodianName: invite.holderName,
        custodianContact: invite.holderPhone || invite.holderEmail,
      },
      actor,
      requestId: req.requestId,
      method: 'SELF_SERVICE',
    });

    await completeInviteAfterSelfVerify(invite, record);

    res.json({
      data: {
        ok: true,
        round: invite.round,
        condition: result.condition,
        message: `Round ${invite.round} verification submitted successfully.`,
      },
    });
  })
);

export default router;

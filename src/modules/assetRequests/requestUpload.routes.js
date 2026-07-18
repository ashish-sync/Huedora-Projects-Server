import { createHash } from 'crypto';
import { Router } from 'express';
import { asyncHandler, AppError } from '../../utils/helpers.js';
import { writeAudit } from '../../utils/audit.js';
import {
  AssetRequest,
  AssetRequestUploadInvite,
  typeLabel,
} from './assetRequest.model.js';
import { imageMetadata, productPhotoUpload, removeImageFile } from './productImage.js';

const router = Router();
const ACTIVE_STATUSES = ['REQUESTED', 'APPROVED'];
const IMAGE_REQUEST_TYPES = ['REPAIR', 'MAINTENANCE'];

function hashToken(raw) {
  const token = String(raw || '');
  if (!token || token.length > 512) return null;
  return createHash('sha256').update(token).digest('hex');
}

async function resolveInvite(rawToken) {
  const tokenHash = hashToken(rawToken);
  const invite = tokenHash
    ? await AssetRequestUploadInvite.findOne({ tokenHash })
    : null;
  if (!invite) throw new AppError('Invalid upload link', 404, 'LINK_INVALID');

  if (
    invite.status === 'PENDING' &&
    invite.expiresAt &&
    new Date(invite.expiresAt).getTime() <= Date.now()
  ) {
    await AssetRequestUploadInvite.findOneAndUpdate(
      { _id: invite._id, status: 'PENDING' },
      { $set: { status: 'REVOKED' } }
    );
    throw new AppError('This upload link has expired', 410, 'LINK_EXPIRED');
  }

  const request = await AssetRequest.findOne({
    _id: invite.requestId,
    isDeleted: false,
  });
  if (!request) throw new AppError('Request not found', 404);

  if (!IMAGE_REQUEST_TYPES.includes(request.requestType)) {
    await AssetRequestUploadInvite.findOneAndUpdate(
      { _id: invite._id, status: 'PENDING' },
      { $set: { status: 'REVOKED' } }
    );
    throw new AppError('Upload link is not valid for this request type', 410, 'LINK_REVOKED');
  }

  if (invite.status === 'PENDING' && !ACTIVE_STATUSES.includes(request.status)) {
    await AssetRequestUploadInvite.findOneAndUpdate(
      { _id: invite._id, status: 'PENDING' },
      { $set: { status: 'REVOKED' } }
    );
    throw new AppError('Request is no longer active', 410, 'LINK_REVOKED');
  }

  return { invite, request };
}

function publicContext(invite, request) {
  return {
    status: invite.status,
    expiresAt: invite.expiresAt,
    request: {
      requestNumber: request.requestNumber || request._id,
      requestType: typeLabel(request.requestType),
      assetName: request.assetName || '',
      assetTag: request.assetTag || null,
      serialNumber: request.serialNumber || null,
      custodianName: invite.custodianName || request.custodianName || '',
    },
    custodian: {
      name: invite.custodianName || '',
    },
  };
}

router.get(
  '/:token',
  asyncHandler(async (req, res) => {
    const { invite, request } = await resolveInvite(req.params.token);
    res.json({ data: publicContext(invite, request) });
  })
);

router.post(
  '/:token',
  asyncHandler(async (req, _res, next) => {
    const resolved = await resolveInvite(req.params.token);
    if (resolved.invite.status !== 'PENDING') {
      const expired = resolved.invite.status === 'REVOKED';
      throw new AppError(
        expired ? 'This upload link is no longer active' : 'This upload link has already been used',
        expired ? 410 : 409,
        expired ? 'LINK_REVOKED' : 'LINK_COMPLETED'
      );
    }
    req.uploadInvite = resolved.invite;
    req.assetRequest = resolved.request;
    next();
  }),
  productPhotoUpload,
  asyncHandler(async (req, res) => {
    if (!req.file) {
      throw new AppError('productPhoto is required', 400, 'VALIDATION_ERROR');
    }

    const image = imageMetadata(req.file, 'CUSTODIAN_INVITE');
    const completedAt = new Date().toISOString();

    const completedInvite = await AssetRequestUploadInvite.findOneAndUpdate(
      { _id: req.uploadInvite._id, status: 'PENDING' },
      { $set: { status: 'COMPLETED', completedAt, image } }
    );
    if (!completedInvite) {
      removeImageFile(image);
      throw new AppError('This upload link has already been used', 409, 'LINK_COMPLETED');
    }

    const updatedRequest = await AssetRequest.findOneAndUpdate(
      {
        _id: req.assetRequest._id,
        isDeleted: false,
        requestType: { $in: IMAGE_REQUEST_TYPES },
        status: { $in: ACTIVE_STATUSES },
      },
      { $set: { productImage: image } }
    );
    if (!updatedRequest) {
      await AssetRequestUploadInvite.findOneAndUpdate(
        { _id: completedInvite._id, status: 'COMPLETED' },
        { $set: { status: 'REVOKED', completedAt: null, image: null } }
      );
      removeImageFile(image);
      throw new AppError('Request is no longer active', 410, 'LINK_REVOKED');
    }

    await writeAudit({
      actorType: 'CONTACT',
      actorId: req.uploadInvite.contactId || null,
      actorEmail: req.uploadInvite.custodianContact || null,
      action: 'ASSET_REQUEST.PRODUCT_IMAGE_INVITE.COMPLETE',
      entityType: 'AssetRequestUploadInvite',
      entityId: completedInvite._id,
      after: {
        requestId: updatedRequest._id,
        completedAt,
        image,
      },
      ip: req.ip,
      userAgent: req.get('user-agent') || null,
      requestId: req.requestId,
    });

    res.json({
      data: {
        status: 'COMPLETED',
        completedAt,
      },
    });
  })
);

export default router;

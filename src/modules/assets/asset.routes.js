import { Router } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { v4 as uuid } from 'uuid';
import { authenticate, requirePermission, hasPermission } from '../../middleware/auth.js';
import { asyncHandler, parsePagination, paginated, AppError } from '../../utils/helpers.js';
import { PERMISSIONS } from '../../config/constants.js';
import { env } from '../../config/env.js';
import { Asset } from './asset.model.js';
import { AssetEvent } from './assetEvent.model.js';
import { createAsset, transitionAsset } from './asset.service.js';
import { DeviceMaster } from '../devices/device.model.js';
import { Contact } from '../contacts/contact.model.js';
import {
  Agreement,
  AgreementAsset,
  AgreementDocument,
  AgreementActivity,
} from '../agreements/agreement.model.js';
import { nextSequence } from '../../utils/counters.js';
import { writeAudit } from '../../utils/audit.js';
import { sendExcel } from '../../utils/excelExport.js';
import {
  ASSET_TYPE_OPTIONS,
  AGREEMENT_STATUS_OPTIONS,
  DEVICE_CUSTODY_OPTIONS,
  normalizeAgreementStatus,
  normalizeDeviceCustody,
  normalizeAssetType,
  normalizeCustodianState,
} from '../devices/device.constants.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const agreementUploadRoot = path.resolve(__dirname, '../../../uploads/agreements');
fs.mkdirSync(agreementUploadRoot, { recursive: true });

const agreementUpload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, agreementUploadRoot),
    filename: (_req, file, cb) => {
      const safe = file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_');
      cb(null, `${uuid()}-${safe}`);
    },
  }),
  limits: { fileSize: env.uploadMaxBytes },
  fileFilter: (_req, file, cb) => {
    const ok =
      file.mimetype === 'application/pdf' ||
      String(file.originalname || '')
        .toLowerCase()
        .endsWith('.pdf') ||
      file.mimetype === 'application/msword' ||
      file.mimetype ===
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
    if (!ok) return cb(new Error('Upload a PDF or Word document'));
    cb(null, true);
  },
});

const router = Router();
router.use(authenticate);

const canManageDocs = requirePermission(
  PERMISSIONS.AGREEMENTS_WRITE,
  PERMISSIONS.DOCUMENTS_WRITE,
  PERMISSIONS.ASSETS_WRITE
);

const PURCHASE_RE = /^(0[1-9]|1[0-2])\/\d{4}$/;

function normalizePurchaseMonth(raw) {
  const v = String(raw || '').trim();
  if (!v) return null;
  if (PURCHASE_RE.test(v)) return v;
  const loose = /^(0?[1-9]|1[0-2])\/(\d{4})$/.exec(v);
  if (loose) return `${String(loose[1]).padStart(2, '0')}/${loose[2]}`;
  const iso = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(v);
  if (iso) return `${iso[2]}/${iso[1]}`;
  return null;
}

function purchaseMonthToDate(mmYyyy) {
  if (!mmYyyy || !PURCHASE_RE.test(mmYyyy)) return null;
  const [mm, yyyy] = mmYyyy.split('/');
  return `${yyyy}-${mm}-01`;
}

function stripValue(asset, req) {
  const obj = asset.toObject ? asset.toObject() : { ...asset };
  if (!hasPermission(req, PERMISSIONS.ASSETS_VIEW_VALUE)) delete obj.deviceValue;
  return obj;
}

router.get(
  '/',
  requirePermission(PERMISSIONS.ASSETS_READ),
  asyncHandler(async (req, res) => {
    const { page, limit, skip, sort } = parsePagination(req.query);
    const filter = { isDeleted: false };
    if (req.query.status) filter.status = req.query.status;
    if (req.query.agreementStatus) filter.agreementStatus = req.query.agreementStatus;
    if (req.query.custody) filter.custody = req.query.custody;
    if (req.query.hcwId) filter.hcwId = req.query.hcwId;
    if (req.query.contactId) filter.contactId = req.query.contactId;
    if (req.query.q) {
      const q = String(req.query.q);
      const regex = new RegExp(q, 'i');
      const contactMatches = await Contact.find({
        isDeleted: false,
        $or: [{ name: regex }, { city: regex }, { email: regex }, { contact: regex }],
      });
      const contactIds = contactMatches.map((c) => c._id);
      filter.$or = [
        { serialNumber: regex },
        { assetTag: regex },
        { deviceNameSnapshot: regex },
        { hcwBusinessId: regex },
        { 'location.city': regex },
        ...(contactIds.length ? [{ contactId: { $in: contactIds } }] : []),
      ];
    }
    const [rows, total] = await Promise.all([
      Asset.find(filter)
        .populate('deviceMasterId', 'name assetType cost purchaseMonth description')
        .populate('hcwId', 'hcwId name contact city')
        .populate('contactId', 'name email city state contact resourceType profession')
        .sort(sort)
        .skip(skip)
        .limit(limit),
      Asset.countDocuments(filter),
    ]);
    res.json(paginated(rows.map((a) => stripValue(a, req)), total, page, limit));
  })
);

router.get(
  '/export',
  requirePermission(PERMISSIONS.ASSETS_READ),
  asyncHandler(async (req, res) => {
    const rows = await Asset.find({ isDeleted: false })
      .populate('deviceMasterId', 'name assetType cost purchaseMonth description')
      .populate('contactId', 'name email city state contact')
      .populate('hcwId', 'name contact city')
      .sort('-createdAt');

    const showValue = hasPermission(req, PERMISSIONS.ASSETS_VIEW_VALUE);
    const headers = [
      'Asset Name',
      'Asset Type',
      'Serial Number',
      'Asset Tag',
      'Status',
      'Asset Status',
      'Asset Custody',
      'Custodian Name',
      'Custodian Contact',
      'Custodian City',
      'Custodian State',
      ...(showValue ? ['Asset Value'] : []),
      'Purchase (MM/YYYY)',
      'Description',
    ];

    sendExcel(
      res,
      'Asset_Inventory.xlsx',
      headers,
      rows.map((a) => {
        const contact = a.contactId;
        const hcw = a.hcwId;
        const custodianName =
          a.custodianName || contact?.name || hcw?.name || '';
        const custodianContact =
          a.custodianContact || contact?.contact || contact?.email || hcw?.contact || '';
        const city = a.location?.city || contact?.city || hcw?.city || a.custodianCity || '';
        const state = a.location?.state || contact?.state || a.custodianState || '';
        const deviceName =
          a.deviceNameSnapshot || a.deviceMasterId?.name || '';
        const cols = [
          deviceName,
          a.assetType || a.deviceMasterId?.assetType || '',
          a.serialNumber,
          a.assetTag,
          a.status,
          a.agreementStatus,
          a.custody,
          custodianName,
          custodianContact,
          city,
          state,
        ];
        if (showValue) cols.push(a.deviceValue ?? a.deviceMasterId?.cost);
        cols.push(
          a.addedMonth || a.deviceMasterId?.purchaseMonth || '',
          a.remarks || a.deviceMasterId?.description || ''
        );
        return cols;
      }),
      { sheetName: 'Inventory' }
    );
  })
);

router.get(
  '/by-qr/:code',
  requirePermission(PERMISSIONS.ASSETS_READ),
  asyncHandler(async (req, res) => {
    const asset = await Asset.findOne({ qrCode: req.params.code, isDeleted: false })
      .populate('deviceMasterId')
      .populate('hcwId');
    if (!asset) throw new AppError('Asset not found for QR', 404);
    res.json({ data: stripValue(asset, req) });
  })
);

router.get(
  '/:id/documents',
  requirePermission(PERMISSIONS.ASSETS_READ),
  asyncHandler(async (req, res) => {
    const asset = await Asset.findOne({ _id: req.params.id, isDeleted: false });
    if (!asset) throw new AppError('Asset not found', 404);

    const links = await AgreementAsset.find({ assetId: asset._id });
    const agreementIds = new Set(
      links.map((l) => String(l.agreementId)).filter(Boolean)
    );
    if (asset.activeAgreementId) agreementIds.add(String(asset.activeAgreementId));

    const items = [];
    for (const agreementId of agreementIds) {
      const agreement = await Agreement.findOne({ _id: agreementId, isDeleted: false });
      if (!agreement) continue;
      const documents = await AgreementDocument.find({
        agreementId: agreement._id,
        isDeleted: false,
      }).sort('-createdAt');
      items.push({
        _id: agreement._id,
        agreementNumber: agreement.agreementNumber,
        title: agreement.title,
        status: agreement.status,
        type: agreement.type,
        partyName: agreement.partyName,
        startDate: agreement.startDate,
        endDate: agreement.endDate,
        completedAt: agreement.completedAt,
        documentSource: agreement.documentSource,
        isActiveLink: links.some(
          (l) => String(l.agreementId) === String(agreement._id) && l.isActive !== false
        ),
        documents: documents.map((d) => ({
          _id: d._id,
          fileName: d.name || d.fileName,
          name: d.name || d.fileName,
          mimeType: d.contentType || d.mimeType,
          contentType: d.contentType || d.mimeType,
          kind: d.docKind || d.kind,
          docKind: d.docKind || d.kind,
          version: d.version || 1,
          isPrimary: Boolean(d.isPrimary),
          sizeBytes: d.sizeBytes || 0,
          createdAt: d.createdAt,
          hasFile: Boolean(d.storageKey),
        })),
      });
    }

    items.sort((a, b) => {
      const ta = a.completedAt || a.startDate || '';
      const tb = b.completedAt || b.startDate || '';
      return String(tb).localeCompare(String(ta));
    });

    res.json({ data: items });
  })
);

/** Upload a signed agreement for this asset (creates envelope + link if needed). */
router.post(
  '/:id/documents',
  canManageDocs,
  agreementUpload.single('file'),
  asyncHandler(async (req, res) => {
    const asset = await Asset.findOne({ _id: req.params.id, isDeleted: false });
    if (!asset) throw new AppError('Asset not found', 404);
    if (!req.file) throw new AppError('Choose a signed agreement file to upload', 400, 'VALIDATION_ERROR');

    const title =
      String(req.body.title || '').trim() ||
      `Signed agreement: ${asset.deviceNameSnapshot || asset.assetTag || asset.serialNumber || 'asset'}`;

    const agreement = await Agreement.create({
      agreementNumber: await nextSequence('agreementNumber', 'AGR'),
      title,
      status: 'COMPLETED',
      type: req.body.type || 'LEASE',
      documentSource: 'UPLOAD',
      signingType: 'NON_SIGNING',
      partyName: asset.custodianName || '',
      partyContact: asset.custodianContact || '',
      partyCity: asset.custodianCity || asset.location?.city || '',
      partyState: asset.custodianState || asset.location?.state || '',
      contactId: asset.contactId || null,
      completedAt: new Date().toISOString(),
      startDate: new Date().toISOString().slice(0, 10),
      termsSummary: 'Uploaded signed agreement from Asset Registry',
    });

    await AgreementAsset.create({
      agreementId: agreement._id,
      assetId: asset._id,
      isActive: true,
      linkedAt: new Date().toISOString(),
    });

    const doc = await AgreementDocument.create({
      agreementId: agreement._id,
      name: req.file.originalname,
      docKind: 'CONTRACT',
      contentType: req.file.mimetype,
      sizeBytes: req.file.size,
      storageKey: req.file.filename,
      version: 1,
      isPrimary: true,
      uploadedBy: req.user._id,
    });

    asset.activeAgreementId = agreement._id;
    asset.agreementStatus = normalizeAgreementStatus('Agreement Signed') || 'Agreement Signed';
    await asset.save();

    await AgreementActivity.create({
      agreementId: agreement._id,
      at: new Date().toISOString(),
      actorId: req.user._id,
      actorName: req.user.fullName,
      actorEmail: req.user.email,
      action: 'DOCUMENT_UPLOADED',
      message: `Signed agreement uploaded from Asset Registry: ${doc.name}`,
    });

    await AssetEvent.create({
      assetId: asset._id,
      at: new Date().toISOString(),
      type: 'AGREEMENT_UPLOADED',
      message: `Signed agreement ${agreement.agreementNumber} uploaded`,
      actorId: req.user._id,
    });

    await writeAudit({
      actorId: req.user._id,
      actorEmail: req.user.email,
      action: 'ASSET.AGREEMENT_UPLOAD',
      entityType: 'Asset',
      entityId: asset._id,
      after: { agreementId: agreement._id, documentId: doc._id },
      requestId: req.requestId,
    });

    res.status(201).json({
      data: {
        agreement,
        document: doc,
      },
    });
  })
);

/**
 * Replace the primary signed file on a linked agreement.
 * Previous files are kept (not deleted) for future reference.
 */
router.post(
  '/:id/documents/:agreementId/replace',
  canManageDocs,
  agreementUpload.single('file'),
  asyncHandler(async (req, res) => {
    const asset = await Asset.findOne({ _id: req.params.id, isDeleted: false });
    if (!asset) throw new AppError('Asset not found', 404);
    if (!req.file) throw new AppError('Choose a file to replace the agreement', 400, 'VALIDATION_ERROR');

    const link = await AgreementAsset.findOne({
      assetId: asset._id,
      agreementId: req.params.agreementId,
    });
    const isActiveAgreement = String(asset.activeAgreementId || '') === String(req.params.agreementId);
    if (!link && !isActiveAgreement) {
      throw new AppError('Agreement is not linked to this asset', 404);
    }

    const agreement = await Agreement.findOne({
      _id: req.params.agreementId,
      isDeleted: false,
    });
    if (!agreement) throw new AppError('Agreement not found', 404);

    const existing = await AgreementDocument.find({
      agreementId: agreement._id,
      isDeleted: false,
    });
    const maxVersion = existing.reduce((m, d) => Math.max(m, Number(d.version) || 1), 0);

    for (const d of existing) {
      if (d.isPrimary) {
        d.isPrimary = false;
        d.docKind = d.docKind === 'CONTRACT' ? 'ATTACHMENT' : d.docKind;
        await d.save();
      }
    }

    const doc = await AgreementDocument.create({
      agreementId: agreement._id,
      name: req.file.originalname,
      docKind: 'CONTRACT',
      contentType: req.file.mimetype,
      sizeBytes: req.file.size,
      storageKey: req.file.filename,
      version: maxVersion + 1,
      isPrimary: true,
      uploadedBy: req.user._id,
      replacedPrevious: true,
    });

    if (req.body.title?.trim()) {
      agreement.title = req.body.title.trim();
    }
    if (!['COMPLETED', 'ACTIVE'].includes(agreement.status)) {
      agreement.status = 'COMPLETED';
      agreement.completedAt = agreement.completedAt || new Date().toISOString();
    }
    await agreement.save();

    asset.activeAgreementId = agreement._id;
    asset.agreementStatus = normalizeAgreementStatus('Agreement Signed') || 'Agreement Signed';
    await asset.save();

    await AgreementActivity.create({
      agreementId: agreement._id,
      at: new Date().toISOString(),
      actorId: req.user._id,
      actorName: req.user.fullName,
      actorEmail: req.user.email,
      action: 'DOCUMENT_REPLACED',
      message: `Replaced signed agreement with ${doc.name} (v${doc.version}); prior files kept`,
    });

    await writeAudit({
      actorId: req.user._id,
      actorEmail: req.user.email,
      action: 'ASSET.AGREEMENT_REPLACE',
      entityType: 'Asset',
      entityId: asset._id,
      after: { agreementId: agreement._id, documentId: doc._id, version: doc.version },
      requestId: req.requestId,
    });

    res.status(201).json({ data: { agreement, document: doc } });
  })
);

router.get(
  '/:id',
  requirePermission(PERMISSIONS.ASSETS_READ),
  asyncHandler(async (req, res) => {
    const asset = await Asset.findOne({ _id: req.params.id, isDeleted: false })
      .populate('deviceMasterId')
      .populate('hcwId')
      .populate('contactId')
      .populate('activeAgreementId');
    if (!asset) throw new AppError('Asset not found', 404);
    res.json({ data: stripValue(asset, req) });
  })
);

router.get(
  '/:id/timeline',
  requirePermission(PERMISSIONS.ASSETS_READ),
  asyncHandler(async (req, res) => {
    const events = await AssetEvent.find({ assetId: req.params.id }).sort({ at: -1 }).limit(200);
    res.json({ data: events });
  })
);

router.post(
  '/',
  requirePermission(PERMISSIONS.ASSETS_WRITE),
  asyncHandler(async (req, res) => {
    const device = await DeviceMaster.findOne({ _id: req.body.deviceMasterId, isDeleted: false });
    if (!device) throw new AppError('Linked asset register record required', 400, 'VALIDATION_ERROR');
    const asset = await createAsset(
      {
        ...req.body,
        deviceNameSnapshot: req.body.deviceNameSnapshot || device.name,
        status: req.body.status || 'Purchased',
      },
      req.user
    );
    res.status(201).json({ data: stripValue(asset, req) });
  })
);

router.patch(
  '/:id',
  requirePermission(PERMISSIONS.ASSETS_WRITE),
  asyncHandler(async (req, res) => {
    const asset = await Asset.findOne({ _id: req.params.id, isDeleted: false });
    if (!asset) throw new AppError('Asset not found', 404);

    const masterPatch = {};

    if (req.body.deviceNameSnapshot != null || req.body.name != null) {
      const name = String(req.body.deviceNameSnapshot ?? req.body.name).trim();
      if (!name) throw new AppError('Asset Name is required', 400, 'VALIDATION_ERROR');
      asset.deviceNameSnapshot = name;
      masterPatch.name = name;
    }

    if (req.body.assetType != null) {
      const assetType = normalizeAssetType(req.body.assetType);
      if (!assetType) {
        throw new AppError(
          `Asset Type must be one of: ${ASSET_TYPE_OPTIONS.join(', ')}`,
          400,
          'VALIDATION_ERROR'
        );
      }
      asset.assetType = assetType;
      masterPatch.assetType = assetType;
    }

    if (req.body.serialNumber != null) {
      const serialNumber = String(req.body.serialNumber).trim();
      if (!serialNumber) throw new AppError('Serial Number is required', 400, 'VALIDATION_ERROR');
      if (serialNumber !== asset.serialNumber) {
        const clash = await Asset.findOne({
          serialNumber,
          isDeleted: false,
          _id: { $ne: asset._id },
        });
        if (clash) {
          throw new AppError(
            `Serial number “${serialNumber}” already exists`,
            400,
            'SERIAL_EXISTS'
          );
        }
      }
      asset.serialNumber = serialNumber;
      masterPatch.serialNumber = serialNumber;
    }

    if (
      req.body.deviceValue != null ||
      req.body.cost != null ||
      req.body.assetValue != null
    ) {
      const cost = Number(req.body.deviceValue ?? req.body.cost ?? req.body.assetValue);
      if (!Number.isFinite(cost) || cost < 0) {
        throw new AppError('Asset Value must be a valid non-negative number', 400, 'VALIDATION_ERROR');
      }
      asset.deviceValue = cost;
      masterPatch.cost = cost;
    }

    if (req.body.purchaseMonth != null || req.body.addedMonth != null) {
      const purchaseMonth = normalizePurchaseMonth(req.body.purchaseMonth ?? req.body.addedMonth);
      if (!purchaseMonth) {
        throw new AppError('Purchase month must be MM/YYYY', 400, 'VALIDATION_ERROR');
      }
      asset.addedMonth = purchaseMonth;
      asset.purchaseDate = purchaseMonthToDate(purchaseMonth);
      masterPatch.purchaseMonth = purchaseMonth;
    }

    if (req.body.remarks != null || req.body.description != null) {
      const description = String(req.body.remarks ?? req.body.description).trim() || null;
      asset.remarks = description || undefined;
      masterPatch.description = description;
    }

    if (req.body.agreementStatus != null || req.body.assetStatus != null) {
      const normalized = normalizeAgreementStatus(
        req.body.agreementStatus ?? req.body.assetStatus
      );
      if (req.body.agreementStatus || req.body.assetStatus) {
        if (!normalized) {
          throw new AppError(
            `Asset Status must be one of: ${AGREEMENT_STATUS_OPTIONS.join(', ')}`,
            400,
            'VALIDATION_ERROR'
          );
        }
      }
      asset.agreementStatus = normalized || 'Not Initiated';
      masterPatch.agreementStatus = asset.agreementStatus;
    }

    if (
      req.body.custody != null ||
      req.body.assetCustody != null ||
      req.body.deviceCustody != null
    ) {
      const custody = normalizeDeviceCustody(
        req.body.custody || req.body.assetCustody || req.body.deviceCustody
      );
      if (!custody) {
        throw new AppError(
          `Asset Custody must be one of: ${DEVICE_CUSTODY_OPTIONS.join(', ')}`,
          400,
          'VALIDATION_ERROR'
        );
      }
      asset.custody = custody;
      masterPatch.custody = custody;
    }

    if (req.body.custodianName != null) {
      const custodianName = String(req.body.custodianName).trim();
      if (!custodianName) throw new AppError('Custodian Name is required', 400, 'VALIDATION_ERROR');
      asset.custodianName = custodianName;
      masterPatch.custodianName = custodianName;
    }

    if (req.body.custodianContact != null) {
      const custodianContact = String(req.body.custodianContact).trim();
      if (!custodianContact) {
        throw new AppError('Custodian Contact is required', 400, 'VALIDATION_ERROR');
      }
      asset.custodianContact = custodianContact;
      masterPatch.custodianContact = custodianContact;
    }

    let loc = { ...(asset.location || {}) };
    let locChanged = false;
    if (req.body.custodianCity != null || req.body.city != null) {
      const city = String(req.body.custodianCity ?? req.body.city).trim();
      if (!city) throw new AppError('Custodian City is required', 400, 'VALIDATION_ERROR');
      loc.city = city;
      locChanged = true;
      masterPatch.custodianCity = city;
    }
    if (req.body.custodianState != null || req.body.state != null) {
      const custodianState = normalizeCustodianState(req.body.custodianState ?? req.body.state);
      if (!custodianState) {
        throw new AppError(
          'Custodian State must be a valid Indian state or union territory',
          400,
          'VALIDATION_ERROR'
        );
      }
      loc.state = custodianState;
      locChanged = true;
      masterPatch.custodianState = custodianState;
    }
    if (req.body.location !== undefined && typeof req.body.location === 'object') {
      loc = { ...loc, ...req.body.location };
      locChanged = true;
      if (req.body.location.city != null) masterPatch.custodianCity = String(req.body.location.city).trim();
      if (req.body.location.state != null) {
        const st = normalizeCustodianState(req.body.location.state);
        if (st) masterPatch.custodianState = st;
      }
    }
    if (locChanged) asset.location = loc;

    const allowed = ['quantity', 'warehouseCode', 'purchaseDate', 'warrantyEnd'];
    for (const key of allowed) {
      if (req.body[key] !== undefined) asset[key] = req.body[key];
    }

    if (req.body.contactId !== undefined) {
      if (!req.body.contactId) {
        asset.contactId = null;
      } else {
        const contact = await Contact.findOne({ _id: req.body.contactId, isDeleted: false });
        if (!contact) throw new AppError('Contact not found in directory', 404);
        asset.contactId = contact._id;
        asset.hcwId = null;
        asset.hcwBusinessId = null;
        if (req.body.location === undefined && !locChanged && contact.city) {
          asset.location = { ...(asset.location || {}), city: contact.city };
        }
        if (!masterPatch.custodianName && contact.name) {
          asset.custodianName = contact.name;
          masterPatch.custodianName = contact.name;
        }
        if (!masterPatch.custodianContact && (contact.contact || contact.email)) {
          const cc = contact.contact || contact.email;
          asset.custodianContact = cc;
          masterPatch.custodianContact = cc;
        }
      }
    }

    asset.updatedBy = req.user._id;
    await asset.save();

    if (asset.deviceMasterId && Object.keys(masterPatch).length) {
      await DeviceMaster.findOneAndUpdate(
        { _id: asset.deviceMasterId, isDeleted: false },
        { $set: masterPatch }
      );
    }

    const populated = await Asset.findOne({ _id: asset._id, isDeleted: false })
      .populate('deviceMasterId', 'name assetType cost purchaseMonth description')
      .populate('contactId', 'name email city state contact resourceType profession');

    res.json({ data: stripValue(populated || asset, req) });
  })
);

router.post(
  '/:id/transitions',
  requirePermission(PERMISSIONS.ASSETS_TRANSITION),
  asyncHandler(async (req, res) => {
    const asset = await transitionAsset({
      assetId: req.params.id,
      toStatus: req.body.toStatus,
      reason: req.body.reason,
      contactId: req.body.contactId || req.body.hcwId,
      location: req.body.location,
      actor: req.user,
      requestId: req.requestId,
    });
    res.json({ data: stripValue(asset, req) });
  })
);

export default router;

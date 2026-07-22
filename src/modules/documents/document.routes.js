import { Router } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { authenticate, requirePermission } from '../../middleware/auth.js';
import { asyncHandler, AppError } from '../../utils/helpers.js';
import { PERMISSIONS } from '../../config/constants.js';
import { Document } from './document.model.js';
import { env } from '../../config/env.js';
import { writeAudit } from '../../utils/audit.js';
import { v4 as uuid } from 'uuid';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const uploadRoot = path.resolve(__dirname, '../../../uploads');
fs.mkdirSync(uploadRoot, { recursive: true });

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    const dir = path.join(uploadRoot, 'tmp');
    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (_req, file, cb) => {
    const safe = file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_');
    cb(null, `${uuid()}-${safe}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: env.uploadMaxBytes },
  fileFilter: (_req, file, cb) => {
    const allowed = [
      'application/pdf',
      'image/jpeg',
      'image/png',
      'image/webp',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/vnd.ms-excel',
      'text/csv',
    ];
    if (!allowed.includes(file.mimetype)) {
      return cb(new AppError('File type not allowed', 400, 'INVALID_FILE'));
    }
    cb(null, true);
  },
});

const router = Router();
router.use(authenticate);

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const filter = { isDeleted: false };
    if (req.query.entityType) filter.entityType = req.query.entityType;
    if (req.query.entityId) filter.entityId = req.query.entityId;
    const data = await Document.find(filter).sort({ createdAt: -1 }).limit(100);
    res.json({ data });
  })
);

router.post(
  '/',
  requirePermission(PERMISSIONS.DOCUMENTS_WRITE),
  upload.single('file'),
  asyncHandler(async (req, res) => {
    if (!req.file) throw new AppError('file required', 400, 'VALIDATION_ERROR');
    const { entityType, entityId, docType } = req.body;
    if (!entityType || !entityId) throw new AppError('entityType and entityId required', 400);

    const destDir = path.join(uploadRoot, entityType, String(entityId));
    fs.mkdirSync(destDir, { recursive: true });
    const destName = req.file.filename;
    const destPath = path.join(destDir, destName);
    fs.renameSync(req.file.path, destPath);

    const storageKey = path.join(entityType, String(entityId), destName).replace(/\\/g, '/');
    const doc = await Document.create({
      entityType,
      entityId,
      docType: docType || 'OTHER',
      originalName: req.file.originalname,
      contentType: req.file.mimetype,
      sizeBytes: req.file.size,
      storageKey,
      uploadedBy: req.user._id,
    });

    await writeAudit({
      actorId: req.user._id,
      actorEmail: req.user.email,
      action: 'DOCUMENT.UPLOAD',
      entityType: 'Document',
      entityId: doc._id,
      requestId: req.requestId,
    });

    res.status(201).json({ data: doc });
  })
);

router.get(
  '/:id/download',
  asyncHandler(async (req, res) => {
    const doc = await Document.findOne({ _id: req.params.id, isDeleted: false });
    if (!doc) throw new AppError('Document not found', 404);
    const full = path.join(uploadRoot, doc.storageKey);
    if (!fs.existsSync(full)) throw new AppError('File missing on disk', 404);
    await writeAudit({
      actorId: req.user._id,
      actorEmail: req.user.email,
      action: 'DOCUMENT.DOWNLOAD',
      entityType: 'Document',
      entityId: doc._id,
      requestId: req.requestId,
    });
    res.download(full, doc.originalName);
  })
);

router.delete(
  '/:id',
  requirePermission(PERMISSIONS.DOCUMENTS_WRITE),
  asyncHandler(async (req, res) => {
    const doc = await Document.findOne({ _id: req.params.id, isDeleted: false });
    if (!doc) throw new AppError('Document not found', 404);
    doc.isDeleted = true;
    doc.deletedAt = new Date();
    doc.deletedBy = req.user._id;
    await doc.save();
    res.json({ data: { ok: true } });
  })
);

export default router;

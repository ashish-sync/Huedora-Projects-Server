import fs from 'fs';
import path from 'path';
import multer from 'multer';
import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { asyncHandler, AppError } from '../../utils/helpers.js';
import { writeAudit } from '../../utils/audit.js';
import { uploadDir } from '../../config/paths.js';
import { requireSafeUploads, UPLOAD_RULES } from '../../utils/rejectUnsafeUpload.js';
import { createUploadStorage } from '../../storage/createUploadStorage.js';
import { deleteLocalUpload, renameLocalUpload } from '../../storage/persistUpload.js';
import { finalizeExecutionDocumentUploads } from '../../storage/finalizeExecutionDocs.js';
import { toSignedUploadUrl } from '../files/file.routes.js';
import { buildExecutionDocumentFileName } from './executionDocumentName.js';
import { EXEC_DOC_MAX_FILES_PER_REQUEST } from '../../storage/media/uploadLimits.js';
import {
  applyExecutorDraft,
  assertInviteEditable,
  createOrRefreshExecutionInvite,
  evaluateGpsAgainstCamp,
  executorSubmitBlockers,
  EXECUTION_DOC_TYPES,
  loadMappedConsumables,
  publicExecutionContext,
  resolveExecutionInvite,
} from './campExecute.service.js';
import { normalizeExecutionDocType } from './campOps.lifecycle.js';

const router = Router();
const campUploadRoot = uploadDir('camp-ops');
const CAMP_DOC_MAX_BYTES = 10 * 1024 * 1024;

const campDocUpload = multer({
  storage: createUploadStorage({
    destination: (_req, _file, cb) => cb(null, campUploadRoot),
  }),
  limits: { fileSize: CAMP_DOC_MAX_BYTES },
  fileFilter: (_req, file, cb) => {
    const mime = String(file.mimetype || '').toLowerCase();
    const allowed = mime.startsWith('image/') || mime === 'application/pdf';
    cb(allowed ? null : new Error('Execution documents must be PDF or image (max 10 MB)'), allowed);
  },
});

const linkLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => req.ip || 'unknown',
  message: { error: { message: 'Too many requests. Try again later.', code: 'RATE_LIMIT' } },
});

function withSignedDocs(context) {
  return {
    ...context,
    documents: (context.documents || []).map((doc) => ({
      ...doc,
      url: doc.url ? toSignedUploadUrl(doc.url) : '',
    })),
  };
}

function isOwnedExecutionDocName(existing, storedName) {
  return (existing || []).some(
    (doc) => doc.storedName === storedName || doc.fileName === storedName,
  );
}

async function appendExecutionDocs(camp, { files, docType, docNote }) {
  const existing = Array.isArray(camp.executionDocuments) ? camp.executionDocuments : [];
  const uploadedAt = new Date().toISOString();
  const usedNames = existing.flatMap((doc) => [doc.fileName, doc.storedName]).filter(Boolean);
  const added = [];

  for (const [index, file] of files.entries()) {
    const { fileName: displayName, storedName } = buildExecutionDocumentFileName({
      doctorName: camp.doctorName,
      docType,
      originalName: file.filename || file.originalname,
      existingNames: usedNames,
      index,
      campScope: camp.campId || camp._id,
      isTaken: ({ storedName: candidate }) => {
        const finalPath = path.join(campUploadRoot, candidate);
        if (!fs.existsSync(finalPath)) return false;
        // Owned by this camp → allow replace (unlink happens below).
        if (isOwnedExecutionDocName(existing, candidate)) return false;
        // Orphaned/foreign file on disk → bump to -2, -3, …
        return true;
      },
    });
    usedNames.push(displayName, storedName);

    const tempPath = path.join(campUploadRoot, file.filename);
    const finalPath = path.join(campUploadRoot, storedName);
    if (tempPath !== finalPath && fs.existsSync(finalPath)) {
      if (!isOwnedExecutionDocName(existing, storedName)) {
        throw new AppError(
          `Execution document name conflict for ${displayName}`,
          409,
          'UPLOAD_NAME_CONFLICT',
        );
      }
      fs.unlinkSync(finalPath);
    }
    await renameLocalUpload(tempPath, finalPath, {
      contentType: file.mimetype,
      deferR2: false,
      originalName: displayName,
    });

    added.push({
      id: storedName,
      fileId: storedName,
      fileName: displayName,
      storedName,
      originalFileName: file.originalname,
      docType,
      ...(docNote ? { docNote } : {}),
      mimeType: file.mimetype,
      fileSize: file.size,
      url: `/uploads/camp-ops/${storedName}`,
      uploadedAt,
      storageStatus: 'ready',
    });
  }

  camp.executionDocuments = [...existing, ...added];
  if (docType === 'gps_selfie') {
    const selfie = added[added.length - 1];
    if (selfie?.url) camp.inTimeSelfieUrl = selfie.url;
  }
  return added;
}

router.get(
  '/:token',
  linkLimiter,
  asyncHandler(async (req, res) => {
    const { invite, camp } = await resolveExecutionInvite(req.params.token);
    const mapped = await loadMappedConsumables(camp);
    res.json({ data: withSignedDocs(publicExecutionContext(invite, camp, mapped)) });
  }),
);

router.put(
  '/:token/draft',
  linkLimiter,
  asyncHandler(async (req, res) => {
    const { invite, camp } = await resolveExecutionInvite(req.params.token);
    await assertInviteEditable(invite, camp);
    const before = camp.toObject();
    applyExecutorDraft(camp, req.body || {});
    await camp.save();
    invite.lastDraftAt = new Date().toISOString();
    await invite.save();
    await writeAudit({
      action: 'camp_ops.executor_draft',
      entityType: 'camp_ops_camp',
      entityId: camp._id,
      before,
      after: camp.toObject(),
      actorEmail: 'executor-link',
      requestId: req.correlationId,
      actorType: 'SYSTEM',
    });
    const mapped = await loadMappedConsumables(camp);
    res.json({ data: withSignedDocs(publicExecutionContext(invite, camp, mapped)) });
  }),
);

router.post(
  '/:token/documents',
  linkLimiter,
  (req, _res, next) => {
    req.uploadMaxBytes = CAMP_DOC_MAX_BYTES;
    next();
  },
  campDocUpload.array('documents', EXEC_DOC_MAX_FILES_PER_REQUEST),
  requireSafeUploads(UPLOAD_RULES.anySafe),
  asyncHandler(async (req, res) => {
    const { invite, camp } = await resolveExecutionInvite(req.params.token);
    await assertInviteEditable(invite, camp);

    const docType = normalizeExecutionDocType(req.body?.docType || 'other');
    const docNote = String(req.body?.docNote || '').trim();
    if (!EXECUTION_DOC_TYPES.includes(docType) || docType === 'other') {
      throw new AppError('Upload Doctor Form, Patient Form, or GPS Selfie', 400, 'VALIDATION_ERROR');
    }
    const files = Array.isArray(req.files) ? req.files : [];
    if (!files.length) throw new AppError('Select at least one file', 400, 'VALIDATION_ERROR');
    if (docType === 'gps_selfie') {
      const invalid = files.find((file) => !String(file.mimetype || '').startsWith('image/'));
      if (invalid) throw new AppError('GPS Selfie must be an image file', 400, 'VALIDATION_ERROR');
      const gps = evaluateGpsAgainstCamp(camp, {
        latitude: req.body?.latitude ?? req.body?.lat,
        longitude: req.body?.longitude ?? req.body?.lng,
        accuracy: req.body?.accuracy,
      });
      camp.executorGps = gps;
    }

    try {
      await finalizeExecutionDocumentUploads(req, { docType });
    } catch (err) {
      if (err instanceof AppError) throw err;
      throw new AppError(
        err?.message || 'Could not process the uploaded file. Try a smaller image.',
        err?.status || 500,
        err?.code || 'UPLOAD_OPTIMIZE_FAILED',
      );
    }

    const before = camp.toObject();
    await appendExecutionDocs(camp, { files, docType, docNote });
    if (!camp.executorFormStatus) camp.executorFormStatus = 'draft';
    await camp.save();
    invite.lastDraftAt = new Date().toISOString();
    await invite.save();
    await writeAudit({
      action: 'camp_ops.executor_docs',
      entityType: 'camp_ops_camp',
      entityId: camp._id,
      before,
      after: camp.toObject(),
      actorEmail: 'executor-link',
      requestId: req.correlationId,
      actorType: 'SYSTEM',
    });
    const mapped = await loadMappedConsumables(camp);
    res.json({ data: withSignedDocs(publicExecutionContext(invite, camp, mapped)) });
  }),
);

router.delete(
  '/:token/documents/:fileId',
  linkLimiter,
  asyncHandler(async (req, res) => {
    const { invite, camp } = await resolveExecutionInvite(req.params.token);
    await assertInviteEditable(invite, camp);
    const fileId = String(req.params.fileId || '').trim();
    const before = camp.toObject();
    const docs = Array.isArray(camp.executionDocuments) ? camp.executionDocuments : [];
    const removed = docs.find((doc) => {
      const id = String(doc.fileId || doc.id || doc.storedName || doc.url || '');
      return id === fileId;
    });
    const next = docs.filter((doc) => {
      const id = String(doc.fileId || doc.id || doc.storedName || doc.url || '');
      return id !== fileId;
    });
    if (next.length === docs.length) throw new AppError('Document not found', 404, 'NOT_FOUND');
    camp.executionDocuments = next;
    if (!next.some((d) => normalizeExecutionDocType(d.docType) === 'gps_selfie')) {
      camp.inTimeSelfieUrl = '';
    }
    await camp.save();
    if (removed?.storedName) {
      await deleteLocalUpload(path.join(campUploadRoot, removed.storedName)).catch(() => {});
    }
    await writeAudit({
      action: 'camp_ops.executor_docs_delete',
      entityType: 'camp_ops_camp',
      entityId: camp._id,
      before,
      after: camp.toObject(),
      actorEmail: 'executor-link',
      requestId: req.correlationId,
      actorType: 'SYSTEM',
    });
    const mapped = await loadMappedConsumables(camp);
    res.json({ data: withSignedDocs(publicExecutionContext(invite, camp, mapped)) });
  }),
);

router.post(
  '/:token/submit',
  linkLimiter,
  asyncHandler(async (req, res) => {
    const { invite, camp } = await resolveExecutionInvite(req.params.token);
    await assertInviteEditable(invite, camp);

    // Apply any final draft fields in the same request.
    applyExecutorDraft(camp, req.body || {});
    const mapped = await loadMappedConsumables(camp);
    const blockers = executorSubmitBlockers(camp, mapped);
    if (blockers.length) {
      throw new AppError(blockers[0], 400, 'VALIDATION_ERROR', { blockers });
    }

    const before = camp.toObject();
    const now = new Date().toISOString();
    camp.executorFormStatus = 'submitted';
    camp.executorSubmittedAt = now;
    // Do NOT Mark Complete — staff reviews in Camp One.
    await camp.save();

    invite.status = 'SUBMITTED';
    invite.submittedAt = now;
    await invite.save();

    await writeAudit({
      action: 'camp_ops.executor_submit',
      entityType: 'camp_ops_camp',
      entityId: camp._id,
      before,
      after: camp.toObject(),
      actorEmail: 'executor-link',
      requestId: req.correlationId,
      actorType: 'SYSTEM',
    });

    res.json({
      data: withSignedDocs(publicExecutionContext(invite, camp, mapped)),
    });
  }),
);

export { createOrRefreshExecutionInvite };
export default router;

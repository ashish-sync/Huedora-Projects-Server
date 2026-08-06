import { Router } from 'express';
import { authenticate, requirePermission, hasPermission, requireAdmin } from '../../middleware/auth.js';
import { asyncHandler, parsePagination, paginated, AppError } from '../../utils/helpers.js';
import { PERMISSIONS } from '../../config/constants.js';
import { SignatureMaster, normalizeSignaturePayload } from './signature.model.js';
import { SIGNATURE_ROLES } from './signature.constants.js';
import { writeAudit } from '../../utils/audit.js';
import { sendExcel, sendCsv } from '../../utils/excelExport.js';
import { importRateLimiter } from '../../middleware/importRateLimit.js';
import { executeUploadedImport } from '../imports/streaming/runStreamingImport.js';
import {
  cellValue,
  excelUpload,
  parseSheetRows,
  assertSpreadsheetUpload,
  discardUploadBuffer,
  sampleCsvFilename,
} from '../../utils/masterExcel.js';
import { escapeRegex } from '../../utils/escapeRegex.js';

const router = Router();
router.use(authenticate);

const canReadSignatures = requirePermission(PERMISSIONS.AGREEMENTS_READ, PERMISSIONS.AGREEMENTS_WRITE);
router.use((req, res, next) => {
  if (req.method !== 'GET') return next();
  return canReadSignatures(req, res, next);
});

router.get(
  '/meta/roles',
  asyncHandler(async (_req, res) => {
    res.json({ data: { roles: SIGNATURE_ROLES } });
  })
);

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const { page, limit, skip, sort } = parsePagination(req.query);
    const filter = { isDeleted: false };
    if (req.query.active !== 'false') filter.isActive = true;
    if (req.query.all === 'true') delete filter.isActive;
    if (req.query.role) filter.roleLabel = new RegExp(escapeRegex(String(req.query.role)), 'i');
    if (req.query.q) {
      const q = escapeRegex(String(req.query.q));
      filter.$or = [
        { name: new RegExp(q, 'i') },
        { email: new RegExp(q, 'i') },
        { roleLabel: new RegExp(q, 'i') },
        { department: new RegExp(q, 'i') },
      ];
    }
    // Admins see all signatures; normal users only their own profile mark(s)
    if (!hasPermission(req, PERMISSIONS.ALL)) {
      filter.createdBy = req.user._id;
    }
    const [data, total] = await Promise.all([
      SignatureMaster.find(filter).sort(sort || 'roleLabel name').skip(skip).limit(limit),
      SignatureMaster.countDocuments(filter),
    ]);
    res.json(paginated(data, total, page, limit));
  })
);

router.get(
  '/export',
  asyncHandler(async (req, res) => {
    const filter = { isDeleted: false };
    if (!hasPermission(req, PERMISSIONS.ALL)) {
      filter.createdBy = req.user._id;
    }
    const rows = await SignatureMaster.find(filter).sort('roleLabel name');
    sendExcel(
      res,
      'Signature_Master.xlsx',
      SIGNATURE_EXPORT_HEADERS,
      rows.map((s) => [
        s.name,
        s.roleLabel,
        s.email,
        s.department,
        s.signatureType === 'TYPED' ? s.signatureData : '',
        s.notes,
        s.isActive === false ? 'No' : 'Yes',
      ]),
      { sheetName: 'Signatures' }
    );
  })
);

import { SIGNATURE_EXPORT_HEADERS, SIGNATURE_HEADERS, SIGNATURE_SAMPLE_ROWS } from './signature.excel.js';

router.get(
  '/sample',
  asyncHandler(async (_req, res) => {
    sendCsv(
      res,
      sampleCsvFilename('Signature_Master'),
      SIGNATURE_HEADERS,
      SIGNATURE_SAMPLE_ROWS
    );
  })
);

router.post(
  '/import',
  requirePermission(PERMISSIONS.AGREEMENTS_WRITE),
  importRateLimiter,
  excelUpload.single('file'),
  asyncHandler(async (req, res) => {
    const { job, summary } = await executeUploadedImport({
      file: req.file,
      userId: req.user?._id,
      importType: 'SignatureMaster',
      processRow: async ({ rowNum, record: row }) => {
        const name = cellValue(row, ['Person name', 'Name', 'name']);
        if (!name) return { skipped: true };
        const roleLabel = cellValue(row, ['Role / designation', 'Role', 'roleLabel']);
        if (!roleLabel) throw new AppError('Role / designation is required', 400, 'VALIDATION_ERROR');
        const signatureType =
          cellValue(row, ['Signature Type', 'signatureType']).toUpperCase() || 'TYPED';
        if (signatureType !== 'TYPED') {
          throw new AppError('Import supports typed signatures only', 400, 'VALIDATION_ERROR');
        }
        const typed = cellValue(row, ['Typed signature', 'Typed Signature', 'signatureData']) || name;
        const payload = normalizeSignaturePayload({
          name,
          roleLabel,
          email: cellValue(row, ['Email', 'email']),
          department: cellValue(row, ['Department', 'department']),
          signatureType: 'TYPED',
          signatureData: typed,
          notes: cellValue(row, ['Notes', 'notes']),
          isActive: !['no', 'false', '0', 'inactive'].includes(
            cellValue(row, ['Active', 'isActive']).toLowerCase()
          ),
        });
        await SignatureMaster.create({
          ...payload,
          createdBy: req.user._id,
          updatedBy: req.user._id,
        });
        return { ok: true };
      },
    });

    res.json({
      data: {
        jobId: job?._id,
        status: job?.status,
        percent: job?.percent ?? 100,
        totalRows: summary.totalRows,
        created: summary.created,
        updated: 0,
        errorRows: summary.errorRows,
        errors: summary.errors,
      },
    });
  })
);

router.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const row = await SignatureMaster.findOne({ _id: req.params.id, isDeleted: false });
    if (!row) throw new AppError('Signature not found', 404);
    res.json({ data: row });
  })
);

router.post(
  '/',
  requirePermission(PERMISSIONS.AGREEMENTS_WRITE),
  asyncHandler(async (req, res) => {
    const payload = normalizeSignaturePayload(req.body);
    if (!payload.name) throw new AppError('Name is required', 400, 'VALIDATION_ERROR');
    if (!payload.roleLabel) throw new AppError('Role is required (e.g. HR, Director Finance)', 400, 'VALIDATION_ERROR');
    if (payload.signatureType === 'TYPED') {
      if (!payload.signatureData) {
        throw new AppError('Typed signature name is required', 400, 'VALIDATION_ERROR');
      }
    } else if (!payload.signatureData) {
      throw new AppError('Capture a drawn signature or upload an image', 400, 'VALIDATION_ERROR');
    } else if (!payload.signatureData.startsWith('data:image')) {
      throw new AppError('Signature image must be a PNG or JPEG', 400, 'VALIDATION_ERROR');
    }

    if (!hasPermission(req, PERMISSIONS.ALL)) {
      const existing = await SignatureMaster.countDocuments({
        createdBy: req.user._id,
        isDeleted: false,
      });
      if (existing >= 1) {
        throw new AppError(
          'Your profile may only store one signature. Edit or replace your existing mark.',
          400,
          'LIMIT'
        );
      }
    }

    const row = await SignatureMaster.create({
      ...payload,
      createdBy: req.user._id,
      updatedBy: req.user._id,
    });

    await writeAudit({
      actorId: req.user._id,
      actorEmail: req.user.email,
      action: 'SIGNATURE_MASTER.CREATE',
      entityType: 'SignatureMaster',
      entityId: row._id,
      after: { name: row.name, roleLabel: row.roleLabel },
      requestId: req.requestId,
    });

    res.status(201).json({ data: row });
  })
);

router.patch(
  '/:id',
  requirePermission(PERMISSIONS.AGREEMENTS_WRITE),
  asyncHandler(async (req, res) => {
    const row = await SignatureMaster.findOne({ _id: req.params.id, isDeleted: false });
    if (!row) throw new AppError('Signature not found', 404);
    if (!hasPermission(req, PERMISSIONS.ALL) && String(row.createdBy) !== String(req.user._id)) {
      throw new AppError('You can only edit your own signature', 403, 'FORBIDDEN');
    }

    const payload = normalizeSignaturePayload({ ...row, ...req.body });
    if (!payload.name) throw new AppError('Name is required', 400, 'VALIDATION_ERROR');
    if (!payload.roleLabel) throw new AppError('Role is required', 400, 'VALIDATION_ERROR');
    if (payload.signatureType === 'TYPED') {
      if (!payload.signatureData) {
        throw new AppError('Typed signature name is required', 400, 'VALIDATION_ERROR');
      }
    } else if (!payload.signatureData) {
      throw new AppError('Signature data is required', 400, 'VALIDATION_ERROR');
    } else if (!payload.signatureData.startsWith('data:image')) {
      throw new AppError('Signature image must be a PNG or JPEG', 400, 'VALIDATION_ERROR');
    }

    Object.assign(row, payload, { updatedBy: req.user._id });
    await row.save();

    await writeAudit({
      actorId: req.user._id,
      actorEmail: req.user.email,
      action: 'SIGNATURE_MASTER.UPDATE',
      entityType: 'SignatureMaster',
      entityId: row._id,
      after: { name: row.name, roleLabel: row.roleLabel, isActive: row.isActive },
      requestId: req.requestId,
    });

    res.json({ data: row });
  })
);

router.delete(
  '/:id',
  requireAdmin,
  asyncHandler(async (req, res) => {
    const row = await SignatureMaster.findOne({ _id: req.params.id, isDeleted: false });
    if (!row) throw new AppError('Signature not found', 404);
    row.isDeleted = true;
    row.isActive = false;
    row.updatedBy = req.user._id;
    await row.save();

    await writeAudit({
      actorId: req.user._id,
      actorEmail: req.user.email,
      action: 'SIGNATURE_MASTER.DELETE',
      entityType: 'SignatureMaster',
      entityId: row._id,
      requestId: req.requestId,
    });

    res.json({ data: { ok: true } });
  })
);

export default router;

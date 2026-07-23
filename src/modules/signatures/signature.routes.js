import { Router } from 'express';
import { authenticate, requirePermission, hasPermission } from '../../middleware/auth.js';
import { asyncHandler, parsePagination, paginated, AppError } from '../../utils/helpers.js';
import { PERMISSIONS } from '../../config/constants.js';
import { SignatureMaster, normalizeSignaturePayload } from './signature.model.js';
import { SIGNATURE_ROLES } from './signature.constants.js';
import { writeAudit } from '../../utils/audit.js';
import { sendExcel } from '../../utils/excelExport.js';
import { cellValue, excelUpload, parseSheetRows } from '../../utils/masterExcel.js';

const router = Router();
router.use(authenticate);

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
    if (req.query.role) filter.roleLabel = new RegExp(String(req.query.role), 'i');
    if (req.query.q) {
      const q = String(req.query.q);
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
      [
        'Name',
        'Role',
        'Email',
        'Department',
        'Signature Type',
        'Active',
        'Notes',
      ],
      rows.map((s) => [
        s.name,
        s.roleLabel,
        s.email,
        s.department,
        s.signatureType,
        s.isActive === false ? 'No' : 'Yes',
        s.notes,
      ]),
      { sheetName: 'Signatures' }
    );
  })
);

const SIGNATURE_HEADERS = [
  'Name',
  'Role',
  'Email',
  'Department',
  'Signature Type',
  'Typed Signature',
  'Active',
  'Notes',
];

router.get(
  '/sample',
  asyncHandler(async (_req, res) => {
    sendExcel(
      res,
      'Signature_Master_Sample.xlsx',
      SIGNATURE_HEADERS,
      [
        [
          'Priya Sharma',
          'HR',
          'priya@example.com',
          'Human Resources',
          'TYPED',
          'Priya Sharma',
          'Yes',
          'Sample typed signature',
        ],
      ],
      { sheetName: 'Signatures' }
    );
  })
);

router.post(
  '/import',
  requirePermission(PERMISSIONS.AGREEMENTS_WRITE),
  excelUpload.single('file'),
  asyncHandler(async (req, res) => {
    if (!req.file) throw new AppError('Excel file required', 400, 'VALIDATION_ERROR');
    const rows = parseSheetRows(req.file.buffer);
    const errors = [];
    let created = 0;

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const rowNum = i + 2;
      try {
        const name = cellValue(row, ['Name', 'name']);
        if (!name) continue;
        const roleLabel = cellValue(row, ['Role', 'roleLabel']);
        if (!roleLabel) throw new AppError('Role is required', 400, 'VALIDATION_ERROR');
        const signatureType = cellValue(row, ['Signature Type', 'signatureType']).toUpperCase() || 'TYPED';
        if (signatureType !== 'TYPED') {
          throw new AppError('Excel import supports TYPED signatures only', 400, 'VALIDATION_ERROR');
        }
        const typed = cellValue(row, ['Typed Signature', 'signatureData']) || name;
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
        created += 1;
      } catch (err) {
        errors.push({ row: rowNum, field: 'import', message: err.message });
      }
    }

    res.json({
      data: {
        totalRows: rows.length,
        created,
        updated: 0,
        errorRows: errors.length,
        errors: errors.slice(0, 200),
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
  requirePermission(PERMISSIONS.AGREEMENTS_WRITE),
  asyncHandler(async (req, res) => {
    const row = await SignatureMaster.findOne({ _id: req.params.id, isDeleted: false });
    if (!row) throw new AppError('Signature not found', 404);
    if (!hasPermission(req, PERMISSIONS.ALL) && String(row.createdBy) !== String(req.user._id)) {
      throw new AppError('You can only delete your own signature', 403, 'FORBIDDEN');
    }
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

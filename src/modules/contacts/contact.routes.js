import { Router } from 'express';
import multer from 'multer';
import XLSX from 'xlsx';
import { authenticate, requirePermission } from '../../middleware/auth.js';
import { asyncHandler, parsePagination, paginated, AppError } from '../../utils/helpers.js';
import { PERMISSIONS } from '../../config/constants.js';
import { Contact, normalizeContactPayload } from './contact.model.js';
import { RESOURCE_TYPES, PROFESSIONS } from './contact.constants.js';
import { writeAudit } from '../../utils/audit.js';
import { sendExcel } from '../../utils/excelExport.js';

const router = Router();
router.use(authenticate);

const CONTACT_HEADERS = [
  'Name',
  'Email',
  'Resource Type',
  'Profession',
  'Contact',
  'City',
  'State',
];

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

function sheetRows(buffer) {
  const wb = XLSX.read(buffer, { type: 'buffer' });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  return XLSX.utils.sheet_to_json(sheet, { defval: '' });
}

function cell(row, names) {
  for (const n of names) {
    if (row[n] !== undefined && String(row[n]).trim() !== '') return String(row[n]).trim();
  }
  const keys = Object.keys(row);
  for (const n of names) {
    const found = keys.find(
      (k) => k.toLowerCase().replace(/[\s_]+/g, '') === n.toLowerCase().replace(/[\s_]+/g, '')
    );
    if (found && String(row[found]).trim() !== '') return String(row[found]).trim();
  }
  return '';
}

router.get(
  '/meta/picklists',
  asyncHandler(async (_req, res) => {
    res.json({ data: { resourceTypes: RESOURCE_TYPES, professions: PROFESSIONS } });
  })
);

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const { page, limit, skip, sort } = parsePagination(req.query);
    const filter = { isDeleted: false };
    if (req.query.q) {
      const q = String(req.query.q);
      filter.$or = [
        { name: new RegExp(q, 'i') },
        { email: new RegExp(q, 'i') },
        { contact: new RegExp(q, 'i') },
        { mobile: new RegExp(q, 'i') },
        { resourceType: new RegExp(q, 'i') },
        { profession: new RegExp(q, 'i') },
        { city: new RegExp(q, 'i') },
        { state: new RegExp(q, 'i') },
      ];
    }
    const [data, total] = await Promise.all([
      Contact.find(filter).sort(sort || 'name').skip(skip).limit(limit),
      Contact.countDocuments(filter),
    ]);
    res.json(paginated(data, total, page, limit));
  })
);

router.get(
  '/export',
  asyncHandler(async (_req, res) => {
    const rows = await Contact.find({ isDeleted: false }).sort('name');
    sendExcel(
      res,
      'Contact_Directory.xlsx',
      CONTACT_HEADERS,
      rows.map((c) => [
        c.name,
        c.email,
        c.resourceType,
        c.profession,
        c.contact || c.mobile,
        c.city,
        c.state,
      ]),
      { sheetName: 'Contacts' }
    );
  })
);

router.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const contact = await Contact.findOne({ _id: req.params.id, isDeleted: false });
    if (!contact) throw new AppError('Contact not found', 404);
    res.json({ data: contact });
  })
);

router.post(
  '/',
  requirePermission(PERMISSIONS.AGREEMENTS_WRITE),
  asyncHandler(async (req, res) => {
    const payload = normalizeContactPayload(req.body);
    if (!payload.name) throw new AppError('Name is required', 400, 'VALIDATION_ERROR');
    if (!payload.email && !payload.contact) {
      throw new AppError('Email or Contact is required for delivery', 400, 'VALIDATION_ERROR');
    }

    if (payload.email) {
      const existingEmail = await Contact.findOne({
        email: payload.email,
        isDeleted: false,
      });
      if (existingEmail) {
        return res.status(200).json({ data: existingEmail, meta: { reused: true } });
      }
    }

    const contact = await Contact.create({
      ...payload,
      createdBy: req.user._id,
      updatedBy: req.user._id,
    });

    await writeAudit({
      actorId: req.user._id,
      actorEmail: req.user.email,
      action: 'CONTACT.CREATE',
      entityType: 'Contact',
      entityId: contact._id,
      after: contact.toObject(),
      requestId: req.requestId,
    });

    res.status(201).json({ data: contact });
  })
);

router.patch(
  '/:id',
  requirePermission(PERMISSIONS.AGREEMENTS_WRITE),
  asyncHandler(async (req, res) => {
    const contact = await Contact.findOne({ _id: req.params.id, isDeleted: false });
    if (!contact) throw new AppError('Contact not found', 404);
    const payload = normalizeContactPayload({
      name: req.body.name !== undefined ? req.body.name : contact.name,
      email: req.body.email !== undefined ? req.body.email : contact.email,
      resourceType: req.body.resourceType !== undefined ? req.body.resourceType : contact.resourceType,
      profession: req.body.profession !== undefined ? req.body.profession : contact.profession,
      contact:
        req.body.contact !== undefined
          ? req.body.contact
          : req.body.mobile !== undefined
            ? req.body.mobile
            : contact.contact || contact.mobile,
      city: req.body.city !== undefined ? req.body.city : contact.city,
      state: req.body.state !== undefined ? req.body.state : contact.state,
      organization: req.body.organization !== undefined ? req.body.organization : contact.organization,
      notes: req.body.notes !== undefined ? req.body.notes : contact.notes,
    });
    if (!payload.name) throw new AppError('Name is required', 400, 'VALIDATION_ERROR');
    Object.assign(contact, payload, { updatedBy: req.user._id });
    await contact.save();
    res.json({ data: contact });
  })
);

router.post(
  '/import',
  requirePermission(PERMISSIONS.AGREEMENTS_WRITE),
  upload.single('file'),
  asyncHandler(async (req, res) => {
    if (!req.file) throw new AppError('Excel file required', 400, 'VALIDATION_ERROR');
    const mode = req.body.mode === 'DRY_RUN' ? 'DRY_RUN' : 'COMMIT';
    const rows = sheetRows(req.file.buffer);
    const errors = [];
    let created = 0;
    let updated = 0;
    let skipped = 0;

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const rowNum = i + 2;
      const payload = normalizeContactPayload({
        name: cell(row, ['Name', 'name']),
        email: cell(row, ['Email', 'email']),
        resourceType: cell(row, ['Resource Type', 'ResourceType', 'resourceType']),
        profession: cell(row, ['Profession', 'profession']),
        contact: cell(row, ['Contact', 'contact', 'Mobile', 'Phone']),
        city: cell(row, ['City', 'city']),
        state: cell(row, ['State', 'state']),
      });

      if (!payload.name) {
        errors.push({ row: rowNum, field: 'Name', message: 'Name is required' });
        continue;
      }
      if (!payload.email && !payload.contact) {
        errors.push({ row: rowNum, field: 'Email/Contact', message: 'Email or Contact required' });
        continue;
      }

      try {
        if (mode === 'COMMIT') {
          let existing = null;
          if (payload.email) {
            existing = await Contact.findOne({ email: payload.email, isDeleted: false });
          }
          if (!existing && payload.contact) {
            const all = await Contact.find({ isDeleted: false }).limit(5000);
            existing = all.find(
              (c) =>
                String(c.contact || '') === payload.contact ||
                String(c.mobile || '') === payload.contact
            );
          }
          if (existing) {
            Object.assign(existing, payload, { updatedBy: req.user._id });
            await existing.save();
            updated += 1;
          } else {
            await Contact.create({
              ...payload,
              createdBy: req.user._id,
              updatedBy: req.user._id,
            });
            created += 1;
          }
        } else {
          skipped += 1;
        }
      } catch (err) {
        errors.push({ row: rowNum, field: 'import', message: err.message });
      }
    }

    if (mode === 'COMMIT') {
      await writeAudit({
        actorId: req.user._id,
        actorEmail: req.user.email,
        action: 'CONTACT.IMPORT',
        entityType: 'Contact',
        after: { created, updated, errors: errors.length, fileName: req.file.originalname },
        requestId: req.requestId,
      });
    }

    res.json({
      data: {
        mode,
        totalRows: rows.length,
        created,
        updated,
        validated: mode === 'DRY_RUN' ? rows.length - errors.length : created + updated,
        errorRows: errors.length,
        errors: errors.slice(0, 200),
      },
    });
  })
);

export default router;

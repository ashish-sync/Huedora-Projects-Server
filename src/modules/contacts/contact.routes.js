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
import { notifyImportFailures } from '../imports/importErrorReport.js';
import {
  assertContactIdentityAvailable,
  findContactByIdentity,
  resolveOrCreateContact,
} from './contactIdentity.js';
import { normalizePhone } from '../../utils/identityNormalize.js';

const router = Router();
router.use(authenticate);

const CONTACT_HEADERS = [
  'Name',
  'Email',
  'Resource Type',
  'Profession',
  'Contact',
  'City',
  'District',
  'State',
  'Pin Code',
  'Address',
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
        { pinCode: new RegExp(q, 'i') },
        { address: new RegExp(q, 'i') },
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
        c.district,
        c.state,
        c.pinCode,
        c.address,
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
    const { contact, created, reused } = await resolveOrCreateContact(payload, req.user._id);

    if (created) {
      await writeAudit({
        actorId: req.user._id,
        actorEmail: req.user.email,
        action: 'CONTACT.CREATE',
        entityType: 'Contact',
        entityId: contact._id,
        after: contact.toObject(),
        requestId: req.requestId,
      });
      return res.status(201).json({ data: contact });
    }

    res.status(200).json({ data: contact, meta: { reused: Boolean(reused) } });
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
      district: req.body.district !== undefined ? req.body.district : contact.district,
      pinCode: req.body.pinCode !== undefined ? req.body.pinCode : contact.pinCode,
      address: req.body.address !== undefined ? req.body.address : contact.address,
      organization: req.body.organization !== undefined ? req.body.organization : contact.organization,
      notes: req.body.notes !== undefined ? req.body.notes : contact.notes,
      stateId: req.body.stateId !== undefined ? req.body.stateId : contact.stateId,
      districtId: req.body.districtId !== undefined ? req.body.districtId : contact.districtId,
      cityId: req.body.cityId !== undefined ? req.body.cityId : contact.cityId,
    });
    if (!payload.name) throw new AppError('Name is required', 400, 'VALIDATION_ERROR');
    if (!payload.email && !payload.contact) {
      throw new AppError('Email or Contact is required for delivery', 400, 'VALIDATION_ERROR');
    }
    await assertContactIdentityAvailable({
      email: payload.email,
      phone: payload.contact,
      excludeId: contact._id,
    });
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
    const seenEmails = new Set();
    const seenPhones = new Set();

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

      const emailKey = payload.email;
      const phoneKey = normalizePhone(payload.contact);
      if (emailKey && seenEmails.has(emailKey)) {
        errors.push({
          row: rowNum,
          field: 'Email',
          message: 'Duplicate email in this file',
        });
        continue;
      }
      if (phoneKey && seenPhones.has(phoneKey)) {
        errors.push({
          row: rowNum,
          field: 'Contact',
          message: 'Duplicate phone number in this file',
        });
        continue;
      }
      if (emailKey) seenEmails.add(emailKey);
      if (phoneKey) seenPhones.add(phoneKey);

      try {
        if (mode === 'COMMIT') {
          const existing = await findContactByIdentity({
            email: payload.email,
            phone: payload.contact,
          });
          if (existing) {
            await assertContactIdentityAvailable({
              email: payload.email,
              phone: payload.contact,
              excludeId: existing._id,
            });
            Object.assign(existing, payload, { updatedBy: req.user._id });
            await existing.save();
            updated += 1;
          } else {
            const resolved = await resolveOrCreateContact(payload, req.user._id);
            if (resolved.created) created += 1;
            else updated += 1;
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

    let errorReport = null;
    if (errors.length) {
      errorReport = await notifyImportFailures({
        userId: req.user._id,
        importType: `CONTACT_${mode}`,
        sourceFileName: req.file.originalname,
        totalRows: rows.length,
        successRows: mode === 'DRY_RUN' ? rows.length - errors.length : created + updated,
        errors,
        entityType: 'Contact',
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
        errorReport: errorReport
          ? {
              fileName: errorReport.fileName,
              downloadPath: errorReport.downloadPath,
              notificationId: errorReport.notificationId,
            }
          : null,
      },
    });
  })
);

export default router;

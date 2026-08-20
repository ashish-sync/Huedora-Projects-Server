import fs from 'fs';
import { Router } from 'express';
import multer from 'multer';
import { authenticate, requirePermission } from '../../middleware/auth.js';
import { asyncHandler, parsePagination, paginated, AppError } from '../../utils/helpers.js';
import { PERMISSIONS } from '../../config/constants.js';
import { Contact, normalizeContactPayload } from './contact.model.js';
import {
  CONTACT_CATEGORIES,
  RESOURCE_TYPES,
  HCW_RESOURCE_TYPES,
  PROFESSIONS,
  CLIENT_PROFESSIONS,
  VENDOR_PROFESSIONS,
  SUPPLY_CATEGORIES,
  isServiceProviderContact,
} from './contact.constants.js';
import { writeAudit } from '../../utils/audit.js';
import { sendExcel, sendCsv } from '../../utils/excelExport.js';
import { notifyImportFailures } from '../imports/importErrorReport.js';
import {
  assertContactIdentityAvailable,
  findContactByIdentity,
  resolveOrCreateContact,
} from './contactIdentity.js';
import { normalizePhone } from '../../utils/identityNormalize.js';
import { escapeRegex } from '../../utils/escapeRegex.js';
import { uploadDir } from '../../config/paths.js';
import { assignPreservingExisting } from '../../store/dataIntegrity.js';
import {
  assertSpreadsheetUpload,
  discardUploadBuffer,
  excelUpload,
  parseSheetRows,
  sampleCsvFilename,
} from '../../utils/masterExcel.js';
import { importRateLimiter } from '../../middleware/importRateLimit.js';
import { loadCappedRowsFromUpload } from '../imports/streaming/loadCappedRows.js';
import {
  CONTACT_KYC_ACCEPT_EXTENSIONS,
  CONTACT_KYC_MAX_BYTES,
  CONTACT_KYC_REJECT_MESSAGE,
  isAllowedContactKycFile,
  withSignedContactKyc,
} from './contactKycUpload.js';
import { requireSafeUploads } from '../../utils/rejectUnsafeUpload.js';

const contactUploadRoot = uploadDir('contacts');

const router = Router();
router.use(authenticate);

const canReadContacts = requirePermission(
  PERMISSIONS.AGREEMENTS_READ,
  PERMISSIONS.AGREEMENTS_WRITE,
  PERMISSIONS.CAMPS_READ,
  PERMISSIONS.CAMPS_REQUEST,
  PERMISSIONS.CAMPS_APPROVE,
  PERMISSIONS.FINANCE_READ,
  PERMISSIONS.FINANCE_WRITE,
  PERMISSIONS.ASSET_REQUESTS_READ,
  PERMISSIONS.ASSET_REQUESTS_REQUEST,
  PERMISSIONS.ASSET_REQUESTS_APPROVE
);
router.use((req, res, next) => {
  if (req.method !== 'GET') return next();
  return canReadContacts(req, res, next);
});

import { CONTACT_HEADERS, CONTACT_SAMPLE_ROWS } from './contact.excel.js';

async function validateServiceProviderLink(payload, contactId = null) {
  if (payload.contactCategory !== 'Healthcare Worker') return;
  const spId = payload.serviceProviderContactId;
  if (!spId) return;
  if (contactId && String(spId) === String(contactId)) {
    throw new AppError('A contact cannot be their own service provider', 400, 'VALIDATION_ERROR');
  }
  const provider = await Contact.findOne({ _id: spId, isDeleted: false });
  if (!provider) {
    throw new AppError('Service provider contact not found', 404, 'NOT_FOUND');
  }
  if (!isServiceProviderContact(provider)) {
    throw new AppError(
      'Linked service provider must be a Healthcare Worker with Resource Type Service Provider',
      400,
      'VALIDATION_ERROR'
    );
  }
}

async function enrichContactsWithProviders(contacts = []) {
  const ids = [
    ...new Set(
      contacts.map((c) => c.serviceProviderContactId).filter(Boolean).map(String)
    ),
  ];
  if (!ids.length) return contacts;
  const providers = await Contact.find({ _id: { $in: ids }, isDeleted: false });
  const byId = Object.fromEntries(providers.map((p) => [String(p._id), p.name || '']));
  return contacts.map((c) => withSignedContactKyc({
    ...c,
    serviceProviderName: c.serviceProviderContactId
      ? byId[String(c.serviceProviderContactId)] || ''
      : '',
  }));
}

const kycUpload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => {
      try {
        fs.mkdirSync(contactUploadRoot, { recursive: true });
        cb(null, contactUploadRoot);
      } catch (err) {
        cb(err);
      }
    },
    filename: (_req, file, cb) => {
      const safe = String(file.originalname || 'document').replace(/[^\w.\-]+/g, '_');
      cb(null, `${Date.now()}-${safe}`);
    },
  }),
  limits: { fileSize: CONTACT_KYC_MAX_BYTES },
  fileFilter: (_req, file, cb) => {
    const allowed = isAllowedContactKycFile({
      mimetype: file.mimetype,
      originalname: file.originalname,
    });
    cb(allowed ? null : new Error(CONTACT_KYC_REJECT_MESSAGE), allowed);
  },
});

const KYC_DOC_TYPES = {
  passbook: 'passbookCopyUrl',
  pan_card: 'panCardCopyUrl',
};

function sheetRows(buffer) {
  return parseSheetRows(buffer);
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
    res.json({
      data: {
        contactCategories: CONTACT_CATEGORIES,
        resourceTypes: RESOURCE_TYPES,
        hcwResourceTypes: HCW_RESOURCE_TYPES,
        professions: PROFESSIONS,
        clientProfessions: CLIENT_PROFESSIONS,
        vendorProfessions: VENDOR_PROFESSIONS,
        supplyCategories: SUPPLY_CATEGORIES,
      },
    });
  })
);

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const isHcwDirectory = String(req.query.contactCategory || '').trim() === 'Healthcare Worker';
    const { page, limit, skip, sort } = parsePagination(req.query, {
      // Assignment needs the full HCW directory; default list pages stay capped at 200.
      maxLimit: isHcwDirectory ? 2000 : 200,
    });
    const filter = { isDeleted: false };
    if (req.query.q) {
      const q = escapeRegex(String(req.query.q));
      filter.$or = [
        { name: new RegExp(q, 'i') },
        { email: new RegExp(q, 'i') },
        { contact: new RegExp(q, 'i') },
        { mobile: new RegExp(q, 'i') },
        { resourceType: new RegExp(q, 'i') },
        { contactCategory: new RegExp(q, 'i') },
        { organization: new RegExp(q, 'i') },
        { supplyCategory: new RegExp(q, 'i') },
        { profession: new RegExp(q, 'i') },
        { panNumber: new RegExp(q, 'i') },
        { bankName: new RegExp(q, 'i') },
        { ifscCode: new RegExp(q, 'i') },
        { city: new RegExp(q, 'i') },
        { state: new RegExp(q, 'i') },
        { pinCode: new RegExp(q, 'i') },
        { address: new RegExp(q, 'i') },
      ];
    }
    if (req.query.state) {
      const state = String(req.query.state).trim();
      if (state) {
        filter.state = new RegExp(`^${state.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i');
      }
    }
    if (req.query.stateId) {
      filter.stateId = String(req.query.stateId);
    }
    if (req.query.contactCategory) {
      filter.contactCategory = String(req.query.contactCategory).trim();
    }
    if (req.query.resourceType) {
      filter.resourceType = String(req.query.resourceType).trim();
    }
    if (req.query.serviceProviderContactId) {
      filter.serviceProviderContactId = String(req.query.serviceProviderContactId).trim();
    }
    const [rawData, total] = await Promise.all([
      Contact.find(filter).sort(sort || 'name').skip(skip).limit(limit),
      Contact.countDocuments(filter),
    ]);
    const data = await enrichContactsWithProviders(rawData);
    res.json(paginated(data, total, page, limit));
  })
);

router.get(
  '/export',
  asyncHandler(async (_req, res) => {
    const rows = await Contact.find({ isDeleted: false }).sort('name');
    const enriched = await enrichContactsWithProviders(rows);
    sendExcel(
      res,
      'Contact_Directory.xlsx',
      CONTACT_HEADERS,
      enriched.map((c) => [
        c.name,
        c.email,
        c.contactCategory,
        c.resourceType,
        c.profession,
        c.organization,
        c.supplyCategory,
        c.contact || c.mobile,
        c.city,
        c.state,
        c.address,
        c.pinCode,
        c.panNumber,
        c.ifscCode,
        c.bankName,
        c.accountNumber,
        c.serviceProviderName || '',
      ]),
      { sheetName: 'Contacts' }
    );
  })
);

router.get(
  '/sample',
  asyncHandler(async (_req, res) => {
    sendCsv(
      res,
      sampleCsvFilename('Contact_Directory'),
      CONTACT_HEADERS,
      CONTACT_SAMPLE_ROWS
    );
  })
);

router.get(
  '/:id/staff',
  asyncHandler(async (req, res) => {
    const provider = await Contact.findOne({ _id: req.params.id, isDeleted: false });
    if (!provider) throw new AppError('Contact not found', 404);
    if (!isServiceProviderContact(provider)) {
      throw new AppError('Contact is not a Service Provider', 400, 'VALIDATION_ERROR');
    }
    const staff = await Contact.find({
      isDeleted: false,
      contactCategory: 'Healthcare Worker',
      serviceProviderContactId: provider._id,
    }).sort('name');
    res.json({
      data: staff.map((row) => withSignedContactKyc(row)),
      meta: {
        count: staff.length,
        employeeCount: (provider.providerEmployees || []).length,
        providerId: provider._id,
        providerEmployees: provider.providerEmployees || [],
      },
    });
  })
);

router.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const contact = await Contact.findOne({ _id: req.params.id, isDeleted: false });
    if (!contact) throw new AppError('Contact not found', 404);
    const [enriched] = await enrichContactsWithProviders([contact]);
    res.json({ data: enriched });
  })
);

router.post(
  '/',
  requirePermission(PERMISSIONS.AGREEMENTS_WRITE),
  asyncHandler(async (req, res) => {
    const payload = normalizeContactPayload(req.body, { validate: true });
    await validateServiceProviderLink(payload);
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
      return res.status(201).json({ data: withSignedContactKyc(contact) });
    }

    res.status(200).json({ data: withSignedContactKyc(contact), meta: { reused: Boolean(reused) } });
  })
);

router.patch(
  '/:id',
  requirePermission(PERMISSIONS.AGREEMENTS_WRITE),
  asyncHandler(async (req, res) => {
    const contact = await Contact.findOne({ _id: req.params.id, isDeleted: false });
    if (!contact) throw new AppError('Contact not found', 404);
    const payload = normalizeContactPayload(
      {
        name: req.body.name !== undefined ? req.body.name : contact.name,
        email: req.body.email !== undefined ? req.body.email : contact.email,
        contactCategory:
          req.body.contactCategory !== undefined ? req.body.contactCategory : contact.contactCategory,
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
        supplyCategory:
          req.body.supplyCategory !== undefined ? req.body.supplyCategory : contact.supplyCategory,
        panNumber: req.body.panNumber !== undefined ? req.body.panNumber : contact.panNumber,
        ifscCode: req.body.ifscCode !== undefined ? req.body.ifscCode : contact.ifscCode,
        bankName: req.body.bankName !== undefined ? req.body.bankName : contact.bankName,
        accountNumber:
          req.body.accountNumber !== undefined ? req.body.accountNumber : contact.accountNumber,
        passbookCopyUrl:
          req.body.passbookCopyUrl !== undefined ? req.body.passbookCopyUrl : contact.passbookCopyUrl,
        panCardCopyUrl:
          req.body.panCardCopyUrl !== undefined ? req.body.panCardCopyUrl : contact.panCardCopyUrl,
        notes: req.body.notes !== undefined ? req.body.notes : contact.notes,
        stateId: req.body.stateId !== undefined ? req.body.stateId : contact.stateId,
        districtId: req.body.districtId !== undefined ? req.body.districtId : contact.districtId,
        cityId: req.body.cityId !== undefined ? req.body.cityId : contact.cityId,
        serviceProviderContactId:
          req.body.serviceProviderContactId !== undefined
            ? req.body.serviceProviderContactId
            : contact.serviceProviderContactId,
        providerEmployees:
          req.body.providerEmployees !== undefined
            ? req.body.providerEmployees
            : contact.providerEmployees,
      },
      { validate: true }
    );
    await validateServiceProviderLink(payload, contact._id);
    await assertContactIdentityAvailable({
      email: payload.email,
      phone: payload.contact,
      excludeId: contact._id,
    });
    assignPreservingExisting(contact, payload);
    contact.updatedBy = req.user._id;
    await contact.save();
    res.json({ data: withSignedContactKyc(contact) });
  })
);

router.post(
  '/:id/kyc-document',
  requirePermission(PERMISSIONS.AGREEMENTS_WRITE),
  kycUpload.single('file'),
  requireSafeUploads({ allowedExt: CONTACT_KYC_ACCEPT_EXTENSIONS }),
  asyncHandler(async (req, res) => {
    const docType = String(req.body?.docType || '').trim();
    const field = KYC_DOC_TYPES[docType];
    if (!field) {
      throw new AppError('docType must be passbook or pan_card', 400, 'VALIDATION_ERROR');
    }
    if (!req.file) throw new AppError('Select a file to upload', 400, 'VALIDATION_ERROR');

    const contact = await Contact.findOne({ _id: req.params.id, isDeleted: false });
    if (!contact) throw new AppError('Contact not found', 404, 'NOT_FOUND');
    if (contact.contactCategory === 'Client') {
      throw new AppError('KYC documents are not applicable for Client contacts', 400, 'VALIDATION_ERROR');
    }

    const before = contact.toObject();
    contact[field] = `/uploads/contacts/${req.file.filename}`;
    contact.updatedBy = req.user._id;
    await contact.save();

    await writeAudit({
      actorId: req.user._id,
      actorEmail: req.user.email,
      action: 'CONTACT.KYC_UPLOAD',
      entityType: 'Contact',
      entityId: contact._id,
      before,
      after: contact.toObject(),
      requestId: req.requestId,
    });

    res.json({ data: withSignedContactKyc(contact) });
  })
);

router.post(
  '/import',
  requirePermission(PERMISSIONS.AGREEMENTS_WRITE),
  importRateLimiter,
  excelUpload.single('file'),
  asyncHandler(async (req, res) => {
    const mode = req.body.mode === 'DRY_RUN' ? 'DRY_RUN' : 'COMMIT';
    const { rows, fileName } = await loadCappedRowsFromUpload(req.file);
    const errors = [];
    let created = 0;
    let updated = 0;
    let skipped = 0;
    const seenEmails = new Set();
    const seenPhones = new Set();

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const rowNum = i + 2;
      let payload;
      try {
        payload = normalizeContactPayload(
          {
            name: cell(row, ['Name', 'name']),
            email: cell(row, ['Email', 'email']),
            contactCategory: cell(row, [
              'Contact Category',
              'ContactCategory',
              'contactCategory',
              'Category',
            ]),
            resourceType: cell(row, ['Resource Type', 'ResourceType', 'resourceType']),
            profession: cell(row, ['Profession / Role', 'Profession', 'profession']),
            organization: cell(row, [
              'Organization Name',
              'Organization',
              'organization',
              'Org',
            ]),
            supplyCategory: cell(row, [
              'Supply Category',
              'SupplyCategory',
              'supplyCategory',
            ]),
            contact: cell(row, ['Contact', 'contact', 'Mobile', 'Phone']),
            city: cell(row, ['City', 'city']),
            state: cell(row, ['State', 'state']),
            address: cell(row, ['Address', 'address']),
            pinCode: cell(row, ['PIN Code', 'Pin Code', 'pinCode', 'PIN']),
            panNumber: cell(row, ['PAN Number', 'PAN', 'panNumber']),
            ifscCode: cell(row, ['IFSC Code', 'IFSC', 'ifscCode']),
            bankName: cell(row, ['Bank Name', 'bankName']),
            accountNumber: cell(row, ['Account Number', 'accountNumber', 'Account']),
            serviceProvider: cell(row, [
              'Service Provider (agency)',
              'Service Provider',
              'serviceProvider',
              'ServiceProvider',
            ]),
          },
          { validate: true }
        );
        const spName = cell(row, [
          'Service Provider (agency)',
          'Service Provider',
          'serviceProvider',
          'ServiceProvider',
        ]);
        if (spName && payload.contactCategory === 'Healthcare Worker') {
          const provider = await Contact.findOne({
            isDeleted: false,
            contactCategory: 'Healthcare Worker',
            resourceType: 'Service Provider',
            name: new RegExp(`^${spName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i'),
          });
          if (!provider) {
            errors.push({
              row: rowNum,
              field: 'Service Provider',
              message: `Service provider not found: ${spName}`,
            });
            continue;
          }
          payload.serviceProviderContactId = provider._id;
        }
        await validateServiceProviderLink(payload);
      } catch (err) {
        errors.push({ row: rowNum, field: 'import', message: err.message });
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
            assignPreservingExisting(existing, payload);
            existing.updatedBy = req.user._id;
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
      rows[i] = null;
    }

    if (mode === 'COMMIT') {
      await writeAudit({
        actorId: req.user._id,
        actorEmail: req.user.email,
        action: 'CONTACT.IMPORT',
        entityType: 'Contact',
        after: { created, updated, errors: errors.length, fileName },
        requestId: req.requestId,
      });
    }

    let errorReport = null;
    if (errors.length) {
      errorReport = await notifyImportFailures({
        userId: req.user._id,
        importType: `CONTACT_${mode}`,
        sourceFileName: fileName,
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

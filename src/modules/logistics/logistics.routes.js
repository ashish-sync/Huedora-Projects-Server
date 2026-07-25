import { Router } from 'express';
import path from 'path';
import fs from 'fs';
import multer from 'multer';
import { fileURLToPath } from 'url';
import { authenticate, requirePermission, requireAdmin } from '../../middleware/auth.js';
import { asyncHandler, parsePagination, paginated, AppError } from '../../utils/helpers.js';
import { PERMISSIONS } from '../../config/constants.js';
import { writeAudit } from '../../utils/audit.js';
import { env } from '../../config/env.js';
import { throwIfIdentityClash } from '../../utils/identityNormalize.js';
import { nextSequence } from '../../utils/counters.js';
import { AssetRequest } from '../assetRequests/assetRequest.model.js';
import {
  LOCATION_LEVELS,
  IN_OUT_ENTRY_TYPES,
  IN_OUT_ENTRY_TYPE_ALIASES,
  IN_OUT_DEFAULT_PROCESS,
  IN_OUT_PROCESSES,
  IN_OUT_STATUSES,
  IN_OUT_MODES,
  IN_OUT_TRACKING_TYPES,
  IN_OUT_PRODUCT_TYPES,
  IN_OUT_PRODUCT_TYPE_ALIASES,
  PRODUCT_TYPE_CODE_PREFIX,
  PRODUCT_CODE_FORMAT,
  PRODUCT_INVENTORY_TYPES,
  PRODUCT_INVENTORY_TYPE_ALIASES,
  GST_RATE_PRESETS,
  PRODUCT_TRACKING_TYPE,
  PRODUCT_TRACKING_KINDS,
  PRODUCT_CATEGORY_DEFAULTS,
  PRODUCT_STATUS_OPTIONS,
  PRODUCT_REQUIRED_FIELDS,
  ENTRY_REQUIRED_FIELDS,
  DEFAULT_EXPENSE_CATEGORIES,
  ADJUSTMENT_TYPES,
  ADJUSTMENT_REASONS,
  DEVICE_CONDITIONS,
  INSPECTION_STATUSES,
  DOCUMENT_TYPES,
  DELIVERY_MODES,
  DELIVERY_MODE_ALIASES,
  COURIER_DELIVERY_MODES,
  DEFAULT_WAREHOUSE_NAME,
  requiresShortExpiryApproval,
  SHORT_EXPIRY_APPROVAL_MONTHS,
  OUTWARD_DISPATCH_STATUSES,
  OUTWARD_OPEN_DISPATCH_STATUS,
  OUTWARD_TERMINAL_DISPATCH_STATUSES,
  OUTWARD_DELIVERY_OUTCOMES,
} from './logistics.constants.js';
import {
  LogisticsWarehouse,
  LogisticsLocation,
  LogisticsSupplier,
  LogisticsTransporter,
  LogisticsCategory,
  LogisticsProduct,
  LogisticsUom,
  LogisticsStockStatus,
  LogisticsMovementType,
  LogisticsReasonCode,
  LogisticsExpenseCategory,
  LogisticsStockItem,
  LogisticsLedgerEntry,
  LogisticsInOutEntry,
  LogisticsUsageEntry,
} from './logistics.model.js';
import { buildDashboard } from './logistics.dashboard.js';
import { listUsageMerged, syncUsageFromCamps } from './logistics.usage.js';
import { attachMasterExcelRoutes } from '../../utils/masterExcel.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const inwardUploadRoot = path.resolve(__dirname, '../../../uploads/logistics');
fs.mkdirSync(inwardUploadRoot, { recursive: true });

const inwardUpload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, inwardUploadRoot),
    filename: (_req, file, cb) => {
      const safe = String(file.originalname || 'file')
        .replace(/[^a-zA-Z0-9._-]/g, '_')
        .slice(0, 80);
      cb(null, `${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${safe}`);
    },
  }),
  limits: { fileSize: env.uploadMaxBytes },
});

const productUploadRoot = path.resolve(__dirname, '../../../uploads/logistics/products');
fs.mkdirSync(productUploadRoot, { recursive: true });

const productUpload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, productUploadRoot),
    filename: (_req, file, cb) => {
      const safe = String(file.originalname || 'file')
        .replace(/[^a-zA-Z0-9._-]/g, '_')
        .slice(0, 80);
      cb(null, `${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${safe}`);
    },
  }),
  limits: { fileSize: env.uploadMaxBytes },
});

const productFiles = productUpload.fields([
  { name: 'file', maxCount: 1 },
  { name: 'images', maxCount: 8 },
]);

const inwardFiles = inwardUpload.fields([
  { name: 'productPhoto', maxCount: 1 },
  { name: 'invoiceDoc', maxCount: 1 },
  { name: 'docsExtra', maxCount: 5 },
]);

function fileRefFromMulter(file) {
  if (!file) return null;
  return {
    filename: file.filename,
    name: file.originalname,
    url: `/uploads/logistics/products/${file.filename}`,
    mimeType: file.mimetype,
  };
}

function asBool(v, fallback = false) {
  if (v === true || v === 'true' || v === 'yes' || v === '1') return true;
  if (v === false || v === 'false' || v === 'no' || v === '0') return false;
  if (v == null || v === '') return fallback;
  return Boolean(v);
}

function toNum(v, fallback = 0) {
  if (v === '' || v == null) return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function asIdList(v) {
  if (Array.isArray(v)) return v.map((x) => String(x || '').trim()).filter(Boolean);
  if (typeof v === 'string' && v.trim()) {
    try {
      const parsed = JSON.parse(v);
      if (Array.isArray(parsed)) return asIdList(parsed);
    } catch {
      /* ignore */
    }
    return v
      .split(',')
      .map((x) => x.trim())
      .filter(Boolean);
  }
  return [];
}

function asFileRef(v) {
  if (!v || typeof v !== 'object') return null;
  const url = trimStr(v.url);
  if (!url) return null;
  return {
    filename: trimStr(v.filename),
    name: trimStr(v.name) || trimStr(v.filename),
    url,
    mimeType: trimStr(v.mimeType),
  };
}

function attachmentsFromUpload(req, existing = null) {
  const productPhotoFile = req.files?.productPhoto?.[0];
  const invoiceDocFile = req.files?.invoiceDoc?.[0];
  const extras = req.files?.docsExtra || [];

  const productPhoto = productPhotoFile
    ? {
        filename: productPhotoFile.filename,
        name: productPhotoFile.originalname,
        url: `/uploads/logistics/${productPhotoFile.filename}`,
        mimeType: productPhotoFile.mimetype,
      }
    : existing?.productPhoto || null;

  const invoiceDoc = invoiceDocFile
    ? {
        filename: invoiceDocFile.filename,
        name: invoiceDocFile.originalname,
        url: `/uploads/logistics/${invoiceDocFile.filename}`,
        mimeType: invoiceDocFile.mimetype,
      }
    : existing?.invoiceDoc || null;

  const prevExtra = Array.isArray(existing?.attachments) ? existing.attachments : [];
  const attachments = [
    ...prevExtra,
    ...extras.map((f) => ({
      filename: f.filename,
      name: f.originalname,
      url: `/uploads/logistics/${f.filename}`,
      mimeType: f.mimetype,
      kind: 'ADDITIONAL',
    })),
  ];

  return { productPhoto, invoiceDoc, attachments };
}

const router = Router();
router.use(authenticate);

const canRead = requirePermission(PERMISSIONS.LOGISTICS_READ, PERMISSIONS.LOGISTICS_WRITE);
const canWrite = requirePermission(PERMISSIONS.LOGISTICS_WRITE, PERMISSIONS.LOGISTICS_MASTER);
const canMaster = requirePermission(PERMISSIONS.LOGISTICS_MASTER, PERMISSIONS.LOGISTICS_WRITE);

function trimStr(v) {
  return v == null ? '' : String(v).trim();
}

function registerMasterCrud({
  path,
  Model,
  entityType,
  searchFields = ['name', 'code'],
  required = ['name'],
  normalize,
  systemProtected = false,
  listFilter = null,
  checkIdentity = false,
  codePrefix,
  resolveCodePrefix = null,
  codeFormat = null,
  skuPrefix,
  uniqueFields = [],
  excel = null,
}) {
  async function assertUniqueFields(body, excludeId) {
    for (const field of uniqueFields) {
      const val = trimStr(body[field]);
      if (!val) continue;
      const clash = await Model.findOne({
        isDeleted: false,
        ...(listFilter || {}),
        ...(excludeId ? { _id: { $ne: excludeId } } : {}),
        [field]: new RegExp(`^${val.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i'),
      });
      if (clash) {
        throw new AppError(`${field} “${val}” already exists`, 400, 'DUPLICATE');
      }
    }
  }
  async function assertPartyIdentity(body, excludeId) {
    if (!checkIdentity) return;
    if (!body.email && !body.phone) return;
    const rows = await Model.find({ isDeleted: false, ...(listFilter || {}) }).limit(20000);
    throwIfIdentityClash(rows, {
      email: body.email,
      phone: body.phone,
      excludeId,
      emailFields: ['email'],
      phoneFields: ['phone'],
      label: entityType.replace(/^Logistics/, '') || 'Record',
    });
  }

  router.get(
    `/${path}`,
    canRead,
    asyncHandler(async (req, res) => {
      const { page, limit, skip, sort } = parsePagination(req.query);
      const filter = { isDeleted: false, ...(listFilter || {}) };
      if (req.query.warehouseId) filter.warehouseId = req.query.warehouseId;
      if (req.query.parentId === 'null') filter.parentId = null;
      else if (req.query.parentId) filter.parentId = req.query.parentId;
      if (req.query.level) filter.level = req.query.level;
      if (req.query.productType) {
        const want = resolveProductType(req.query.productType) || String(req.query.productType);
        const aliases = Object.entries(IN_OUT_PRODUCT_TYPE_ALIASES)
          .filter(([, v]) => v === want)
          .map(([k]) => k);
        filter.productType = { $in: [...new Set([want, String(req.query.productType), ...aliases])] };
      }
      if (req.query.isActive === 'true') filter.isActive = true;
      if (req.query.isActive === 'false') filter.isActive = false;
      if (req.query.q) {
        const re = new RegExp(String(req.query.q), 'i');
        filter.$or = searchFields.map((f) => ({ [f]: re }));
      }
      const [data, total] = await Promise.all([
        Model.find(filter).sort(sort || 'name').skip(skip).limit(limit),
        Model.countDocuments(filter),
      ]);
      res.json(paginated(data, total, page, limit));
    })
  );

  router.post(
    `/${path}`,
    canMaster,
    asyncHandler(async (req, res) => {
      const body = normalize ? normalize(req.body) : { ...req.body };
      for (const key of required) {
        if (!trimStr(body[key])) {
          throw new AppError(`${key} is required`, 400, 'VALIDATION_ERROR');
        }
      }
      const prefix =
        (typeof resolveCodePrefix === 'function' ? resolveCodePrefix(body) : null) || codePrefix;
      if (prefix) {
        let allocated = '';
        for (let attempt = 0; attempt < 8; attempt += 1) {
          allocated = await nextSequence(`logistics.${path}.${prefix}`, prefix, codeFormat || undefined);
          const clash = await Model.findOne({
            code: allocated,
            isDeleted: false,
            ...(listFilter || {}),
          });
          if (!clash) break;
          allocated = '';
        }
        if (!allocated) {
          throw new AppError('Could not allocate a unique code', 500, 'CODE_ALLOCATION');
        }
        body.code = allocated;
      } else if (body.code) {
        body.code = trimStr(body.code).toUpperCase();
        const clash = await Model.findOne({ code: body.code, isDeleted: false });
        if (clash) throw new AppError(`Code “${body.code}” already exists`, 400, 'DUPLICATE');
      }
      if (skuPrefix) {
        let allocatedSku = '';
        for (let attempt = 0; attempt < 8; attempt += 1) {
          allocatedSku = await nextSequence(`logistics.${path}.sku`, skuPrefix);
          const clash = await Model.findOne({
            sku: allocatedSku,
            isDeleted: false,
            ...(listFilter || {}),
          });
          if (!clash) break;
          allocatedSku = '';
        }
        if (!allocatedSku) {
          throw new AppError('Could not allocate a unique SKU', 500, 'SKU_ALLOCATION');
        }
        body.sku = allocatedSku;
      }
      await assertPartyIdentity(body);
      await assertUniqueFields(body);
      const row = await Model.create({ ...body, isActive: body.isActive !== false });
      await writeAudit({
        actorId: req.user._id,
        actorEmail: req.user.email,
        action: `${entityType}.CREATE`,
        entityType,
        entityId: row._id,
        after: row.toObject ? row.toObject() : row,
        requestId: req.requestId,
      });
      res.status(201).json({ data: row });
    })
  );

  router.patch(
    `/${path}/:id`,
    canMaster,
    asyncHandler(async (req, res) => {
      const row = await Model.findOne({ _id: req.params.id, isDeleted: false });
      if (!row) throw new AppError('Record not found', 404);
      if (systemProtected && row.isSystem && req.body.code && req.body.code !== row.code) {
        throw new AppError('System codes cannot be changed', 400, 'LOCKED');
      }
      const body = normalize ? normalize(req.body, row) : { ...req.body };
      // Codes and SKUs are assigned on create and stay fixed.
      delete body.code;
      delete body.sku;
      await assertPartyIdentity(
        {
          email: body.email !== undefined ? body.email : row.email,
          phone: body.phone !== undefined ? body.phone : row.phone,
        },
        row._id
      );
      await assertUniqueFields(body, row._id);
      Object.assign(row, body);
      row.updatedBy = req.user._id;
      await row.save();
      await writeAudit({
        actorId: req.user._id,
        actorEmail: req.user.email,
        action: `${entityType}.UPDATE`,
        entityType,
        entityId: row._id,
        after: row.toObject ? row.toObject() : row,
        requestId: req.requestId,
      });
      res.json({ data: row });
    })
  );

  router.delete(
    `/${path}/:id`,
    requireAdmin,
    asyncHandler(async (req, res) => {
      const row = await Model.findOne({ _id: req.params.id, isDeleted: false });
      if (!row) throw new AppError('Record not found', 404);
      if (systemProtected && row.isSystem) {
        throw new AppError('System records cannot be deleted', 400, 'LOCKED');
      }
      row.isDeleted = true;
      row.isActive = false;
      await row.save();
      await writeAudit({
        actorId: req.user._id,
        actorEmail: req.user.email,
        action: `${entityType}.DELETE`,
        entityType,
        entityId: row._id,
        requestId: req.requestId,
      });
      res.json({ data: { ok: true } });
    })
  );

  if (excel) {
    async function allocateImportCode(body) {
      const prefix =
        (typeof resolveCodePrefix === 'function' ? resolveCodePrefix(body) : null) || codePrefix;
      if (!prefix) return;
      let allocated = '';
      for (let attempt = 0; attempt < 8; attempt += 1) {
        allocated = await nextSequence(
          `logistics.${path}.${prefix}`,
          prefix,
          codeFormat || undefined
        );
        const clash = await Model.findOne({
          code: allocated,
          isDeleted: false,
          ...(listFilter || {}),
        });
        if (!clash) break;
        allocated = '';
      }
      if (!allocated) {
        throw new AppError('Could not allocate a unique code', 500, 'CODE_ALLOCATION');
      }
      body.code = allocated;
    }

    async function allocateImportSku(body) {
      if (!skuPrefix) return;
      let allocatedSku = '';
      for (let attempt = 0; attempt < 8; attempt += 1) {
        allocatedSku = await nextSequence(`logistics.${path}.sku`, skuPrefix);
        const clash = await Model.findOne({
          sku: allocatedSku,
          isDeleted: false,
          ...(listFilter || {}),
        });
        if (!clash) break;
        allocatedSku = '';
      }
      if (!allocatedSku) {
        throw new AppError('Could not allocate a unique SKU', 500, 'SKU_ALLOCATION');
      }
      body.sku = allocatedSku;
    }

    attachMasterExcelRoutes(router, {
      path,
      Model,
      listFilter,
      excel,
      canRead,
      canImport: canMaster,
      entityType,
      writeAudit,
      createFromImport: async (body) => {
        for (const key of required) {
          if (!trimStr(body[key])) {
            throw new AppError(`${key} is required`, 400, 'VALIDATION_ERROR');
          }
        }
        const normalized = normalize ? normalize(body) : { ...body };
        delete normalized.code;
        delete normalized.sku;
        await allocateImportCode(normalized);
        await allocateImportSku(normalized);
        await assertPartyIdentity(normalized);
        await assertUniqueFields(normalized);
        await Model.create({ ...normalized, isActive: normalized.isActive !== false });
        return { created: true };
      },
    });
  }
}

registerMasterCrud({
  path: 'warehouses',
  Model: LogisticsWarehouse,
  entityType: 'LogisticsWarehouse',
  codePrefix: 'WH',
  normalize: (b) => ({
    code: trimStr(b.code).toUpperCase(),
    name: trimStr(b.name),
    city: trimStr(b.city),
    state: trimStr(b.state),
    address: trimStr(b.address),
    isActive: b.isActive !== false,
  }),
});

registerMasterCrud({
  path: 'locations',
  Model: LogisticsLocation,
  entityType: 'LogisticsLocation',
  searchFields: ['name', 'code', 'level'],
  required: ['name', 'warehouseId', 'level'],
  codePrefix: 'LOC',
  normalize: (b) => {
    const level = trimStr(b.level);
    if (level && !LOCATION_LEVELS.includes(level)) {
      throw new AppError(
        `level must be one of: ${LOCATION_LEVELS.join(', ')}`,
        400,
        'VALIDATION_ERROR'
      );
    }
    return {
      warehouseId: b.warehouseId || null,
      parentId: b.parentId || null,
      level,
      code: trimStr(b.code).toUpperCase(),
      name: trimStr(b.name),
      isActive: b.isActive !== false,
    };
  },
});

registerMasterCrud({
  path: 'parties',
  Model: LogisticsSupplier,
  entityType: 'LogisticsParty',
  searchFields: ['name', 'code', 'email', 'phone', 'contactName', 'city', 'gstin', 'panCard', 'partyType'],
  checkIdentity: true,
  resolveCodePrefix: (body) => (trimStr(body.partyType) === 'Vendor' ? 'VEN' : 'SUP'),
  normalize: (b, existing) => {
    const partyType = trimStr(b.partyType ?? existing?.partyType) === 'Vendor' ? 'Vendor' : 'Supplier';
    return {
      code: trimStr(b.code ?? existing?.code).toUpperCase(),
      name: trimStr(b.name ?? existing?.name),
      partyType,
      contactId:
        b.contactId !== undefined ? b.contactId || null : existing?.contactId || null,
      contactName: trimStr(b.contactName ?? existing?.contactName ?? ''),
      email: trimStr(b.email ?? existing?.email ?? '').toLowerCase(),
      phone: trimStr(b.phone ?? existing?.phone ?? ''),
      city: trimStr(b.city ?? existing?.city ?? ''),
      state: trimStr(b.state ?? existing?.state ?? ''),
      gstin: trimStr(b.gstin ?? existing?.gstin ?? '').toUpperCase(),
      panCard: trimStr(b.panCard ?? existing?.panCard ?? '').toUpperCase(),
      isActive: b.isActive !== undefined ? b.isActive !== false : existing?.isActive !== false,
    };
  },
  excel: {
    filename: 'Suppliers_Vendors.xlsx',
    sheetName: 'Parties',
    headers: [
      'Type',
      'Name',
      'Contact Name',
      'Email',
      'Phone',
      'City',
      'State',
      'GSTIN',
      'PAN Card',
      'Active',
    ],
    rowFromDoc: (r) => [
      r.partyType || 'Supplier',
      r.name,
      r.contactName,
      r.email,
      r.phone,
      r.city,
      r.state,
      r.gstin,
      r.panCard,
      r.isActive === false ? 'No' : 'Yes',
    ],
    sampleRows: [
      [
        'Supplier',
        'Acme Medical Supplies',
        'Raj Patel',
        'raj@acme.example',
        '9876543210',
        'Mumbai',
        'Maharashtra',
        '27AAAAA0000A1Z5',
        'ABCDE1234F',
        'Yes',
      ],
      [
        'Vendor',
        'City Diagnostics',
        'Priya Shah',
        'vendor@citydiag.example',
        '9123456780',
        'Pune',
        'Maharashtra',
        '',
        '',
        'Yes',
      ],
    ],
    importColumns: [
      { labels: ['Type', 'Party Type'], field: 'partyType' },
      { labels: ['Name'], field: 'name', required: true },
      { labels: ['Contact Name', 'Contact'], field: 'contactName', optional: true },
      { labels: ['Email'], field: 'email', optional: true },
      { labels: ['Phone', 'Contact Number'], field: 'phone', optional: true },
      { labels: ['City'], field: 'city', optional: true },
      { labels: ['State'], field: 'state', optional: true },
      { labels: ['GSTIN'], field: 'gstin', optional: true },
      { labels: ['PAN Card', 'PAN'], field: 'panCard', optional: true },
      { labels: ['Active'], field: 'isActive', type: 'bool', defaultValue: true },
    ],
  },
});

registerMasterCrud({
  path: 'suppliers',
  Model: LogisticsSupplier,
  entityType: 'LogisticsSupplier',
  searchFields: ['name', 'code', 'email', 'phone', 'contactName', 'city', 'gstin', 'panCard'],
  listFilter: { partyType: 'Supplier' },
  checkIdentity: true,
  codePrefix: 'SUP',
  normalize: (b, existing) => ({
    code: trimStr(b.code ?? existing?.code).toUpperCase(),
    name: trimStr(b.name ?? existing?.name),
    partyType: 'Supplier',
    contactId: b.contactId !== undefined ? b.contactId || null : existing?.contactId || null,
    contactName: trimStr(b.contactName ?? existing?.contactName ?? ''),
    email: trimStr(b.email ?? existing?.email ?? '').toLowerCase(),
    phone: trimStr(b.phone ?? existing?.phone ?? ''),
    city: trimStr(b.city ?? existing?.city ?? ''),
    state: trimStr(b.state ?? existing?.state ?? ''),
    gstin: trimStr(b.gstin ?? existing?.gstin ?? '').toUpperCase(),
    panCard: trimStr(b.panCard ?? existing?.panCard ?? '').toUpperCase(),
    isActive: b.isActive !== undefined ? b.isActive !== false : existing?.isActive !== false,
  }),
});

registerMasterCrud({
  path: 'vendors',
  Model: LogisticsSupplier,
  entityType: 'LogisticsVendor',
  searchFields: ['name', 'code', 'email', 'phone', 'contactName', 'city', 'gstin', 'panCard'],
  listFilter: { partyType: 'Vendor' },
  checkIdentity: true,
  codePrefix: 'VEN',
  normalize: (b, existing) => ({
    code: trimStr(b.code ?? existing?.code).toUpperCase(),
    name: trimStr(b.name ?? existing?.name),
    partyType: 'Vendor',
    contactId: b.contactId !== undefined ? b.contactId || null : existing?.contactId || null,
    contactName: trimStr(b.contactName ?? existing?.contactName ?? ''),
    email: trimStr(b.email ?? existing?.email ?? '').toLowerCase(),
    phone: trimStr(b.phone ?? existing?.phone ?? ''),
    city: trimStr(b.city ?? existing?.city ?? ''),
    state: trimStr(b.state ?? existing?.state ?? ''),
    gstin: trimStr(b.gstin ?? existing?.gstin ?? '').toUpperCase(),
    panCard: trimStr(b.panCard ?? existing?.panCard ?? '').toUpperCase(),
    isActive: b.isActive !== undefined ? b.isActive !== false : existing?.isActive !== false,
  }),
});

registerMasterCrud({
  path: 'transporters',
  Model: LogisticsTransporter,
  entityType: 'LogisticsTransporter',
  searchFields: ['name', 'code', 'email', 'phone', 'contactName'],
  checkIdentity: true,
  codePrefix: 'TRN',
  normalize: (b) => ({
    code: trimStr(b.code).toUpperCase(),
    name: trimStr(b.name),
    contactName: trimStr(b.contactName),
    email: trimStr(b.email).toLowerCase(),
    phone: trimStr(b.phone),
    isActive: b.isActive !== false,
  }),
});

registerMasterCrud({
  path: 'categories',
  Model: LogisticsCategory,
  entityType: 'LogisticsCategory',
  codePrefix: 'CAT',
  normalize: (b) => ({
    code: trimStr(b.code).toUpperCase(),
    name: trimStr(b.name),
    description: trimStr(b.description),
    isActive: b.isActive !== false,
  }),
});

registerMasterCrud({
  path: 'products',
  Model: LogisticsProduct,
  entityType: 'LogisticsProduct',
  searchFields: [
    'name',
    'code',
    'sku',
    'brand',
    'manufacturer',
    'productType',
    'model',
    'partNumber',
    'programProject',
  ],
  required: ['name', 'productType', 'brand'],
  resolveCodePrefix: (body) =>
    PRODUCT_TYPE_CODE_PREFIX[body.productType] || PRODUCT_TYPE_CODE_PREFIX.Other || 'OT',
  codeFormat: PRODUCT_CODE_FORMAT,
  skuPrefix: 'SKU',
  uniqueFields: ['name'],
  normalize: (b, existing) => {
    const productType = resolveProductType(b.productType ?? existing?.productType) || 'Other';
    if (!IN_OUT_PRODUCT_TYPES.includes(productType)) {
      throw new AppError(
        `productType must be one of: ${IN_OUT_PRODUCT_TYPES.join(', ')}`,
        400,
        'VALIDATION_ERROR'
      );
    }
    const defaults = PRODUCT_CATEGORY_DEFAULTS[productType] || {
      expiryApplicable: false,
      trackingKind: 'None',
      inventoryType: 'Multi-use',
    };
    let trackingKind = trimStr(b.trackingKind ?? existing?.trackingKind) || defaults.trackingKind;
    if (!PRODUCT_TRACKING_KINDS.includes(trackingKind)) trackingKind = defaults.trackingKind;

    let inventoryType =
      resolveInventoryType(b.inventoryType ?? existing?.inventoryType) ||
      defaults.inventoryType ||
      'Multi-use';
    if (!PRODUCT_INVENTORY_TYPES.includes(inventoryType)) {
      inventoryType = defaults.inventoryType || 'Multi-use';
    }

    const needsLinkedDevice =
      inventoryType === 'Replacement Part for Asset' ||
      inventoryType === 'Accessory of Asset' ||
      inventoryType === 'Consumed by Device';
    const linkedDeviceId =
      b.linkedDeviceId !== undefined
        ? b.linkedDeviceId || null
        : existing?.linkedDeviceId || null;

    const expiryApplicable =
      b.expiryApplicable != null
        ? asBool(b.expiryApplicable, defaults.expiryApplicable)
        : existing?.expiryApplicable != null
          ? !!existing.expiryApplicable
          : defaults.expiryApplicable;

    const incomingDocs = b.documents && typeof b.documents === 'object' ? b.documents : {};
    const prevDocs = existing?.documents && typeof existing.documents === 'object' ? existing.documents : {};
    const documents = {
      datasheet:
        b.documents !== undefined ? asFileRef(incomingDocs.datasheet) : asFileRef(prevDocs.datasheet),
      userManual:
        b.documents !== undefined ? asFileRef(incomingDocs.userManual) : asFileRef(prevDocs.userManual),
      warranty:
        b.documents !== undefined ? asFileRef(incomingDocs.warranty) : asFileRef(prevDocs.warranty),
      compliance:
        b.documents !== undefined ? asFileRef(incomingDocs.compliance) : asFileRef(prevDocs.compliance),
      sop: b.documents !== undefined ? asFileRef(incomingDocs.sop) : asFileRef(prevDocs.sop),
      images:
        b.documents !== undefined
          ? (Array.isArray(incomingDocs.images) ? incomingDocs.images : [])
              .map(asFileRef)
              .filter(Boolean)
          : Array.isArray(prevDocs.images)
            ? prevDocs.images.map(asFileRef).filter(Boolean)
            : [],
    };

    const brand = trimStr(b.brand ?? existing?.brand);
    const manufacturer = trimStr(b.manufacturer ?? existing?.manufacturer) || brand;
    const modelOrPart = trimStr(
      b.model ?? b.partNumber ?? b.name ?? existing?.model ?? existing?.partNumber ?? existing?.name ?? ''
    );
    const standardCost = toNum(b.purchaseCost ?? b.standardCost ?? existing?.standardCost, 0);
    const legacyUnit = toNum(b.defaultPerUnitCost ?? existing?.defaultPerUnitCost, standardCost);
    const shelfLifeMonths = toNum(
      b.shelfLifeMonths ?? existing?.shelfLifeMonths,
      existing?.shelfLifeDays ? Math.round(Number(existing.shelfLifeDays) / 30) : 0
    );
    const shelfLifeDays =
      b.shelfLifeMonths != null
        ? Math.round(shelfLifeMonths * 30)
        : toNum(b.shelfLifeDays ?? existing?.shelfLifeDays, shelfLifeMonths * 30);

    const compatibleDeviceIds =
      b.compatibleDeviceIds !== undefined
        ? asIdList(b.compatibleDeviceIds)
        : Array.isArray(existing?.compatibleDeviceIds)
          ? [...existing.compatibleDeviceIds]
          : [];
    if (linkedDeviceId && !compatibleDeviceIds.map(String).includes(String(linkedDeviceId))) {
      compatibleDeviceIds.unshift(linkedDeviceId);
    }

    return {
      name: modelOrPart || trimStr(b.name ?? existing?.name),
      categoryId: b.categoryId !== undefined ? b.categoryId || null : existing?.categoryId || null,
      brand,
      manufacturer,
      description: trimStr(b.description ?? existing?.description ?? ''),
      image: b.image !== undefined ? asFileRef(b.image) : asFileRef(existing?.image),
      isActive: b.isActive !== undefined ? asBool(b.isActive, true) : existing?.isActive !== false,
      productType,
      inventoryType,
      trackingKind,
      uomId: b.uomId !== undefined ? b.uomId || null : existing?.uomId || null,
      unitsPerPack: Math.max(1, toNum(b.unitsPerPack ?? existing?.unitsPerPack, 1)),
      gstRate: toNum(b.gstRate ?? existing?.gstRate, 0),
      minStock: toNum(b.minStock ?? existing?.minStock, 0),
      maxStock: toNum(b.maxStock ?? existing?.maxStock, 0),
      reorderLevel: toNum(b.reorderLevel ?? existing?.reorderLevel, 0),
      shelfLifeMonths,
      shelfLifeDays,
      expiryApplicable: !!expiryApplicable,
      qcRequired: asBool(b.qcRequired ?? existing?.qcRequired, false),
      returnable: asBool(b.returnable ?? existing?.returnable, false),
      disposable: asBool(b.disposable ?? existing?.disposable, false),
      preferredSupplierId:
        b.preferredSupplierId !== undefined
          ? b.preferredSupplierId || null
          : existing?.preferredSupplierId || null,
      defaultVendorId:
        b.defaultVendorId !== undefined
          ? b.defaultVendorId || null
          : existing?.defaultVendorId || null,
      leadTimeDays: toNum(b.leadTimeDays ?? existing?.leadTimeDays, 0),
      standardCost,
      averageCost: toNum(b.averageCost ?? existing?.averageCost, 0),
      lastPurchaseCost: toNum(b.lastPurchaseCost ?? existing?.lastPurchaseCost, standardCost),
      linkedDeviceId: needsLinkedDevice ? linkedDeviceId : null,
      compatibleDeviceIds,
      compatibilityRelationship: trimStr(
        b.compatibilityRelationship ?? existing?.compatibilityRelationship ?? ''
      ),
      qtyPerDevice: toNum(b.qtyPerDevice ?? existing?.qtyPerDevice, 0),
      warrantyPeriodMonths: toNum(b.warrantyPeriodMonths ?? existing?.warrantyPeriodMonths, 0),
      amc: asBool(b.amc ?? existing?.amc, false),
      calibrationRequired: asBool(b.calibrationRequired ?? existing?.calibrationRequired, false),
      calibrationFrequency: trimStr(
        b.calibrationFrequency ?? existing?.calibrationFrequency ?? ''
      ),
      pmFrequency: trimStr(b.pmFrequency ?? existing?.pmFrequency ?? ''),
      storageTemperature: trimStr(b.storageTemperature ?? existing?.storageTemperature ?? ''),
      storageCondition: trimStr(b.storageCondition ?? existing?.storageCondition ?? ''),
      hazardous: asBool(b.hazardous ?? existing?.hazardous, false),
      fragile: asBool(b.fragile ?? existing?.fragile, false),
      coldChainRequired: asBool(b.coldChainRequired ?? existing?.coldChainRequired, false),
      documents,
      internalRemarks: trimStr(b.internalRemarks ?? existing?.internalRemarks ?? ''),
      programProject: trimStr(b.programProject ?? existing?.programProject ?? ''),
      model: modelOrPart,
      partNumber: modelOrPart,
      defaultPerUnitCost: legacyUnit,
      defaultInvoiceAmount: toNum(
        b.defaultInvoiceAmount ?? existing?.defaultInvoiceAmount,
        0
      ),
    };
  },
  excel: {
    filename: 'Products.xlsx',
    sheetName: 'Products',
    headers: [
      'Code',
      'SKU',
      'Name',
      'Product Type',
      'Brand',
      'Manufacturer',
      'Model',
      'Program / Project',
      'Inventory Type',
      'Expiry Applicable',
      'GST Rate',
      'Active',
    ],
    rowFromDoc: (r) => [
      r.code,
      r.sku,
      r.name,
      r.productType,
      r.brand,
      r.manufacturer,
      r.model || r.partNumber,
      r.programProject,
      r.inventoryType,
      r.expiryApplicable ? 'Yes' : 'No',
      r.gstRate,
      r.isActive === false ? 'No' : 'Yes',
    ],
    sampleRows: [
      [
        '',
        '',
        'Ultrasound Gel 250ml',
        'Consumable',
        'MediGel',
        'MediGel',
        'GEL-250',
        'Camp One',
        'Consumed by Device',
        'Yes',
        12,
        'Yes',
      ],
      [
        '',
        '',
        'BP Cuff Large',
        'Accessory',
        'CarePlus',
        'CarePlus',
        'BP-L',
        '',
        'Accessory of Asset',
        'No',
        18,
        'Yes',
      ],
    ],
    importColumns: [
      { labels: ['Name', 'Model', 'Model/Variant/Name'], field: 'name', required: true },
      { labels: ['Product Type', 'Type'], field: 'productType', required: true },
      { labels: ['Brand'], field: 'brand', required: true },
      { labels: ['Manufacturer'], field: 'manufacturer', optional: true },
      { labels: ['Model', 'Part Number'], field: 'model', optional: true },
      { labels: ['Program / Project', 'Program'], field: 'programProject', optional: true },
      { labels: ['Inventory Type'], field: 'inventoryType', optional: true },
      { labels: ['Expiry Applicable'], field: 'expiryApplicable', type: 'bool', defaultValue: false },
      { labels: ['GST Rate', 'GST'], field: 'gstRate', type: 'number', defaultValue: 0 },
      { labels: ['Active'], field: 'isActive', type: 'bool', defaultValue: true },
    ],
  },
});

router.post(
  '/products/:id/files',
  canMaster,
  productFiles,
  asyncHandler(async (req, res) => {
    const row = await LogisticsProduct.findOne({ _id: req.params.id, isDeleted: false });
    if (!row) throw new AppError('Product not found', 404);
    const slot = trimStr(req.body.slot || 'image');
    const docs = row.documents && typeof row.documents === 'object' ? { ...row.documents } : {};
    if (!Array.isArray(docs.images)) docs.images = [];

    const single = fileRefFromMulter(req.files?.file?.[0]);
    const extras = (req.files?.images || []).map(fileRefFromMulter).filter(Boolean);

    if (slot === 'image') {
      if (!single) throw new AppError('file is required', 400, 'VALIDATION_ERROR');
      row.image = single;
    } else if (slot === 'images') {
      if (!extras.length && !single) {
        throw new AppError('images are required', 400, 'VALIDATION_ERROR');
      }
      docs.images = [...docs.images, ...(extras.length ? extras : [single])];
      row.documents = docs;
    } else if (['datasheet', 'userManual', 'warranty', 'compliance', 'sop'].includes(slot)) {
      if (!single) throw new AppError('file is required', 400, 'VALIDATION_ERROR');
      docs[slot] = single;
      row.documents = docs;
    } else {
      throw new AppError(`Unknown file slot: ${slot}`, 400, 'VALIDATION_ERROR');
    }

    row.updatedBy = req.user._id;
    await row.save();
    await writeAudit({
      actorId: req.user._id,
      actorEmail: req.user.email,
      action: 'LogisticsProduct.FILE_UPLOAD',
      entityType: 'LogisticsProduct',
      entityId: row._id,
      after: row.toObject ? row.toObject() : row,
      requestId: req.requestId,
    });
    res.json({ data: row });
  })
);

registerMasterCrud({
  path: 'uoms',
  Model: LogisticsUom,
  entityType: 'LogisticsUom',
  codePrefix: 'UOM',
  normalize: (b) => ({
    code: trimStr(b.code).toUpperCase(),
    name: trimStr(b.name),
    isActive: b.isActive !== false,
  }),
});

registerMasterCrud({
  path: 'stock-statuses',
  Model: LogisticsStockStatus,
  entityType: 'LogisticsStockStatus',
  systemProtected: true,
  codePrefix: 'STS',
  normalize: (b) => ({
    code: trimStr(b.code).toUpperCase().replace(/\s+/g, '_'),
    name: trimStr(b.name),
    isActive: b.isActive !== false,
  }),
});

registerMasterCrud({
  path: 'movement-types',
  Model: LogisticsMovementType,
  entityType: 'LogisticsMovementType',
  systemProtected: true,
  codePrefix: 'MVT',
  normalize: (b) => ({
    code: trimStr(b.code).toUpperCase(),
    name: trimStr(b.name),
    direction: String(b.direction || 'IN').toUpperCase() === 'OUT' ? 'OUT' : 'IN',
    isActive: b.isActive !== false,
  }),
});

registerMasterCrud({
  path: 'reason-codes',
  Model: LogisticsReasonCode,
  entityType: 'LogisticsReasonCode',
  systemProtected: true,
  codePrefix: 'RSN',
  normalize: (b) => ({
    code: trimStr(b.code).toUpperCase(),
    name: trimStr(b.name),
    isActive: b.isActive !== false,
  }),
});

registerMasterCrud({
  path: 'expense-categories',
  Model: LogisticsExpenseCategory,
  entityType: 'LogisticsExpenseCategory',
  searchFields: ['name', 'code', 'covers'],
  codePrefix: 'EXP',
  normalize: (b) => ({
    code: trimStr(b.code).toUpperCase().replace(/\s+/g, '_'),
    name: trimStr(b.name),
    covers: trimStr(b.covers),
    isActive: b.isActive !== false,
  }),
  excel: {
    filename: 'Expense_Categories.xlsx',
    sheetName: 'Expense Categories',
    headers: ['Name', 'Covers', 'Active'],
    rowFromDoc: (r) => [r.name, r.covers, r.isActive === false ? 'No' : 'Yes'],
    sampleRows: [
      ['Travel', 'Employee travel and conveyance', 'Yes'],
      ['Meals', 'Team meals during camps', 'Yes'],
    ],
    importColumns: [
      { labels: ['Name'], field: 'name', required: true },
      { labels: ['Covers', 'Description'], field: 'covers', optional: true },
      { labels: ['Active'], field: 'isActive', type: 'bool', defaultValue: true },
    ],
  },
});

router.get(
  '/meta',
  canRead,
  asyncHandler(async (_req, res) => {
    const [warehouses, categories, uoms, statuses, movementTypes, reasonCodes, expenseCategories, products, parties, transporters] =
      await Promise.all([
        LogisticsWarehouse.find({ isDeleted: false, isActive: true }).sort('name'),
        LogisticsCategory.find({ isDeleted: false, isActive: true }).sort('name'),
        LogisticsUom.find({ isDeleted: false, isActive: true }).sort('name'),
        LogisticsStockStatus.find({ isDeleted: false, isActive: true }).sort('name'),
        LogisticsMovementType.find({ isDeleted: false, isActive: true }).sort('name'),
        LogisticsReasonCode.find({ isDeleted: false, isActive: true }).sort('name'),
        LogisticsExpenseCategory.find({ isDeleted: false, isActive: true }).sort('name'),
        LogisticsProduct.find({ isDeleted: false, isActive: true }).sort('name'),
        LogisticsSupplier.find({ isDeleted: false, isActive: true }).sort('name'),
        LogisticsTransporter.find({ isDeleted: false, isActive: true }).sort('name'),
      ]);
    const suppliers = parties.filter((p) => p.partyType !== 'Vendor');
    const vendors = parties.filter((p) => p.partyType === 'Vendor');
    const expenseOrder = new Map(
      DEFAULT_EXPENSE_CATEGORIES.map((c, i) => [c.name.toLowerCase(), i])
    );
    expenseCategories.sort((a, b) => {
      const ai = expenseOrder.has(String(a.name || '').toLowerCase())
        ? expenseOrder.get(String(a.name || '').toLowerCase())
        : 999;
      const bi = expenseOrder.has(String(b.name || '').toLowerCase())
        ? expenseOrder.get(String(b.name || '').toLowerCase())
        : 999;
      if (ai !== bi) return ai - bi;
      return String(a.name || '').localeCompare(String(b.name || ''));
    });
    res.json({
      data: {
        locationLevels: LOCATION_LEVELS,
        warehouses,
        categories,
        uoms,
        statuses,
        movementTypes,
        reasonCodes,
        expenseCategories,
        products,
        suppliers,
        vendors,
        transporters,
        inOut: {
          entryTypes: IN_OUT_ENTRY_TYPES,
          productTypes: IN_OUT_PRODUCT_TYPES,
          inventoryTypes: PRODUCT_INVENTORY_TYPES,
          gstRatePresets: GST_RATE_PRESETS,
          trackingByProduct: PRODUCT_TRACKING_TYPE,
          categoryDefaults: PRODUCT_CATEGORY_DEFAULTS,
          trackingKinds: PRODUCT_TRACKING_KINDS,
          statusByProduct: PRODUCT_STATUS_OPTIONS,
          productRequired: PRODUCT_REQUIRED_FIELDS,
          entryRequired: ENTRY_REQUIRED_FIELDS,
          defaultProcess: IN_OUT_DEFAULT_PROCESS,
          processes: IN_OUT_PROCESSES,
          statuses: IN_OUT_STATUSES,
          modes: IN_OUT_MODES,
          deliveryModes: DELIVERY_MODES,
          courierModes: COURIER_DELIVERY_MODES,
          trackingTypes: IN_OUT_TRACKING_TYPES,
          adjustmentTypes: ADJUSTMENT_TYPES,
          adjustmentReasons: ADJUSTMENT_REASONS,
          shortExpiryApprovalMonths: SHORT_EXPIRY_APPROVAL_MONTHS,
          deviceConditions: DEVICE_CONDITIONS,
          inspectionStatuses: INSPECTION_STATUSES,
          documentTypes: DOCUMENT_TYPES,
          defaultWarehouseName: DEFAULT_WAREHOUSE_NAME,
          outwardDispatchStatuses: OUTWARD_DISPATCH_STATUSES,
          outwardDeliveryOutcomes: OUTWARD_DELIVERY_OUTCOMES,
          goodsIssueKinds: ['Fresh Dispatch', 'Inter Transfer', 'Recall / Pickup'],
        },
      },
    });
  })
);

function nextInOutUniqueKey() {
  const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const rand = Math.random().toString(36).slice(2, 6).toUpperCase();
  return `TXN-${stamp}-${rand}`;
}

function resolveEntryType(raw) {
  const v = trimStr(raw);
  return IN_OUT_ENTRY_TYPE_ALIASES[v] || v;
}

function resolveProductType(raw) {
  const v = trimStr(raw);
  if (!v) return '';
  if (IN_OUT_PRODUCT_TYPE_ALIASES[v]) return IN_OUT_PRODUCT_TYPE_ALIASES[v];
  const hit = Object.entries(IN_OUT_PRODUCT_TYPE_ALIASES).find(
    ([k]) => k.toLowerCase() === v.toLowerCase()
  );
  if (hit) return hit[1];
  if (IN_OUT_PRODUCT_TYPES.includes(v)) return v;
  return v;
}

function resolveInventoryType(raw) {
  const v = trimStr(raw);
  if (!v) return '';
  if (PRODUCT_INVENTORY_TYPES.includes(v)) return v;
  if (PRODUCT_INVENTORY_TYPE_ALIASES[v]) return PRODUCT_INVENTORY_TYPE_ALIASES[v];
  const hit = Object.entries(PRODUCT_INVENTORY_TYPE_ALIASES).find(
    ([k]) => k.toLowerCase() === v.toLowerCase()
  );
  return hit?.[1] || v;
}

function resolveDeliveryMode(raw) {
  const value = trimStr(raw);
  const canonical = DELIVERY_MODES.find(
    (mode) => mode.toLowerCase() === value.toLowerCase()
  );
  if (canonical) return canonical;
  const alias = Object.entries(DELIVERY_MODE_ALIASES).find(
    ([key]) => key.toLowerCase() === value.toLowerCase()
  );
  return alias?.[1] || value;
}

function entryTypeFilterValues(entryType) {
  const canonical = resolveEntryType(entryType);
  const legacy = Object.entries(IN_OUT_ENTRY_TYPE_ALIASES)
    .filter(([, v]) => v === canonical)
    .map(([k]) => k);
  return [...new Set([canonical, ...legacy])];
}

function entryTypeLedgerDefaults(entryType, qty, adjustmentType) {
  const canonical = resolveEntryType(entryType);
  const raw = Number(qty) || 0;
  const abs = Math.abs(raw);
  switch (canonical) {
    case 'Outward':
      return { direction: 'OUT', movementTypeCode: 'DISPATCH', quantityDelta: -abs };
    case 'Transfer':
      return { direction: 'OUT', movementTypeCode: 'TRF_OUT', quantityDelta: -abs };
    case 'Return':
      return { direction: 'IN', movementTypeCode: 'RETURN', quantityDelta: abs };
    case 'Stock Adjustment': {
      const decrease = adjustmentType === 'Decrease' || raw < 0;
      return {
        direction: decrease ? 'OUT' : 'IN',
        movementTypeCode: decrease ? 'ADJUST_OUT' : 'ADJUST_IN',
        quantityDelta: decrease ? -abs : abs,
      };
    }
    case 'Inward':
    default:
      return { direction: 'IN', movementTypeCode: 'GRN', quantityDelta: abs };
  }
}

function numOr(v, fallback = 0) {
  if (v === '' || v == null) return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function boolish(v, fallback = false) {
  if (v === true || v === 'true' || v === '1' || v === 'yes') return true;
  if (v === false || v === 'false' || v === '0' || v === 'no') return false;
  return fallback;
}

function displayItemName(body) {
  return (
    trimStr(body.productName) ||
    trimStr(body.deviceName) ||
    trimStr(body.itemName) ||
    trimStr(body.partName) ||
    trimStr(body.accessoryName) ||
    trimStr(body.documentNumber) ||
    'Inventory item'
  );
}

function normalizeInOutBody(body, existing = null, actor = null) {
  const entryType = resolveEntryType(body.entryType || existing?.entryType || 'Inward');
  if (!IN_OUT_ENTRY_TYPES.includes(entryType)) {
    throw new AppError(
      `Entry Type must be one of: ${IN_OUT_ENTRY_TYPES.join(', ')}`,
      400,
      'VALIDATION_ERROR'
    );
  }

  const productType = resolveProductType(
    body.productType ?? body.inventoryType ?? existing?.productType ?? existing?.inventoryType ?? ''
  );
  if (!productType || !IN_OUT_PRODUCT_TYPES.includes(productType)) {
    throw new AppError(
      `Product Category must be one of: ${IN_OUT_PRODUCT_TYPES.join(', ')}`,
      400,
      'VALIDATION_ERROR'
    );
  }

  const catDefaults = PRODUCT_CATEGORY_DEFAULTS[productType] || {
    expiryApplicable: false,
    trackingKind: 'None',
  };

  const expiryApplicable = boolish(
    body.expiryApplicable ?? existing?.expiryApplicable,
    catDefaults.expiryApplicable
  );
  let trackingKind =
    trimStr(body.trackingKind ?? existing?.trackingKind ?? '') || catDefaults.trackingKind;
  if (!PRODUCT_TRACKING_KINDS.includes(trackingKind)) trackingKind = catDefaults.trackingKind;

  const statusOptions = PRODUCT_STATUS_OPTIONS[productType] || ['Available'];
  const status = trimStr(body.status ?? existing?.status ?? '') || statusOptions[0];

  const qty = numOr(body.qty ?? existing?.qty, 0);
  if (!Number.isFinite(qty) || qty <= 0) {
    throw new AppError('Quantity is required and must be greater than zero', 400, 'VALIDATION_ERROR');
  }

  const transactionDateTime =
    trimStr(body.transactionDateTime ?? existing?.transactionDateTime ?? '') ||
    new Date().toISOString().slice(0, 16);
  const transactionDate =
    trimStr(body.transactionDate ?? existing?.transactionDate ?? '') ||
    transactionDateTime.slice(0, 10);

  const recipientName = trimStr(
    body.recipientName ??
      body.employeeName ??
      body.name ??
      body.issuedTo ??
      existing?.recipientName ??
      existing?.employeeName ??
      existing?.name ??
      ''
  );
  const productName = trimStr(body.productName ?? existing?.productName ?? '');
  if (!productName && !body.productId && !existing?.productId) {
    throw new AppError('Product Name is required. Select a product from Masters.', 400, 'VALIDATION_ERROR');
  }

  const deliveryMode =
    resolveDeliveryMode(
      body.deliveryMode ?? body.mode ?? existing?.deliveryMode ?? existing?.mode ?? ''
    ) || 'Hand Delivery';
  if (deliveryMode && /^other$/i.test(deliveryMode)) {
    throw new AppError('Enter a specific Delivery Mode instead of Other', 400, 'VALIDATION_ERROR');
  }

  const awbNumber = trimStr(body.awbNumber ?? existing?.awbNumber ?? '');
  if (COURIER_DELIVERY_MODES.includes(deliveryMode) && !awbNumber) {
    throw new AppError('AWB Number is required for courier deliveries', 400, 'VALIDATION_ERROR');
  }

  const batchOrSerial = trimStr(
    body.batchOrSerial ?? body.serialNumber ?? body.batchNumber ?? existing?.batchOrSerial ?? ''
  );
  const tracked = trackingKind !== 'None';
  if (tracked && !batchOrSerial) {
    throw new AppError(
      `Batch / Serial Number is required for ${trackingKind} items`,
      400,
      'VALIDATION_ERROR'
    );
  }

  const expiryDate = trimStr(body.expiryDate ?? body.expDate ?? existing?.expiryDate ?? '');
  if (expiryApplicable && !expiryDate) {
    throw new AppError('Expiry Date is required when Expiry Applicable is Yes', 400, 'VALIDATION_ERROR');
  }

  const isInbound =
    entryType === 'Inward' ||
    entryType === 'Return' ||
    /^inward/i.test(entryType);
  const needsShortExpiryApproval =
    isInbound && expiryDate && requiresShortExpiryApproval(expiryDate, transactionDate);
  const approvedBy = trimStr(body.approvedBy ?? existing?.approvedBy ?? '');
  if (needsShortExpiryApproval && !approvedBy) {
    throw new AppError(
      `Expiry is under ${SHORT_EXPIRY_APPROVAL_MONTHS} months. Inward requires approval (Approved By).`,
      400,
      'SHORT_EXPIRY_APPROVAL_REQUIRED'
    );
  }

  const serialNumber =
    trackingKind === 'Serial' || trackingKind === 'Batch + Serial' ? batchOrSerial : '';
  const batchNumber =
    trackingKind === 'Batch' || trackingKind === 'Batch + Serial' ? batchOrSerial : '';

  const row = {
    uniqueKey: trimStr(body.uniqueKey ?? existing?.uniqueKey ?? '') || nextInOutUniqueKey(),
    entryType,
    productType,
    inventoryType: productType,
    trackingType: trackingKind,
    trackingKind,
    expiryApplicable,
    transactionDate,
    transactionDateTime,
    warehouseId: body.warehouseId || existing?.warehouseId || null,
    sourceWarehouseId: body.sourceWarehouseId || body.warehouseId || existing?.sourceWarehouseId || null,
    fromLocationId: body.fromLocationId || existing?.fromLocationId || null,
    toLocationId: body.toLocationId || existing?.toLocationId || null,
    empId: trimStr(body.empId ?? existing?.empId ?? ''),
    employeeName: recipientName,
    recipientName,
    name: recipientName,
    contactId: body.contactId || existing?.contactId || null,
    number: trimStr(body.number ?? existing?.number ?? ''),
    state: trimStr(body.state ?? existing?.state ?? ''),
    city: trimStr(body.city ?? existing?.city ?? ''),
    remark: trimStr(body.remark ?? existing?.remark ?? ''),
    status,
    createdBy: existing?.createdBy || actor?.email || actor?.fullName || '',
    createdById: existing?.createdById || actor?._id || null,

    productId: body.productId || existing?.productId || null,
    productName: productName || existing?.productName || '',
    programProject: trimStr(body.programProject ?? existing?.programProject ?? ''),
    processId: body.processId || existing?.processId || null,
    processName: trimStr(body.processName ?? body.process ?? existing?.processName ?? ''),
    supplierId: body.supplierId || existing?.supplierId || null,
    transporterId: body.transporterId || existing?.transporterId || null,
    assetRequestId: body.assetRequestId || existing?.assetRequestId || null,
    assetRequestLineId:
      body.assetRequestLineId || existing?.assetRequestLineId || null,

    qty,
    uomId: body.uomId || existing?.uomId || null,
    perUnitCost: numOr(body.perUnitCost ?? existing?.perUnitCost, 0),
    invoiceAmount: numOr(body.invoiceAmount ?? existing?.invoiceAmount, 0),

    deviceName: productType.includes('Device') ? productName : trimStr(body.deviceName ?? ''),
    brand: trimStr(body.brand ?? existing?.brand ?? ''),
    model: trimStr(body.model ?? existing?.model ?? ''),
    serialNumber: serialNumber || trimStr(body.serialNumber ?? existing?.serialNumber ?? ''),
    assetId: trimStr(body.assetId ?? existing?.assetId ?? ''),
    imei: trimStr(body.imei ?? existing?.imei ?? ''),
    condition: trimStr(body.condition ?? existing?.condition ?? ''),
    warranty: trimStr(body.warranty ?? existing?.warranty ?? ''),

    itemName: productName,
    sku: trimStr(body.sku ?? existing?.sku ?? ''),
    batchNumber: batchNumber || trimStr(body.batchNumber ?? existing?.batchNumber ?? ''),
    batchOrSerial: tracked ? batchOrSerial : 'N/A',
    expiryDate: expiryApplicable ? expiryDate : '',
    description: trimStr(body.description ?? existing?.description ?? ''),

    partName: productName,
    partNumber: trimStr(body.partNumber ?? existing?.partNumber ?? ''),
    compatibleDevice: trimStr(body.compatibleDevice ?? existing?.compatibleDevice ?? ''),
    accessoryName: productName,

    documentType: trimStr(body.documentType ?? existing?.documentType ?? ''),
    documentNumber: trimStr(body.documentNumber ?? existing?.documentNumber ?? ''),
    agreementId: trimStr(body.agreementId ?? existing?.agreementId ?? ''),
    version: trimStr(body.version ?? existing?.version ?? ''),
    linkedAssetId: trimStr(body.linkedAssetId ?? existing?.linkedAssetId ?? ''),

    vendor: trimStr(body.vendor ?? existing?.vendor ?? ''),
    purchaseOrder: trimStr(body.purchaseOrder ?? existing?.purchaseOrder ?? ''),
    grnNumber: trimStr(body.grnNumber ?? existing?.grnNumber ?? ''),
    invoiceNumber: trimStr(body.invoiceNumber ?? existing?.invoiceNumber ?? ''),
    invoiceDate: trimStr(body.invoiceDate ?? existing?.invoiceDate ?? ''),
    awbNumber,
    courier: deliveryMode,
    deliveryMode,
    receivedBy: trimStr(body.receivedBy ?? existing?.receivedBy ?? ''),

    issuedTo: recipientName,
    department: trimStr(body.department ?? existing?.department ?? ''),
    expectedReturn: trimStr(body.expectedReturn ?? existing?.expectedReturn ?? ''),
    acknowledgementRequired: boolish(
      body.acknowledgementRequired ?? existing?.acknowledgementRequired,
      false
    ),
    dispatchStatus: (() => {
      const incoming = trimStr(body.dispatchStatus ?? '');
      if (incoming && OUTWARD_DISPATCH_STATUSES.includes(incoming)) return incoming;
      if (existing?.dispatchStatus) return existing.dispatchStatus;
      if (entryType === 'Outward' || entryType === 'Return') return OUTWARD_OPEN_DISPATCH_STATUS;
      return '';
    })(),
    deliveryOutcome: trimStr(body.deliveryOutcome ?? existing?.deliveryOutcome ?? ''),
    deliveredAt: trimStr(body.deliveredAt ?? existing?.deliveredAt ?? ''),
    closedAt: trimStr(body.closedAt ?? existing?.closedAt ?? ''),
    deliveryMarkedBy: trimStr(body.deliveryMarkedBy ?? existing?.deliveryMarkedBy ?? ''),
    logisticsKind: trimStr(body.logisticsKind ?? existing?.logisticsKind ?? ''),
    priority: trimStr(body.priority ?? existing?.priority ?? ''),
    preferredDate: trimStr(body.preferredDate ?? existing?.preferredDate ?? ''),
    fromContactId: body.fromContactId || existing?.fromContactId || null,
    fromName: trimStr(body.fromName ?? existing?.fromName ?? ''),
    fromNumber: trimStr(body.fromNumber ?? existing?.fromNumber ?? ''),
    fromAddress: trimStr(body.fromAddress ?? existing?.fromAddress ?? ''),
    fromPinCode: trimStr(body.fromPinCode ?? existing?.fromPinCode ?? ''),
    fromCity: trimStr(body.fromCity ?? existing?.fromCity ?? ''),
    fromState: trimStr(body.fromState ?? existing?.fromState ?? ''),
    address: trimStr(body.address ?? body.toAddress ?? existing?.address ?? ''),
    pinCode: trimStr(body.pinCode ?? body.toPinCode ?? existing?.pinCode ?? ''),
    toAddress: trimStr(body.toAddress ?? existing?.toAddress ?? ''),

    destinationWarehouseId: body.destinationWarehouseId || existing?.destinationWarehouseId || null,
    transferReason: trimStr(body.transferReason ?? existing?.transferReason ?? ''),
    transferId: trimStr(body.transferId ?? existing?.transferId ?? ''),

    returnedFrom: recipientName,
    returnReason: trimStr(body.returnReason ?? existing?.returnReason ?? ''),
    inspectionStatus: trimStr(body.inspectionStatus ?? existing?.inspectionStatus ?? ''),
    restock: boolish(body.restock ?? existing?.restock, false),

    adjustmentType: trimStr(body.adjustmentType ?? existing?.adjustmentType ?? ''),
    adjustmentReason: trimStr(body.adjustmentReason ?? existing?.adjustmentReason ?? ''),
    approvedBy: needsShortExpiryApproval || approvedBy ? approvedBy : '',

    process: trimStr(
      body.processName ?? body.process ?? existing?.process ?? IN_OUT_DEFAULT_PROCESS[entryType] ?? ''
    ),
    mode: deliveryMode,
    expDate: expiryApplicable ? expiryDate : '',
    productPhoto: body.productPhoto ?? existing?.productPhoto ?? null,
    invoiceDoc: body.invoiceDoc ?? existing?.invoiceDoc ?? null,
    attachments: Array.isArray(body.attachments)
      ? body.attachments
      : existing?.attachments || [],
    isActive: body.isActive !== false,
  };

  if (!row.processName) row.processName = row.process;

  return row;
}

async function enrichBodyFromProduct(body) {
  if (!body?.productId) return body;
  const product = await LogisticsProduct.findOne({ _id: body.productId, isDeleted: false });
  if (!product) return body;
  return {
    ...body,
    productName: trimStr(body.productName) || product.name,
    productType: trimStr(body.productType) || product.productType,
    inventoryType: trimStr(body.inventoryType) || product.productType,
    sku: trimStr(body.sku) || product.sku || '',
    partNumber: trimStr(body.partNumber) || product.partNumber || '',
    brand: trimStr(body.brand) || product.brand || '',
    model: trimStr(body.model) || product.model || '',
    programProject: trimStr(body.programProject) || product.programProject || '',
    perUnitCost:
      body.perUnitCost !== undefined && body.perUnitCost !== ''
        ? body.perUnitCost
        : product.defaultPerUnitCost || 0,
    trackingKind: trimStr(body.trackingKind) || product.trackingKind || body.trackingKind,
    expiryApplicable:
      body.expiryApplicable !== undefined && body.expiryApplicable !== ''
        ? body.expiryApplicable
        : product.expiryApplicable,
  };
}

async function findStockForTxn(txn, warehouseId, { availableOnly = false } = {}) {
  const statusFilter = availableOnly ? { status: 'Available' } : {};
  if (txn.serialNumber) {
    const bySerial = await LogisticsStockItem.findOne({
      serialNumber: txn.serialNumber,
      isDeleted: false,
      ...statusFilter,
    });
    if (bySerial) return bySerial;
    if (availableOnly) return null;
    return LogisticsStockItem.findOne({
      serialNumber: txn.serialNumber,
      isDeleted: false,
    });
  }

  const wh = warehouseId || null;
  const base = { isDeleted: false, ...statusFilter };
  if (wh) base.warehouseId = wh;

  if (txn.productId) {
    const withBatch = txn.batchNumber
      ? await LogisticsStockItem.findOne({
          ...base,
          productId: txn.productId,
          batchNumber: txn.batchNumber,
        })
      : null;
    if (withBatch) return withBatch;
    const byProduct = await LogisticsStockItem.findOne({ ...base, productId: txn.productId });
    if (byProduct) return byProduct;
  }

  if (txn.sku) {
    const withBatch = txn.batchNumber
      ? await LogisticsStockItem.findOne({ ...base, sku: txn.sku, batchNumber: txn.batchNumber })
      : null;
    if (withBatch) return withBatch;
    const bySku = await LogisticsStockItem.findOne({ ...base, sku: txn.sku });
    if (bySku) return bySku;
  }

  const name = displayItemName(txn);
  if (txn.batchNumber) {
    const byNameBatch = await LogisticsStockItem.findOne({
      ...base,
      name,
      batchNumber: txn.batchNumber,
    });
    if (byNameBatch) return byNameBatch;
  }
  return LogisticsStockItem.findOne({ ...base, name });
}

/** Sum Available qty for matching product/serial/batch in warehouse (goods issue guard). */
async function sumAvailableQty(txn, warehouseId) {
  const statusFilter = { status: 'Available' };
  if (txn.serialNumber) {
    const rows = await LogisticsStockItem.find({
      serialNumber: txn.serialNumber,
      isDeleted: false,
      ...statusFilter,
    });
    return rows.reduce((sum, row) => sum + (Number(row.quantity) || 0), 0);
  }

  const wh = warehouseId || null;
  const base = { isDeleted: false, ...statusFilter };
  if (wh) base.warehouseId = wh;

  let filter = null;
  if (txn.productId) {
    filter = { ...base, productId: txn.productId };
    if (txn.batchNumber) filter.batchNumber = txn.batchNumber;
  } else if (txn.sku) {
    filter = { ...base, sku: txn.sku };
    if (txn.batchNumber) filter.batchNumber = txn.batchNumber;
  } else {
    const name = displayItemName(txn);
    if (!name) return 0;
    filter = { ...base, name };
    if (txn.batchNumber) filter.batchNumber = txn.batchNumber;
  }

  const rows = await LogisticsStockItem.find(filter);
  return rows.reduce((sum, row) => sum + (Number(row.quantity) || 0), 0);
}

async function applyQtyDeltaToStock(txn, warehouseId, quantityDelta, actor) {
  const itemName = displayItemName(txn);
  const need = Math.abs(Number(quantityDelta) || 0);

  if (quantityDelta < 0) {
    const available = await sumAvailableQty(txn, warehouseId);
    if (available < need) {
      throw new AppError(
        `Insufficient available stock for “${itemName}” (available ${available}, requested ${need})`,
        400,
        'INSUFFICIENT_STOCK'
      );
    }

    let remaining = need;
    const lots = [];
    if (txn.serialNumber) {
      const row = await findStockForTxn(txn, warehouseId, { availableOnly: true });
      if (row) lots.push(row);
    } else {
      const wh = warehouseId || null;
      const base = { isDeleted: false, status: 'Available' };
      if (wh) base.warehouseId = wh;
      let filter = { ...base };
      if (txn.productId) {
        filter.productId = txn.productId;
        if (txn.batchNumber) filter.batchNumber = txn.batchNumber;
      } else if (txn.sku) {
        filter.sku = txn.sku;
        if (txn.batchNumber) filter.batchNumber = txn.batchNumber;
      } else {
        filter.name = displayItemName(txn);
        if (txn.batchNumber) filter.batchNumber = txn.batchNumber;
      }
      const found = await LogisticsStockItem.find(filter).sort('createdAt');
      lots.push(...found);
    }

    let last = null;
    for (const stockItem of lots) {
      if (remaining <= 0) break;
      const onHand = Number(stockItem.quantity) || 0;
      if (onHand <= 0) continue;
      const take = Math.min(onHand, remaining);
      stockItem.quantity = onHand - take;
      stockItem.status = txn.status || stockItem.status;
      stockItem.locationId = txn.toLocationId || stockItem.locationId;
      stockItem.unitValue = txn.perUnitCost || stockItem.unitValue;
      stockItem.productType = txn.productType || stockItem.productType;
      if (txn.productId) stockItem.productId = txn.productId;
      if (txn.expiryDate) stockItem.expiryDate = txn.expiryDate;
      await stockItem.save();
      remaining -= take;
      last = stockItem;
    }

    if (remaining > 0) {
      throw new AppError(
        `Insufficient available stock for “${itemName}” (could not allocate remaining ${remaining})`,
        400,
        'INSUFFICIENT_STOCK'
      );
    }
    return last;
  }

  let stockItem = await findStockForTxn(txn, warehouseId);

  if (stockItem) {
    stockItem.quantity = (Number(stockItem.quantity) || 0) + quantityDelta;
    stockItem.status = txn.status || stockItem.status;
    stockItem.warehouseId = warehouseId || stockItem.warehouseId;
    stockItem.locationId = txn.toLocationId || stockItem.locationId;
    stockItem.unitValue = txn.perUnitCost || stockItem.unitValue;
    stockItem.productType = txn.productType || stockItem.productType;
    if (txn.productId) stockItem.productId = txn.productId;
    if (txn.sku) stockItem.sku = txn.sku;
    if (txn.expiryDate) stockItem.expiryDate = txn.expiryDate;
    await stockItem.save();
    return stockItem;
  }

  return LogisticsStockItem.create({
    sku: txn.sku || txn.partNumber || '',
    productId: txn.productId || null,
    name: itemName,
    serialNumber: txn.serialNumber || null,
    imei: txn.imei || null,
    batchNumber: txn.batchNumber || null,
    warehouseId: warehouseId || null,
    locationId: txn.toLocationId || txn.fromLocationId || null,
    productType: txn.productType,
    status: txn.status || 'Available',
    quantity: Math.abs(quantityDelta) || txn.qty || 1,
    unitValue: txn.perUnitCost || 0,
    expiryDate: txn.expiryDate || '',
    tyloAssetId: txn.assetId || null,
    remarks: txn.remark || '',
    isActive: true,
  });
}

async function applyInventoryUpdate(txn, actor) {
  const ledger = entryTypeLedgerDefaults(txn.entryType, txn.qty, txn.adjustmentType);
  const itemName = displayItemName(txn);

  let stockItem = null;
  let warehouseId = txn.warehouseId;

  if (txn.entryType === 'Transfer') {
    const sourceId = txn.sourceWarehouseId || txn.warehouseId;
    const destId = txn.destinationWarehouseId;
    if (!sourceId || !destId) {
      throw new AppError('Transfer requires source and destination warehouses', 400, 'VALIDATION_ERROR');
    }
    const abs = Math.abs(Number(txn.qty) || 0);
    await applyQtyDeltaToStock(txn, sourceId, -abs, actor);
    stockItem = await applyQtyDeltaToStock(txn, destId, abs, actor);
    warehouseId = destId;

    await LogisticsLedgerEntry.create({
      stockItemId: stockItem?._id || null,
      movementTypeCode: 'TRF_OUT',
      direction: 'OUT',
      quantityDelta: -abs,
      warehouseId: sourceId,
      locationId: txn.fromLocationId || null,
      fromWarehouseId: sourceId,
      toWarehouseId: destId,
      referenceType: 'IN_OUT',
      referenceId: txn._id,
      remarks: txn.remark || `Transfer · ${itemName}`,
      actorId: actor?._id || null,
      actorEmail: actor?.email || null,
      at: txn.transactionDateTime || txn.transactionDate || new Date().toISOString(),
    });
    await LogisticsLedgerEntry.create({
      stockItemId: stockItem?._id || null,
      movementTypeCode: 'TRF_IN',
      direction: 'IN',
      quantityDelta: abs,
      warehouseId: destId,
      locationId: txn.toLocationId || null,
      fromWarehouseId: sourceId,
      toWarehouseId: destId,
      referenceType: 'IN_OUT',
      referenceId: txn._id,
      remarks: txn.remark || `Transfer · ${itemName}`,
      actorId: actor?._id || null,
      actorEmail: actor?.email || null,
      at: txn.transactionDateTime || txn.transactionDate || new Date().toISOString(),
    });
    return stockItem;
  }

  stockItem = await applyQtyDeltaToStock(txn, warehouseId, ledger.quantityDelta, actor);

  await LogisticsLedgerEntry.create({
    stockItemId: stockItem?._id || null,
    movementTypeCode: ledger.movementTypeCode,
    direction: ledger.direction,
    quantityDelta: ledger.quantityDelta,
    warehouseId: warehouseId || null,
    locationId: txn.toLocationId || txn.fromLocationId || null,
    fromWarehouseId: txn.sourceWarehouseId || null,
    toWarehouseId: txn.destinationWarehouseId || null,
    referenceType: 'IN_OUT',
    referenceId: txn._id,
    remarks: txn.remark || `${txn.entryType} · ${txn.productType} · ${itemName}`,
    actorId: actor?._id || null,
    actorEmail: actor?.email || null,
    at: txn.transactionDateTime || txn.transactionDate || new Date().toISOString(),
  });

  return stockItem;
}

function requestLineId(line, index) {
  return line?.lineId || `legacy-line-${index + 1}`;
}

async function prepareRequestFulfillment(inputBody) {
  const assetRequestId = inputBody.assetRequestId || null;
  if (!assetRequestId || resolveEntryType(inputBody.entryType) !== 'Outward') {
    return { body: inputBody, context: null };
  }

  const request = await AssetRequest.findOne({
    _id: assetRequestId,
    isDeleted: false,
  });
  if (!request || !['LOGISTICS', 'MOVEMENT'].includes(request.requestType)) {
    throw new AppError('Linked Logistics request not found', 404);
  }
  if (request.status !== 'APPROVED') {
    throw new AppError(
      'Only APPROVED Logistics requests can be fulfilled',
      409,
      'INVALID_STATUS'
    );
  }

  const lines = Array.isArray(request.logisticsProducts)
    ? request.logisticsProducts
    : [];
  let lineId = trimStr(inputBody.assetRequestLineId);
  let line = null;
  if (lines.length) {
    if (!lineId && lines.length > 1) {
      throw new AppError(
        'assetRequestLineId is required for multi-product requests',
        400,
        'ASSET_REQUEST_LINE_REQUIRED'
      );
    }
    if (!lineId) lineId = requestLineId(lines[0], 0);
    const index = lines.findIndex(
      (item, itemIndex) => requestLineId(item, itemIndex) === lineId
    );
    if (index < 0) {
      throw new AppError(
        'assetRequestLineId does not belong to this request',
        400,
        'INVALID_ASSET_REQUEST_LINE'
      );
    }
    line = lines[index];
  } else {
    lineId = lineId || 'legacy-line-1';
  }

  if ((request.fulfilledLineIds || []).includes(lineId)) {
    throw new AppError(
      'This request product line has already been dispatched',
      409,
      'DUPLICATE_FULFILLMENT'
    );
  }
  const duplicateFilter = {
    assetRequestId: request._id,
    entryType: 'Outward',
    isDeleted: false,
  };
  if (lines.length) duplicateFilter.assetRequestLineId = lineId;
  const duplicate = await LogisticsInOutEntry.findOne(duplicateFilter);
  if (duplicate) {
    throw new AppError(
      'This request product line has already been dispatched',
      409,
      'DUPLICATE_FULFILLMENT'
    );
  }

  return {
    body: {
      ...inputBody,
      assetRequestId: request._id,
      assetRequestLineId: lineId,
      ...(line
        ? {
            productId: line.productId || null,
            productName: line.productName,
            productType: line.productType,
            inventoryType: line.productType,
            qty: line.qty,
          }
        : {}),
    },
    context: {
      requestId: request._id,
      lineId,
      totalLines: lines.length || 1,
      allLineIds: lines.length
        ? lines.map(requestLineId)
        : [lineId],
    },
  };
}

async function finalizeRequestFulfillment(context) {
  if (!context) return null;
  const request = await AssetRequest.findOne({
    _id: context.requestId,
    isDeleted: false,
  });
  if (!request || request.status !== 'APPROVED') {
    throw new AppError('Request is no longer approved', 409, 'INVALID_STATUS');
  }
  const fulfilledLineIds = [
    ...new Set([...(request.fulfilledLineIds || []), context.lineId]),
  ];
  const updated = await AssetRequest.findOneAndUpdate(
    {
      _id: request._id,
      isDeleted: false,
      status: 'APPROVED',
      fulfillmentPendingLineIds: { $in: [context.lineId] },
    },
    {
      $set: {
        fulfilledLineIds,
        fulfillmentPendingLineIds: (request.fulfillmentPendingLineIds || []).filter(
          (lineId) => String(lineId) !== String(context.lineId)
        ),
      },
    }
  );
  if (!updated) throw new AppError('Request status changed', 409, 'INVALID_STATUS');
  const allProductLinesFulfilled = context.allLineIds.every((lineId) =>
    fulfilledLineIds.includes(lineId)
  );
  return {
    assetRequestId: request._id,
    assetRequestLineId: context.lineId,
    fulfilledLineIds,
    fulfilledCount: fulfilledLineIds.length,
    totalLines: context.totalLines,
    allProductLinesFulfilled,
    canCompleteRequest: allProductLinesFulfilled,
    requestStatus: updated.status,
    completionRequired: allProductLinesFulfilled,
  };
}

async function reserveRequestFulfillment(context) {
  if (!context) return false;
  const request = await AssetRequest.findOne({
    _id: context.requestId,
    isDeleted: false,
    status: 'APPROVED',
  });
  if (!request) throw new AppError('Request is no longer approved', 409, 'INVALID_STATUS');
  const pending = request.fulfillmentPendingLineIds || [];
  const reserved = await AssetRequest.findOneAndUpdate(
    {
      _id: request._id,
      isDeleted: false,
      status: 'APPROVED',
      fulfilledLineIds: { $nin: [context.lineId] },
      fulfillmentPendingLineIds: { $nin: [context.lineId] },
    },
    {
      $set: {
        fulfillmentPendingLineIds: [...pending, context.lineId],
      },
    }
  );
  if (!reserved) {
    throw new AppError(
      'This request product line is already dispatched or being dispatched',
      409,
      'DUPLICATE_FULFILLMENT'
    );
  }
  return true;
}

async function releaseRequestFulfillmentReservation(context) {
  if (!context) return;
  const request = await AssetRequest.findOne({
    _id: context.requestId,
    isDeleted: false,
  });
  if (!request) return;
  await AssetRequest.findOneAndUpdate(
    { _id: request._id },
    {
      $set: {
        fulfillmentPendingLineIds: (request.fulfillmentPendingLineIds || []).filter(
          (lineId) => String(lineId) !== String(context.lineId)
        ),
      },
    }
  );
}

/** Dynamic Inventory Transaction CRUD */
router.get(
  '/in-out',
  canRead,
  asyncHandler(async (req, res) => {
    const { page, limit, skip, sort } = parsePagination(req.query);
    const filter = { isDeleted: false };
    if (req.query.entryTypes) {
      const parts = String(req.query.entryTypes)
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
      const types = [...new Set(parts.flatMap((t) => entryTypeFilterValues(t)))];
      if (types.length === 1) filter.entryType = types[0];
      else if (types.length > 1) filter.entryType = { $in: types };
    } else if (req.query.entryType) {
      const types = entryTypeFilterValues(req.query.entryType);
      filter.entryType = types.length > 1 ? { $in: types } : types[0];
    }
    if (req.query.productType) {
      filter.productType = resolveProductType(req.query.productType);
    }
    if (req.query.status) filter.status = String(req.query.status);
    if (req.query.dispatchStatus) {
      const ds = String(req.query.dispatchStatus).trim();
      if (ds === OUTWARD_OPEN_DISPATCH_STATUS) {
        // Include legacy outward rows with no dispatchStatus yet
        filter.dispatchStatus = { $nin: OUTWARD_TERMINAL_DISPATCH_STATUSES };
      } else {
        filter.dispatchStatus = ds;
      }
    }
    if (req.query.q) {
      const re = new RegExp(String(req.query.q), 'i');
      filter.$or = [
        { uniqueKey: re },
        { employeeName: re },
        { name: re },
        { empId: re },
        { deviceName: re },
        { itemName: re },
        { partName: re },
        { accessoryName: re },
        { serialNumber: re },
        { sku: re },
        { awbNumber: re },
        { remark: re },
        { productType: re },
        { inventoryType: re },
      ];
    }
    const [data, total] = await Promise.all([
      LogisticsInOutEntry.find(filter)
        .sort(sort || '-transactionDateTime')
        .skip(skip)
        .limit(limit),
      LogisticsInOutEntry.countDocuments(filter),
    ]);
    res.json(paginated(data, total, page, limit));
  })
);

router.post(
  '/in-out',
  canWrite,
  (req, res, next) => {
    inwardFiles(req, res, (err) => {
      if (err) return next(err);
      next();
    });
  },
  asyncHandler(async (req, res) => {
    const filesMeta = attachmentsFromUpload(req, null);
    const prepared = await prepareRequestFulfillment({
      ...req.body,
      ...filesMeta,
    });
    const enriched = await enrichBodyFromProduct(prepared.body);
    const body = normalizeInOutBody(enriched, null, req.user);
    const clash = await LogisticsInOutEntry.findOne({
      uniqueKey: body.uniqueKey,
      isDeleted: false,
    });
    if (clash) {
      throw new AppError(`Transaction ID “${body.uniqueKey}” already exists`, 400, 'DUPLICATE');
    }

    let reserved = false;
    try {
      reserved = await reserveRequestFulfillment(prepared.context);
      const row = await LogisticsInOutEntry.create(body);
      await applyInventoryUpdate(row, req.user);
      const fulfillment = await finalizeRequestFulfillment(prepared.context);

      await writeAudit({
        actorId: req.user._id,
        actorEmail: req.user.email,
        action: 'LogisticsInOutEntry.CREATE',
        entityType: 'LogisticsInOutEntry',
        entityId: row._id,
        after: row.toObject ? row.toObject() : row,
        requestId: req.requestId,
      });

      res.status(201).json({ data: row, fulfillment });
    } catch (error) {
      if (reserved) await releaseRequestFulfillmentReservation(prepared.context);
      throw error;
    }
  })
);

router.patch(
  '/in-out/:id',
  canWrite,
  (req, res, next) => {
    inwardFiles(req, res, (err) => {
      if (err) return next(err);
      next();
    });
  },
  asyncHandler(async (req, res) => {
    const row = await LogisticsInOutEntry.findOne({ _id: req.params.id, isDeleted: false });
    if (!row) throw new AppError('Transaction not found', 404);
    if (
      (req.body.assetRequestId &&
        String(req.body.assetRequestId) !== String(row.assetRequestId || '')) ||
      (req.body.assetRequestLineId &&
        String(req.body.assetRequestLineId) !== String(row.assetRequestLineId || ''))
    ) {
      throw new AppError(
        'Request fulfillment links are immutable; create a new outward transaction',
        409,
        'FULFILLMENT_LINK_IMMUTABLE'
      );
    }

    const filesMeta = attachmentsFromUpload(req, row);
    const body = normalizeInOutBody({ ...req.body, ...filesMeta }, row, req.user);
    if (body.uniqueKey && body.uniqueKey !== row.uniqueKey) {
      const clash = await LogisticsInOutEntry.findOne({
        uniqueKey: body.uniqueKey,
        isDeleted: false,
      });
      if (clash && String(clash._id) !== String(row._id)) {
        throw new AppError(`Transaction ID “${body.uniqueKey}” already exists`, 400, 'DUPLICATE');
      }
    }
    Object.assign(row, body);
    await row.save();

    await writeAudit({
      actorId: req.user._id,
      actorEmail: req.user.email,
      action: 'LogisticsInOutEntry.UPDATE',
      entityType: 'LogisticsInOutEntry',
      entityId: row._id,
      after: row.toObject ? row.toObject() : row,
      requestId: req.requestId,
    });

    res.json({ data: row });
  })
);

router.patch(
  '/in-out/:id/delivery',
  canWrite,
  asyncHandler(async (req, res) => {
    const row = await LogisticsInOutEntry.findOne({ _id: req.params.id, isDeleted: false });
    if (!row) throw new AppError('Transaction not found', 404);
    if (String(row.entryType || '') !== 'Outward' && String(row.entryType || '') !== 'Return') {
      throw new AppError('Delivery status applies only to goods issue / recall transactions', 400, 'VALIDATION_ERROR');
    }

    const current = trimStr(row.dispatchStatus) || OUTWARD_OPEN_DISPATCH_STATUS;
    if (OUTWARD_TERMINAL_DISPATCH_STATUSES.includes(current)) {
      throw new AppError(
        `Dispatch is already ${current}. Open status cannot be changed again.`,
        409,
        'DISPATCH_ALREADY_CLOSED'
      );
    }

    const outcome = trimStr(req.body.outcome ?? req.body.deliveryOutcome ?? req.body.dispatchStatus);
    if (!OUTWARD_DELIVERY_OUTCOMES.includes(outcome)) {
      throw new AppError(
        `outcome must be one of: ${OUTWARD_DELIVERY_OUTCOMES.join(', ')}`,
        400,
        'VALIDATION_ERROR'
      );
    }

    const now = new Date().toISOString();
    const markedBy = req.user?.email || req.user?.fullName || '';
    row.dispatchStatus = outcome;
    row.deliveryOutcome = outcome;
    row.closedAt = now;
    row.deliveryMarkedBy = markedBy;
    if (outcome === 'Delivered') {
      row.deliveredAt = trimStr(req.body.deliveredAt) || now;
    } else if (req.body.deliveredAt) {
      row.deliveredAt = trimStr(req.body.deliveredAt);
    }
    if (req.body.remark || req.body.deliveryRemark) {
      const note = trimStr(req.body.remark || req.body.deliveryRemark);
      row.remark = row.remark ? `${row.remark} | ${outcome}: ${note}` : `${outcome}: ${note}`;
    }
    if (req.body.awbNumber != null && trimStr(req.body.awbNumber)) {
      row.awbNumber = trimStr(req.body.awbNumber);
    }
    await row.save();

    await writeAudit({
      actorId: req.user._id,
      actorEmail: req.user.email,
      action: 'LogisticsInOutEntry.DELIVERY',
      entityType: 'LogisticsInOutEntry',
      entityId: row._id,
      after: row.toObject ? row.toObject() : row,
      requestId: req.requestId,
    });

    res.json({ data: row });
  })
);

router.delete(
  '/in-out/:id',
  requireAdmin,
  asyncHandler(async (req, res) => {
    const row = await LogisticsInOutEntry.findOne({ _id: req.params.id, isDeleted: false });
    if (!row) throw new AppError('Transaction not found', 404);
    row.isDeleted = true;
    row.isActive = false;
    await row.save();
    await writeAudit({
      actorId: req.user._id,
      actorEmail: req.user.email,
      action: 'LogisticsInOutEntry.DELETE',
      entityType: 'LogisticsInOutEntry',
      entityId: row._id,
      requestId: req.requestId,
    });
    res.json({ data: { ok: true } });
  })
);

function computeKpis(items) {
  let totalQty = 0;
  let totalValue = 0;
  let availableQty = 0;
  let reservedQty = 0;
  let damagedQty = 0;
  let repairQty = 0;
  let lowStock = 0;
  let pendingDispatch = 0;

  for (const item of items) {
    const qty = Number(item.quantity) || 0;
    const value = (Number(item.unitValue) || 0) * qty;
    totalQty += qty;
    totalValue += value;
    const status = String(item.status || '');
    if (status === 'Available') availableQty += qty;
    if (status === 'Reserved' || status === 'Allocated') reservedQty += qty;
    if (status === 'Damaged') damagedQty += qty;
    if (status === 'Repair') repairQty += qty;
    if (status === 'Picked' || status === 'Packed' || status === 'Allocated') pendingDispatch += qty;
    const threshold = Number(item.lowStockThreshold) || 0;
    if (threshold > 0 && status === 'Available' && qty <= threshold) lowStock += 1;
  }

  return {
    totalQty,
    totalValue,
    availableQty,
    reservedQty,
    damagedQty,
    repairQty,
    lowStock,
    pendingDispatch,
  };
}

router.get(
  '/dashboard',
  canRead,
  asyncHandler(async (req, res) => {
    const [rows, usageRows] = await Promise.all([
      LogisticsInOutEntry.find({ isDeleted: false }),
      listUsageMerged(),
    ]);
    const data = buildDashboard(rows, usageRows, {
      month: req.query.month,
      dateFrom: req.query.dateFrom,
      dateTo: req.query.dateTo,
      inventoryType: req.query.inventoryType,
      hcwId: req.query.hcwId,
    });
    res.json({ data });
  })
);

router.get(
  '/usage',
  canRead,
  asyncHandler(async (req, res) => {
    await syncUsageFromCamps();
    const { page, limit, skip, sort } = parsePagination(req.query);
    const filter = { isDeleted: false };
    const andParts = [];
    if (req.query.hcw) {
      const re = new RegExp(String(req.query.hcw), 'i');
      andParts.push({ $or: [{ hcwName: re }, { hcwId: re }] });
    }
    if (req.query.location || req.query.city) {
      filter.machineCity = new RegExp(String(req.query.location || req.query.city), 'i');
    }
    if (req.query.q) {
      const re = new RegExp(String(req.query.q), 'i');
      andParts.push({
        $or: [
          { inventoryType: re },
          { processName: re },
          { doctorName: re },
          { clientName: re },
          { hcwName: re },
          { productName: re },
        ],
      });
    }
    if (andParts.length === 1) Object.assign(filter, andParts[0]);
    else if (andParts.length > 1) filter.$and = andParts;
    const [data, total] = await Promise.all([
      LogisticsUsageEntry.find(filter)
        .sort(sort || '-campDate')
        .skip(skip)
        .limit(limit),
      LogisticsUsageEntry.countDocuments(filter),
    ]);
    res.json(paginated(data, total, page, limit));
  })
);

router.post(
  '/usage',
  canWrite,
  asyncHandler(async (req, res) => {
    const body = req.body || {};
    const screenCount = Number(body.screenCount ?? body.usedQty ?? 0) || 0;
    const wastage = Number(body.wastage ?? body.wastageQty ?? 0) || 0;
    const row = await LogisticsUsageEntry.create({
      hcwId: trimStr(body.hcwId),
      hcwName: trimStr(body.hcwName),
      clientName: trimStr(body.clientName),
      processName: trimStr(body.processName),
      inventoryType: trimStr(body.inventoryType || body.productName),
      productName: trimStr(body.productName || body.inventoryType),
      doctorName: trimStr(body.doctorName),
      machineCity: trimStr(body.machineCity || body.city),
      campDate: trimStr(body.campDate),
      screenCount,
      usedQty: screenCount,
      wastage,
      perUnitCost: Number(body.perUnitCost) || 0,
      campRequestId: body.campRequestId || null,
      source: body.campRequestId ? 'camp' : 'manual',
      remark: trimStr(body.remark),
      isActive: true,
    });
    res.status(201).json({ data: row });
  })
);

router.patch(
  '/usage/:id',
  canWrite,
  asyncHandler(async (req, res) => {
    const row = await LogisticsUsageEntry.findOne({ _id: req.params.id, isDeleted: false });
    if (!row) throw new AppError('Usage row not found', 404);
    const body = req.body || {};
    const fields = [
      'hcwId',
      'hcwName',
      'clientName',
      'processName',
      'inventoryType',
      'productName',
      'doctorName',
      'machineCity',
      'campDate',
      'remark',
    ];
    for (const f of fields) {
      if (body[f] != null) row[f] = trimStr(body[f]);
    }
    if (body.screenCount != null || body.usedQty != null) {
      const n = Number(body.screenCount ?? body.usedQty) || 0;
      row.screenCount = n;
      row.usedQty = n;
    }
    if (body.wastage != null || body.wastageQty != null) {
      row.wastage = Number(body.wastage ?? body.wastageQty) || 0;
    }
    if (body.perUnitCost != null) row.perUnitCost = Number(body.perUnitCost) || 0;
    await row.save();
    res.json({ data: row });
  })
);

router.get(
  '/inventory/availability',
  canRead,
  asyncHandler(async (req, res) => {
    const txn = {
      productId: req.query.productId || null,
      sku: trimStr(req.query.sku),
      serialNumber: trimStr(req.query.serialNumber),
      batchNumber: trimStr(req.query.batchNumber),
      productName: trimStr(req.query.productName || req.query.name),
      itemName: trimStr(req.query.productName || req.query.name),
      deviceName: trimStr(req.query.productName || req.query.name),
    };
    const warehouseId = req.query.warehouseId || null;
    const available = await sumAvailableQty(txn, warehouseId);
    res.json({ data: { availableQty: available, warehouseId, productId: txn.productId } });
  })
);

router.get(
  '/inventory/summary',
  canRead,
  asyncHandler(async (_req, res) => {
    const items = await LogisticsStockItem.find({ isDeleted: false });
    res.json({ data: computeKpis(items) });
  })
);

/** All inventory ledger lines (Inward & Outward) */
router.get(
  '/ledger',
  canRead,
  asyncHandler(async (req, res) => {
    const { page, limit, skip, sort } = parsePagination(req.query);
    const filter = {};
    if (req.query.direction) {
      const d = String(req.query.direction).toUpperCase();
      if (d === 'IN' || d === 'OUT') filter.direction = d;
    }
    if (req.query.movementTypeCode) filter.movementTypeCode = String(req.query.movementTypeCode);
    if (req.query.warehouseId) filter.warehouseId = req.query.warehouseId;
    if (req.query.q) {
      const re = new RegExp(String(req.query.q), 'i');
      filter.$or = [{ remarks: re }, { movementTypeCode: re }, { actorEmail: re }, { referenceType: re }];
    }
    const [data, total] = await Promise.all([
      LogisticsLedgerEntry.find(filter)
        .sort(sort || '-at')
        .skip(skip)
        .limit(limit),
      LogisticsLedgerEntry.countDocuments(filter),
    ]);
    res.json(paginated(data, total, page, limit));
  })
);

router.get(
  '/inventory',
  canRead,
  asyncHandler(async (req, res) => {
    const { page, limit, skip, sort } = parsePagination(req.query);
    const filter = { isDeleted: false };
    if (req.query.warehouseId) filter.warehouseId = req.query.warehouseId;
    if (req.query.status) filter.status = req.query.status;
    if (req.query.categoryId) filter.categoryId = req.query.categoryId;
    if (req.query.productId) filter.productId = req.query.productId;
    if (req.query.productType) {
      const want = resolveProductType(req.query.productType) || String(req.query.productType);
      const aliases = Object.entries(IN_OUT_PRODUCT_TYPE_ALIASES)
        .filter(([, canonical]) => canonical === want)
        .map(([alias]) => alias);
      filter.productType = { $in: [...new Set([want, String(req.query.productType), ...aliases])] };
    }
    if (req.query.q) {
      const re = new RegExp(String(req.query.q), 'i');
      filter.$or = [
        { name: re },
        { sku: re },
        { serialNumber: re },
        { imei: re },
        { batchNumber: re },
      ];
    }
    const [data, total, filteredAll] = await Promise.all([
      LogisticsStockItem.find(filter).sort(sort || '-updatedAt').skip(skip).limit(limit),
      LogisticsStockItem.countDocuments(filter),
      LogisticsStockItem.find(filter),
    ]);
    res.json({
      ...paginated(data, total, page, limit),
      summary: computeKpis(filteredAll),
    });
  })
);

router.post(
  '/inventory',
  canWrite,
  asyncHandler(async (req, res) => {
    const name = trimStr(req.body.name);
    if (!name) throw new AppError('Asset / item name is required', 400, 'VALIDATION_ERROR');
    const serialNumber = trimStr(req.body.serialNumber) || null;
    const imei = trimStr(req.body.imei) || null;
    if (serialNumber) {
      const clash = await LogisticsStockItem.findOne({ serialNumber, isDeleted: false });
      if (clash) {
        throw new AppError(`Serial “${serialNumber}” already exists`, 400, 'DUPLICATE_SERIAL');
      }
    }
    if (imei) {
      const clash = await LogisticsStockItem.findOne({ imei, isDeleted: false });
      if (clash) throw new AppError(`IMEI “${imei}” already exists`, 400, 'DUPLICATE_IMEI');
    }
    const quantity = Number(req.body.quantity);
    const productType =
      resolveProductType(req.body.productType) || trimStr(req.body.productType) || '';
    const row = await LogisticsStockItem.create({
      sku: trimStr(req.body.sku).toUpperCase(),
      name,
      serialNumber,
      imei,
      batchNumber: trimStr(req.body.batchNumber) || null,
      categoryId: req.body.categoryId || null,
      uomId: req.body.uomId || null,
      warehouseId: req.body.warehouseId || null,
      locationId: req.body.locationId || null,
      productType,
      status: trimStr(req.body.status) || 'Available',
      quantity: Number.isFinite(quantity) && quantity > 0 ? quantity : 1,
      unitValue: Number(req.body.unitValue) || 0,
      lowStockThreshold: Number(req.body.lowStockThreshold) || 0,
      tyloAssetId: null,
      remarks: trimStr(req.body.remarks),
      isActive: true,
    });

    await LogisticsLedgerEntry.create({
      stockItemId: row._id,
      movementTypeCode: 'ADJUST_IN',
      direction: 'IN',
      quantityDelta: row.quantity,
      warehouseId: row.warehouseId,
      locationId: row.locationId,
      referenceType: 'MANUAL_OPENING',
      remarks: 'Opening balance (Phase 1)',
      actorId: req.user._id,
      actorEmail: req.user.email,
      at: new Date().toISOString(),
    });

    await writeAudit({
      actorId: req.user._id,
      actorEmail: req.user.email,
      action: 'LogisticsStockItem.CREATE',
      entityType: 'LogisticsStockItem',
      entityId: row._id,
      after: row.toObject ? row.toObject() : row,
      requestId: req.requestId,
    });

    res.status(201).json({ data: row });
  })
);

router.patch(
  '/inventory/:id',
  canWrite,
  asyncHandler(async (req, res) => {
    const row = await LogisticsStockItem.findOne({ _id: req.params.id, isDeleted: false });
    if (!row) throw new AppError('Stock item not found', 404);

    if (req.body.serialNumber != null) {
      const serialNumber = trimStr(req.body.serialNumber) || null;
      if (serialNumber && serialNumber !== row.serialNumber) {
        const clash = await LogisticsStockItem.findOne({ serialNumber, isDeleted: false });
        if (clash && String(clash._id) !== String(row._id)) {
          throw new AppError(`Serial “${serialNumber}” already exists`, 400, 'DUPLICATE_SERIAL');
        }
      }
      row.serialNumber = serialNumber;
    }
    if (req.body.imei != null) {
      const imei = trimStr(req.body.imei) || null;
      if (imei && imei !== row.imei) {
        const clash = await LogisticsStockItem.findOne({ imei, isDeleted: false });
        if (clash && String(clash._id) !== String(row._id)) {
          throw new AppError(`IMEI “${imei}” already exists`, 400, 'DUPLICATE_IMEI');
        }
      }
      row.imei = imei;
    }

    const fields = [
      'sku',
      'name',
      'batchNumber',
      'categoryId',
      'uomId',
      'warehouseId',
      'locationId',
      'status',
      'remarks',
    ];
    for (const f of fields) {
      if (req.body[f] !== undefined) {
        row[f] = typeof req.body[f] === 'string' ? trimStr(req.body[f]) : req.body[f];
      }
    }
    if (req.body.quantity != null) {
      const q = Number(req.body.quantity);
      if (!Number.isFinite(q) || q < 0) throw new AppError('Invalid quantity', 400, 'VALIDATION_ERROR');
      row.quantity = q;
    }
    if (req.body.unitValue != null) row.unitValue = Number(req.body.unitValue) || 0;
    if (req.body.lowStockThreshold != null) {
      row.lowStockThreshold = Number(req.body.lowStockThreshold) || 0;
    }
    if (req.body.sku != null) row.sku = trimStr(req.body.sku).toUpperCase();

    await row.save();
    await writeAudit({
      actorId: req.user._id,
      actorEmail: req.user.email,
      action: 'LogisticsStockItem.UPDATE',
      entityType: 'LogisticsStockItem',
      entityId: row._id,
      after: row.toObject ? row.toObject() : row,
      requestId: req.requestId,
    });
    res.json({ data: row });
  })
);

router.get(
  '/inventory/:id/ledger',
  canRead,
  asyncHandler(async (req, res) => {
    const rows = await LogisticsLedgerEntry.find({ stockItemId: req.params.id })
      .sort('-at')
      .limit(200);
    res.json({ data: rows });
  })
);

export default router;

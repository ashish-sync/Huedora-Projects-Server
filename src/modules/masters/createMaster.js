import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { v4 as uuid } from 'uuid';
import { AppError } from '../../utils/helpers.js';
import { nextSequence } from '../../utils/counters.js';
import { throwIfIdentityClash, assertValidEmail, assertValidPhone, normalizePhone } from '../../utils/identityNormalize.js';
import { writeAudit } from '../../utils/audit.js';
import {
  LOCATION_LEVELS,
  IN_OUT_PRODUCT_TYPES,
  IN_OUT_PRODUCT_TYPE_ALIASES,
  PRODUCT_TYPE_CODE_PREFIX,
  PRODUCT_CODE_FORMAT,
  PRODUCT_INVENTORY_TYPES,
  PRODUCT_INVENTORY_TYPE_ALIASES,
  PRODUCT_TRACKING_KINDS,
  PRODUCT_CATEGORY_DEFAULTS,
} from '../logistics/logistics.constants.js';
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
} from '../logistics/logistics.model.js';
import { Contact, normalizeContactPayload } from '../contacts/contact.model.js';
import { assertContactIdentityAvailable } from '../contacts/contactIdentity.js';
import { GeoCity, GeoDistrict, GeoPinCode, GeoState } from '../geo/geo.model.js';
import { DocumentTemplate } from '../templates/template.model.js';
import { analyzeDocx, writeBuffer } from '../templates/docxPlaceholders.js';
import {
  SignatureMaster,
  normalizeSignaturePayload,
} from '../signatures/signature.model.js';
import { PERMISSIONS } from '../../config/constants.js';
import { moduleForEntity, validateMasterAddPayload } from './masterCatalog.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const templateRoot = path.resolve(__dirname, '../../../uploads/templates');
fs.mkdirSync(templateRoot, { recursive: true });

function trimStr(v) {
  return v == null ? '' : String(v).trim();
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

function resolveProductType(raw) {
  const s = trimStr(raw);
  if (!s) return '';
  if (IN_OUT_PRODUCT_TYPES.includes(s)) return s;
  return IN_OUT_PRODUCT_TYPE_ALIASES[s] || '';
}

function resolveInventoryType(raw) {
  const s = trimStr(raw);
  if (!s) return '';
  if (PRODUCT_INVENTORY_TYPES.includes(s)) return s;
  return PRODUCT_INVENTORY_TYPE_ALIASES[s] || '';
}

async function allocateCode(pathKey, prefix, Model, listFilter = {}, codeFormat = null) {
  let allocated = '';
  for (let attempt = 0; attempt < 8; attempt += 1) {
    allocated = await nextSequence(
      `logistics.${pathKey}.${prefix}`,
      prefix,
      codeFormat || undefined
    );
    const clash = await Model.findOne({
      code: allocated,
      isDeleted: false,
      ...listFilter,
    });
    if (!clash) return allocated;
    allocated = '';
  }
  throw new AppError('Could not allocate a unique code', 500, 'CODE_ALLOCATION');
}

async function allocateSku(Model) {
  let allocatedSku = '';
  for (let attempt = 0; attempt < 8; attempt += 1) {
    allocatedSku = await nextSequence('logistics.products.sku', 'SKU');
    const clash = await Model.findOne({ sku: allocatedSku, isDeleted: false });
    if (!clash) return allocatedSku;
    allocatedSku = '';
  }
  throw new AppError('Could not allocate a unique SKU', 500, 'SKU_ALLOCATION');
}

async function assertPartyIdentity(Model, body, listFilter = {}) {
  if (!body.email && !body.phone) return;
  const rows = await Model.find({ isDeleted: false, ...listFilter }).limit(20000);
  throwIfIdentityClash(rows, {
    email: body.email,
    phone: body.phone,
    emailFields: ['email'],
    phoneFields: ['phone'],
    label: 'Record',
  });
}

/**
 * Check whether actor may approve/create this master family.
 */
export function assertMasterWritePermission(userPermissions, entityId) {
  const module = moduleForEntity(entityId);
  const perms = userPermissions instanceof Set ? userPermissions : new Set(userPermissions || []);
  if (perms.has(PERMISSIONS.ALL) || perms.has('*')) return;
  if (module === 'document') {
    if (!perms.has(PERMISSIONS.AGREEMENTS_WRITE)) {
      throw new AppError(
        'Approving a Master One Request for Document One requires agreements:write',
        403,
        'FORBIDDEN'
      );
    }
    return;
  }
  if (!perms.has(PERMISSIONS.LOGISTICS_MASTER) && !perms.has(PERMISSIONS.LOGISTICS_WRITE)) {
    throw new AppError(
      'Approving a Master One Request for inventory or movements requires Master One write access',
      403,
      'FORBIDDEN'
    );
  }
}

async function createLogisticsRow({
  pathKey,
  Model,
  entityType,
  required,
  codePrefix,
  resolveCodePrefix,
  codeFormat = null,
  skuPrefix,
  listFilter,
  checkIdentity,
  normalize,
  payload,
  actor,
  requestId,
}) {
  const body = normalize(payload);
  for (const key of required) {
    if (!trimStr(body[key])) {
      throw new AppError(`${key} is required`, 400, 'VALIDATION_ERROR');
    }
  }
  const prefix =
    (typeof resolveCodePrefix === 'function' ? resolveCodePrefix(body) : null) || codePrefix;
  if (prefix) {
    body.code = await allocateCode(pathKey, prefix, Model, listFilter || {}, codeFormat);
  }
  if (skuPrefix) {
    body.sku = await allocateSku(Model);
  }
  if (checkIdentity) {
    await assertPartyIdentity(Model, body, listFilter || {});
  }
  const row = await Model.create({ ...body, isActive: body.isActive !== false });
  await writeAudit({
    actorId: actor._id,
    actorEmail: actor.email,
    action: `${entityType}.CREATE`,
    entityType,
    entityId: row._id,
    after: row.toObject ? row.toObject() : row,
    requestId,
  });
  return row;
}

function normalizeProduct(b) {
  const productType = resolveProductType(b.productType) || 'Other';
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
  let trackingKind = trimStr(b.trackingKind) || defaults.trackingKind;
  if (!PRODUCT_TRACKING_KINDS.includes(trackingKind)) trackingKind = defaults.trackingKind;
  let inventoryType =
    resolveInventoryType(b.inventoryType) || defaults.inventoryType || 'Multi-use';
  if (!PRODUCT_INVENTORY_TYPES.includes(inventoryType)) {
    inventoryType = defaults.inventoryType || 'Multi-use';
  }
  const brand = trimStr(b.brand) || trimStr(b.manufacturer);
  const manufacturer = trimStr(b.manufacturer) || brand;
  const modelOrPart = trimStr(b.model || b.partNumber || b.name || '');
  const standardCost = toNum(b.purchaseCost ?? b.standardCost, 0);
  const shelfLifeMonths = toNum(b.shelfLifeMonths, 0);
  return {
    name: modelOrPart,
    categoryId: b.categoryId || null,
    brand,
    manufacturer,
    description: trimStr(b.description || ''),
    image: null,
    isActive: b.isActive !== false,
    productType,
    inventoryType,
    trackingKind,
    uomId: b.uomId || null,
    unitsPerPack: Math.max(1, toNum(b.unitsPerPack, 1)),
    gstRate: toNum(b.gstRate, 0),
    minStock: toNum(b.minStock, 0),
    maxStock: toNum(b.maxStock, 0),
    shelfLifeMonths,
    shelfLifeDays: Math.round(shelfLifeMonths * 30),
    expiryApplicable: asBool(b.expiryApplicable, defaults.expiryApplicable),
    linkedDeviceId: b.linkedDeviceId || null,
    standardCost,
    lastPurchaseCost: standardCost,
    defaultPerUnitCost: toNum(b.defaultPerUnitCost, standardCost),
    defaultInvoiceAmount: toNum(b.defaultInvoiceAmount, 0),
    model: modelOrPart,
    partNumber: modelOrPart,
    programProject: trimStr(b.programProject || ''),
    documents: {
      datasheet: null,
      userManual: null,
      warranty: null,
      compliance: null,
      sop: null,
      images: [],
    },
  };
}

async function createContact(payload, actor, requestId) {
  const normalized = normalizeContactPayload(payload, { validate: true });
  if (normalized.email) {
    assertValidEmail(normalized.email, 'Email');
  }
  if (normalized.contact) {
    assertValidPhone(normalized.contact, 'Mobile number');
    normalized.contact = normalizePhone(normalized.contact);
    normalized.mobile = normalized.contact;
  }
  await assertContactIdentityAvailable({
    email: normalized.email,
    phone: normalized.contact || normalized.mobile,
  });
  const contact = await Contact.create({
    ...normalized,
    createdBy: actor._id,
    updatedBy: actor._id,
  });
  await writeAudit({
    actorId: actor._id,
    actorEmail: actor.email,
    action: 'CONTACT.CREATE',
    entityType: 'Contact',
    entityId: contact._id,
    after: contact.toObject ? contact.toObject() : contact,
    requestId,
  });
  return contact;
}

async function createPinCode(payload, actor, requestId) {
  const pinCode = String(payload.pinCode || '').replace(/\D+/g, '');
  if (!/^\d{6}$/.test(pinCode)) {
    throw new AppError('PIN code must be a 6-digit number', 400, 'VALIDATION_ERROR');
  }
  const cityId = payload.cityId;
  const city = cityId ? await GeoCity.findOne({ _id: cityId, isDeleted: false }) : null;
  if (!city) throw new AppError('City is required for a PIN mapping', 400, 'VALIDATION_ERROR');
  let district = null;
  if (payload.districtId) {
    district = await GeoDistrict.findOne({ _id: payload.districtId, isDeleted: false });
  }
  const sId = payload.stateId || city.stateId;
  const state = sId ? await GeoState.findOne({ _id: sId, isDeleted: false }) : null;
  if (!state) throw new AppError('State is required for a PIN mapping', 400, 'VALIDATION_ERROR');

  const dup = await GeoPinCode.findOne({ pinCode, cityId: city._id, isDeleted: false });
  if (dup) throw new AppError('This PIN is already mapped to that city', 409, 'DUPLICATE_PIN');

  const row = await GeoPinCode.create({
    pinCode,
    cityId: city._id,
    cityName: city.name,
    districtId: district?._id || city.districtId || null,
    districtName: district?.name || '',
    stateId: state._id,
    stateName: state.name,
    locality: trimStr(payload.locality),
    notes: trimStr(payload.notes),
    isActive: true,
    createdBy: actor._id,
    updatedBy: actor._id,
  });
  await writeAudit({
    actorId: actor._id,
    actorEmail: actor.email,
    action: 'GEO_PIN.CREATE',
    entityType: 'GeoPinCode',
    entityId: row._id,
    after: row.toObject ? row.toObject() : row,
    requestId,
  });
  return row;
}

async function createTemplate(payload, fileBuffer, originalName, actor, requestId) {
  if (!fileBuffer || !Buffer.isBuffer(fileBuffer)) {
    throw new AppError('Word (.docx) file is required for a template', 400, 'VALIDATION_ERROR');
  }
  const name = trimStr(payload.name);
  if (!name) throw new AppError('Template name is required', 400, 'VALIDATION_ERROR');
  const documentType = trimStr(payload.documentType) || 'LEASE';
  const signingType =
    String(payload.signingType || '').toUpperCase() === 'NON_SIGNING' ? 'NON_SIGNING' : 'SIGNING';

  const analysis = await analyzeDocx(fileBuffer);
  const safeName = String(originalName || 'template.docx').replace(/[^a-zA-Z0-9._-]/g, '_');
  const storageKey = `${uuid()}-${safeName}`;
  writeBuffer(path.join(templateRoot, storageKey), fileBuffer);

  const tpl = await DocumentTemplate.create({
    name,
    category: 'AGREEMENT',
    agreementType: documentType === 'TEMPORARY_OWNERSHIP' ? 'TEMPORARY_OWNERSHIP' : 'LEASE',
    documentType,
    signingType,
    description: `${signingType === 'SIGNING' ? 'Signing' : 'Non-signing'} · ${documentType}`,
    bodyHtml: analysis.plain,
    sourceType: 'DOCX',
    originalFileName: originalName || 'template.docx',
    storageKey,
    contentType:
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    placeholders: analysis.placeholders,
    isActive: true,
    createdBy: actor._id,
  });
  await writeAudit({
    actorId: actor._id,
    actorEmail: actor.email,
    action: 'DOCUMENT_TEMPLATE.CREATE',
    entityType: 'DocumentTemplate',
    entityId: tpl._id,
    after: { name: tpl.name, documentType: tpl.documentType },
    requestId,
  });
  return tpl;
}

async function createSignature(payload, actor, requestId, { asAdmin = false } = {}) {
  const body = {
    ...payload,
    signatureType: 'TYPED',
    typedName: payload.typedName || payload.signatureData || payload.name,
  };
  const normalized = normalizeSignaturePayload(body);
  if (!normalized.name) throw new AppError('Name is required', 400, 'VALIDATION_ERROR');
  if (!normalized.roleLabel) throw new AppError('Role is required', 400, 'VALIDATION_ERROR');
  if (!normalized.signatureData) {
    throw new AppError('Typed signature name is required', 400, 'VALIDATION_ERROR');
  }

  if (!asAdmin) {
    const existing = await SignatureMaster.countDocuments({
      createdBy: actor._id,
      isDeleted: false,
    });
    if (existing >= 1) {
      throw new AppError(
        'This user already has a signature. Edit or replace it in Master One.',
        400,
        'LIMIT'
      );
    }
  }

  const row = await SignatureMaster.create({
    ...normalized,
    createdBy: actor._id,
    updatedBy: actor._id,
  });
  await writeAudit({
    actorId: actor._id,
    actorEmail: actor.email,
    action: 'SIGNATURE_MASTER.CREATE',
    entityType: 'SignatureMaster',
    entityId: row._id,
    after: { name: row.name, roleLabel: row.roleLabel },
    requestId,
  });
  return row;
}

/**
 * Create a master record from a MASTER_ADD request payload.
 * @returns {{ row: object, code: string, id: string }}
 */
export async function createMasterFromPayload({
  entityId,
  payload = {},
  actor,
  requestId,
  fileBuffer = null,
  fileName = '',
  ownerUser = null,
}) {
  const err = validateMasterAddPayload(entityId, payload);
  if (err) throw new AppError(err, 400, 'VALIDATION_ERROR');

  let row;
  switch (entityId) {
    case 'warehouses':
      row = await createLogisticsRow({
        pathKey: 'warehouses',
        Model: LogisticsWarehouse,
        entityType: 'LogisticsWarehouse',
        required: ['name'],
        codePrefix: 'WH',
        normalize: (b) => ({
          name: trimStr(b.name),
          city: trimStr(b.city),
          state: trimStr(b.state),
          address: trimStr(b.address),
          isActive: true,
        }),
        payload,
        actor,
        requestId,
      });
      break;
    case 'locations':
      row = await createLogisticsRow({
        pathKey: 'locations',
        Model: LogisticsLocation,
        entityType: 'LogisticsLocation',
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
            name: trimStr(b.name),
            isActive: true,
          };
        },
        payload,
        actor,
        requestId,
      });
      break;
    case 'parties':
    case 'suppliers':
    case 'vendors': {
      const wantType =
        entityId === 'vendors'
          ? 'Vendor'
          : entityId === 'suppliers'
            ? 'Supplier'
            : trimStr(payload.partyType) === 'Vendor'
              ? 'Vendor'
              : 'Supplier';
      row = await createLogisticsRow({
        pathKey: 'parties',
        Model: LogisticsSupplier,
        entityType: wantType === 'Vendor' ? 'LogisticsVendor' : 'LogisticsSupplier',
        required: ['name'],
        resolveCodePrefix: () => (wantType === 'Vendor' ? 'VEN' : 'SUP'),
        checkIdentity: true,
        normalize: (b) => ({
          name: trimStr(b.name),
          partyType: wantType,
          contactName: trimStr(b.contactName),
          email: trimStr(b.email).toLowerCase(),
          phone: trimStr(b.phone),
          city: trimStr(b.city),
          state: trimStr(b.state),
          gstin: trimStr(b.gstin).toUpperCase(),
          panCard: trimStr(b.panCard).toUpperCase(),
          isActive: true,
        }),
        payload,
        actor,
        requestId,
      });
      break;
    }
    case 'transporters':
      row = await createLogisticsRow({
        pathKey: 'transporters',
        Model: LogisticsTransporter,
        entityType: 'LogisticsTransporter',
        required: ['name'],
        codePrefix: 'TRN',
        checkIdentity: true,
        normalize: (b) => ({
          name: trimStr(b.name),
          contactName: trimStr(b.contactName),
          email: trimStr(b.email).toLowerCase(),
          phone: trimStr(b.phone),
          isActive: true,
        }),
        payload,
        actor,
        requestId,
      });
      break;
    case 'categories':
      row = await createLogisticsRow({
        pathKey: 'categories',
        Model: LogisticsCategory,
        entityType: 'LogisticsCategory',
        required: ['name'],
        codePrefix: 'CAT',
        normalize: (b) => ({
          name: trimStr(b.name),
          description: trimStr(b.description),
          isActive: true,
        }),
        payload,
        actor,
        requestId,
      });
      break;
    case 'products':
      row = await createLogisticsRow({
        pathKey: 'products',
        Model: LogisticsProduct,
        entityType: 'LogisticsProduct',
        required: ['name', 'productType', 'brand'],
        resolveCodePrefix: (body) =>
          PRODUCT_TYPE_CODE_PREFIX[body.productType] || PRODUCT_TYPE_CODE_PREFIX.Other || 'OT',
        codeFormat: PRODUCT_CODE_FORMAT,
        skuPrefix: 'SKU',
        normalize: normalizeProduct,
        payload,
        actor,
        requestId,
      });
      break;
    case 'uoms':
      row = await createLogisticsRow({
        pathKey: 'uoms',
        Model: LogisticsUom,
        entityType: 'LogisticsUom',
        required: ['name'],
        codePrefix: 'UOM',
        normalize: (b) => ({ name: trimStr(b.name), isActive: true }),
        payload,
        actor,
        requestId,
      });
      break;
    case 'stock-statuses':
      row = await createLogisticsRow({
        pathKey: 'stock-statuses',
        Model: LogisticsStockStatus,
        entityType: 'LogisticsStockStatus',
        required: ['name'],
        codePrefix: 'STS',
        normalize: (b) => ({ name: trimStr(b.name), isActive: true }),
        payload,
        actor,
        requestId,
      });
      break;
    case 'movement-types':
      row = await createLogisticsRow({
        pathKey: 'movement-types',
        Model: LogisticsMovementType,
        entityType: 'LogisticsMovementType',
        required: ['name'],
        codePrefix: 'MVT',
        normalize: (b) => ({
          name: trimStr(b.name),
          direction: String(b.direction || 'IN').toUpperCase() === 'OUT' ? 'OUT' : 'IN',
          isActive: true,
        }),
        payload,
        actor,
        requestId,
      });
      break;
    case 'reason-codes':
      row = await createLogisticsRow({
        pathKey: 'reason-codes',
        Model: LogisticsReasonCode,
        entityType: 'LogisticsReasonCode',
        required: ['name'],
        codePrefix: 'RSN',
        normalize: (b) => ({ name: trimStr(b.name), isActive: true }),
        payload,
        actor,
        requestId,
      });
      break;
    case 'expense-categories':
      row = await createLogisticsRow({
        pathKey: 'expense-categories',
        Model: LogisticsExpenseCategory,
        entityType: 'LogisticsExpenseCategory',
        required: ['name'],
        codePrefix: 'EXP',
        normalize: (b) => ({
          name: trimStr(b.name),
          covers: trimStr(b.covers),
          isActive: true,
        }),
        payload,
        actor,
        requestId,
      });
      break;
    case 'contacts':
      row = await createContact(payload, actor, requestId);
      break;
    case 'pin-codes':
      row = await createPinCode(payload, actor, requestId);
      break;
    case 'templates':
      row = await createTemplate(payload, fileBuffer, fileName, actor, requestId);
      break;
    case 'signatures': {
      const owner = ownerUser || actor;
      const perms = actor.permissions instanceof Set ? actor.permissions : new Set(actor.permissions || []);
      const asAdmin = perms.has(PERMISSIONS.ALL) || perms.has('*');
      row = await createSignature(payload, owner, requestId, { asAdmin });
      break;
    }
    default:
      throw new AppError('Unknown master entity', 400, 'VALIDATION_ERROR');
  }

  return {
    row,
    id: row._id,
    code: row.code || row.pinCode || row.name || String(row._id),
  };
}

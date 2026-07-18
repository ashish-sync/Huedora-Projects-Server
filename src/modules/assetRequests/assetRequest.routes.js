import { Router } from 'express';
import path from 'path';
import { createHash, randomBytes } from 'crypto';
import { authenticate, requirePermission } from '../../middleware/auth.js';
import { asyncHandler, parsePagination, paginated, AppError } from '../../utils/helpers.js';
import { PERMISSIONS } from '../../config/constants.js';
import {
  AssetRequest,
  AssetRequestUploadInvite,
  ALL_REQUEST_TYPES,
  ASSET_REQUIRED_TYPES,
  LOGISTICS_KINDS,
  LOGISTICS_MODES,
  OTHER_REQUEST_OPTIONS,
  HIRING_TYPES,
  HIRING_HCW_TYPES,
  HIRING_CAMP_TYPES,
  HIRING_METHODS,
  normalizeRequestType,
  typeLabel,
} from './assetRequest.model.js';
import { Asset } from '../assets/asset.model.js';
import { AssetEvent } from '../assets/assetEvent.model.js';
import { Contact } from '../contacts/contact.model.js';
import {
  LogisticsExpenseCategory,
  LogisticsProduct,
} from '../logistics/logistics.model.js';
import {
  IN_OUT_PRODUCT_TYPES,
  IN_OUT_PRODUCT_TYPE_ALIASES,
} from '../logistics/logistics.constants.js';
import { nextSequence } from '../../utils/counters.js';
import { writeAudit } from '../../utils/audit.js';
import { Notification } from '../notifications/notification.model.js';
import { User } from '../users/user.model.js';
import { Role } from '../users/role.model.js';
import { sendExcel } from '../../utils/excelExport.js';
import {
  productPhotoUpload,
  reimbursementBillUpload,
  requestAttachmentUpload,
  imageMetadata,
  existingImageFilePath,
  existingAttachmentFilePath,
  removeImageFile,
  removeAttachmentFile,
} from './productImage.js';

const router = Router();
router.use(authenticate);

const canRead = requirePermission(
  PERMISSIONS.ASSET_REQUESTS_READ,
  PERMISSIONS.ASSET_REQUESTS_REQUEST,
  PERMISSIONS.ASSET_REQUESTS_APPROVE,
  PERMISSIONS.MOVEMENTS_READ,
  PERMISSIONS.REPAIRS_READ
);
const canRequest = requirePermission(
  PERMISSIONS.ASSET_REQUESTS_REQUEST,
  PERMISSIONS.MOVEMENTS_REQUEST,
  PERMISSIONS.REPAIRS_WRITE,
  PERMISSIONS.MAINTENANCE_WRITE
);
const canApprove = requirePermission(
  PERMISSIONS.ASSET_REQUESTS_APPROVE,
  PERMISSIONS.MOVEMENTS_APPROVE
);

function hasAnyPermission(req, permissions) {
  return (
    req.permissions?.has(PERMISSIONS.ALL) ||
    permissions.some((permission) => req.permissions?.has(permission))
  );
}

function assertCreatePermission(req, requestType) {
  const permissions = [PERMISSIONS.ASSET_REQUESTS_REQUEST];
  if (requestType === 'REPAIR') permissions.push(PERMISSIONS.REPAIRS_WRITE);
  else if (requestType === 'MAINTENANCE') permissions.push(PERMISSIONS.MAINTENANCE_WRITE);
  else if (requestType === 'LOGISTICS') permissions.push(PERMISSIONS.MOVEMENTS_REQUEST);
  if (!hasAnyPermission(req, permissions)) {
    throw new AppError('Forbidden for this request type', 403, 'FORBIDDEN');
  }
}

function isRequestOwner(req, row) {
  return String(row.requestorId?._id || row.requestorId) === String(req.user._id);
}

function canManageRequest(req, row) {
  return (
    isRequestOwner(req, row) ||
    hasAnyPermission(req, [PERMISSIONS.ASSET_REQUESTS_APPROVE])
  );
}

function assertProductImageAccess(req, row) {
  if (!['REPAIR', 'MAINTENANCE'].includes(row.requestType)) {
    throw new AppError(
      'Product images are only available for Repair and Maintenance requests',
      400,
      'INVALID_REQUEST_TYPE'
    );
  }
  if (!['REQUESTED', 'APPROVED'].includes(row.status)) {
    throw new AppError('Request is no longer active', 409, 'INVALID_STATUS');
  }
  if (!canManageRequest(req, row)) {
    throw new AppError('Forbidden', 403, 'FORBIDDEN');
  }
}

function assertBillAccess(req, row) {
  if (row.requestType !== 'REIMBURSEMENT') {
    throw new AppError(
      'Bills are only available for Reimbursement requests',
      400,
      'INVALID_REQUEST_TYPE'
    );
  }
  if (!['REQUESTED', 'APPROVED'].includes(row.status)) {
    throw new AppError('Request is no longer active', 409, 'INVALID_STATUS');
  }
  if (!canManageRequest(req, row)) {
    throw new AppError('Forbidden', 403, 'FORBIDDEN');
  }
}

function assertOtherAttachmentAccess(req, row) {
  if (row.requestType !== 'OTHER') {
    throw new AppError(
      'Attachments are only available here for Others requests',
      400,
      'INVALID_REQUEST_TYPE'
    );
  }
  if (!['REQUESTED', 'APPROVED'].includes(row.status)) {
    throw new AppError('Request is no longer active', 409, 'INVALID_STATUS');
  }
  if (!canManageRequest(req, row)) {
    throw new AppError('Forbidden', 403, 'FORBIDDEN');
  }
}

function contactIdOf(asset) {
  if (!asset) return null;
  const raw = asset.contactId || asset.hcwId;
  if (!raw) return null;
  if (typeof raw === 'object') return raw._id || raw.id || null;
  return raw;
}

async function buildLinkedSnapshot(assetId) {
  const asset = await Asset.findOne({ _id: assetId, isDeleted: false });
  if (!asset) throw new AppError('Asset not found', 404);

  const cid = contactIdOf(asset);
  let contact = null;
  if (cid) {
    contact = await Contact.findOne({ _id: cid, isDeleted: false });
  }

  return {
    assetId: asset._id,
    assetTag: asset.assetTag || null,
    serialNumber: asset.serialNumber || null,
    assetName: asset.deviceNameSnapshot || asset.name || '',
    assetCustody: asset.custody || '',
    custodianState: asset.custodianState || asset.location?.state || contact?.state || '',
    custodianName: asset.custodianName || contact?.name || '',
    custodianContact: asset.custodianContact || contact?.contact || contact?.mobile || '',
    custodianCity: asset.custodianCity || asset.location?.city || contact?.city || '',
    contactId: contact?._id || cid || null,
    fromStatus: asset.status,
  };
}

function emptyLinkedSnapshot() {
  return {
    assetId: null,
    assetTag: null,
    serialNumber: null,
    assetName: '',
    assetCustody: '',
    custodianState: '',
    custodianName: '',
    custodianContact: '',
    custodianCity: '',
    contactId: null,
    fromStatus: null,
  };
}

function trim(value) {
  return value == null ? '' : String(value).trim();
}

async function resolveContact(contactId, label) {
  if (!contactId) return null;
  const contact = await Contact.findOne({ _id: contactId, isDeleted: false });
  if (!contact) {
    throw new AppError(`${label} contact not found`, 400, 'VALIDATION_ERROR');
  }
  return contact;
}

function endpointSnapshot(prefix, body, contact, fallback = {}) {
  return {
    [`${prefix}ContactId`]: contact?._id || body[`${prefix}ContactId`] || fallback.contactId || null,
    [`${prefix}State`]: trim(body[`${prefix}State`]) || contact?.state || fallback.state || '',
    [`${prefix}City`]: trim(body[`${prefix}City`]) || contact?.city || fallback.city || '',
    [`${prefix}Name`]: trim(body[`${prefix}Name`]) || contact?.name || fallback.name || '',
    [`${prefix}Number`]:
      trim(body[`${prefix}Number`]) ||
      contact?.contact ||
      contact?.mobile ||
      fallback.number ||
      '',
    [`${prefix}PinCode`]:
      trim(body[`${prefix}PinCode`]) || contact?.pinCode || fallback.pinCode || '',
    [`${prefix}Address`]:
      trim(body[`${prefix}Address`]) || contact?.address || fallback.address || '',
  };
}

function hasEndpoint(snapshot, prefix) {
  return Boolean(snapshot[`${prefix}ContactId`] || snapshot[`${prefix}Name`]);
}

function logisticsFlow(kind) {
  const normalized = trim(kind).toLowerCase().replace(/[^a-z]/g, '');
  if (['intertransfer', 'transfer', 'interlocationtransfer'].includes(normalized)) {
    return 'INTER_TRANSFER';
  }
  if (['freshdispatch', 'dispatch', 'delivery'].includes(normalized)) {
    return 'FRESH_DISPATCH';
  }
  if (['recallpickup', 'recall', 'pickup', 'return'].includes(normalized)) {
    return 'RECALL_PICKUP';
  }
  return null;
}

const ASSET_LINKED_PRODUCT_TYPES = new Set([
  'Medical Device',
  'Non-Medical Device',
]);

function normalizeLogisticsProductType(raw) {
  const value = trim(raw);
  const canonical = IN_OUT_PRODUCT_TYPES.find(
    (item) => item.toLowerCase() === value.toLowerCase()
  );
  if (canonical) return canonical;
  const alias = Object.entries(IN_OUT_PRODUCT_TYPE_ALIASES).find(
    ([key]) => key.toLowerCase() === value.toLowerCase()
  );
  return alias?.[1] || null;
}

async function normalizeLogisticsProducts(rawProducts) {
  if (!Array.isArray(rawProducts) || !rawProducts.length) {
    throw new AppError(
      'At least one logistics product is required',
      400,
      'VALIDATION_ERROR'
    );
  }

  const products = [];
  const lineIds = new Set();
  const productKeys = new Set();
  for (let index = 0; index < rawProducts.length; index += 1) {
    const input = rawProducts[index];
    if (!input || typeof input !== 'object' || Array.isArray(input)) {
      throw new AppError(
        `Logistics product ${index + 1} is invalid`,
        400,
        'VALIDATION_ERROR'
      );
    }

    const productId = trim(input.productId) || null;
    const qty = Number(input.qty);
    if (!Number.isFinite(qty) || qty <= 0) {
      throw new AppError(
        `Logistics product ${index + 1} quantity must be greater than zero`,
        400,
        'VALIDATION_ERROR'
      );
    }

    let productType;
    let productName;
    let canonicalProductId = null;
    if (productId) {
      const product = await LogisticsProduct.findOne({
        _id: productId,
        isDeleted: false,
        isActive: true,
      });
      if (!product) {
        throw new AppError(
          `Logistics product ${index + 1} references an invalid product`,
          400,
          'VALIDATION_ERROR'
        );
      }
      canonicalProductId = product._id;
      productType = normalizeLogisticsProductType(product.productType);
      productName = trim(product.name);
    } else {
      productType = normalizeLogisticsProductType(input.productType);
      productName = trim(input.productName);
    }

    if (!productType || !IN_OUT_PRODUCT_TYPES.includes(productType)) {
      throw new AppError(
        `Logistics product ${index + 1} type must be one of: ${IN_OUT_PRODUCT_TYPES.join(', ')}`,
        400,
        'VALIDATION_ERROR'
      );
    }
    if (!productName) {
      throw new AppError(
        `Logistics product ${index + 1} requires a product name or valid productId`,
        400,
        'VALIDATION_ERROR'
      );
    }

    const productKey = canonicalProductId
      ? `id:${String(canonicalProductId)}`
      : `name:${productType.toLowerCase()}:${productName.toLowerCase()}`;
    if (productKeys.has(productKey)) {
      throw new AppError(
        `The same logistics product cannot be added more than once`,
        400,
        'DUPLICATE_PRODUCT'
      );
    }
    productKeys.add(productKey);

    const lineId = trim(input.lineId) || randomBytes(12).toString('hex');
    if (lineIds.has(lineId)) {
      throw new AppError(
        `Logistics product ${index + 1} has a duplicate lineId`,
        400,
        'VALIDATION_ERROR'
      );
    }
    lineIds.add(lineId);
    products.push({
      lineId,
      productType,
      productId: canonicalProductId,
      productName,
      qty,
    });
  }
  return products;
}

function logisticsProductsNeedAsset(products) {
  return (products || []).some((item) =>
    ASSET_LINKED_PRODUCT_TYPES.has(item.productType)
  );
}

function productSummary(products) {
  return (products || [])
    .map((item) => `${item.productName} (${item.productType}) × ${item.qty}`)
    .join('; ');
}

function requestProductLineIds(row) {
  return (row.logisticsProducts || []).map(
    (item, index) => item.lineId || `legacy-line-${index + 1}`
  );
}

async function preferredVendorSnapshot(body) {
  const id = body.preferredVendorContactId || null;
  if (!id) {
    return {
      preferredVendorContactId: null,
      preferredVendor: trim(body.preferredVendor),
    };
  }
  const contact = await Contact.findOne({ _id: id, isDeleted: false });
  if (!contact || trim(contact.resourceType).toLowerCase() !== 'vendor') {
    throw new AppError(
      'Preferred vendor must reference an active Vendor contact',
      400,
      'VALIDATION_ERROR'
    );
  }
  return {
    preferredVendorContactId: contact._id,
    preferredVendor: trim(contact.organization) || trim(contact.name),
  };
}

function pickDetails(body = {}) {
  const num = (v) => {
    if (v === '' || v == null) return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  };
  return {
    priority: body.priority?.trim() || '',
    issueCategory: body.issueCategory?.trim() || '',
    maintenanceKind: body.maintenanceKind?.trim() || '',
    logisticsKind: body.logisticsKind?.trim() || '',
    preferredVendor: body.preferredVendor?.trim() || '',
    serviceProvider: body.serviceProvider?.trim() || '',
    expectedDate: body.expectedDate?.trim() || '',
    scheduledDate: body.scheduledDate?.trim() || '',
    preferredDate: body.preferredDate?.trim() || '',
    transportMode: body.transportMode?.trim() || '',
    trainingTopic: body.trainingTopic?.trim() || '',
    trainingMode: body.trainingMode?.trim() || '',
    venue: body.venue?.trim() || '',
    amount: num(body.amount),
    currency: body.currency?.trim() || 'INR',
    expenseCategory: body.expenseCategory?.trim() || '',
    payeeName: body.payeeName?.trim() || '',
    expenseDate: body.expenseDate?.trim() || '',
    hiringType: body.hiringType?.trim() || '',
    hcwType: body.hcwType?.trim() || '',
    campType: body.campType?.trim() || '',
    hiringMethod: body.hiringMethod?.trim() || '',
    engagementDateTime: body.engagementDateTime?.trim() || '',
    hiringAddress: body.hiringAddress?.trim() || '',
    hiringState: body.hiringState?.trim() || '',
    hiringCity: body.hiringCity?.trim() || '',
    hiringName: body.hiringName?.trim() || '',
    hiringPinCode: body.hiringPinCode?.trim() || '',
    budgetMin: num(body.budgetMin),
    budgetMax: num(body.budgetMax),
    otherCategory: body.otherCategory?.trim() || '',
    otherSubcategory: body.otherSubcategory?.trim() || '',
  };
}

function validateTypeDetails(requestType, details) {
  if (requestType === 'REPAIR' && !details.issueCategory) {
    throw new AppError('Issue category is required for Repair', 400, 'VALIDATION_ERROR');
  }
  if (requestType === 'MAINTENANCE' && !details.maintenanceKind) {
    throw new AppError('Maintenance kind is required', 400, 'VALIDATION_ERROR');
  }
  if (requestType === 'LOGISTICS') {
    if (!LOGISTICS_KINDS.includes(details.logisticsKind)) {
      throw new AppError(
        `Logistics kind must be one of: ${LOGISTICS_KINDS.join(', ')}`,
        400,
        'VALIDATION_ERROR'
      );
    }
    if (!LOGISTICS_MODES.includes(details.transportMode)) {
      throw new AppError(
        `Transport mode must be one of: ${LOGISTICS_MODES.join(', ')}`,
        400,
        'VALIDATION_ERROR'
      );
    }
  }
  if (requestType === 'TRAINING' && !details.trainingTopic) {
    throw new AppError('Training topic is required', 400, 'VALIDATION_ERROR');
  }
  if (requestType === 'REIMBURSEMENT') {
    if (details.amount == null || details.amount <= 0) {
      throw new AppError('Amount is required for Reimbursement', 400, 'VALIDATION_ERROR');
    }
    if (!details.expenseCategory) {
      throw new AppError('Expense category is required', 400, 'VALIDATION_ERROR');
    }
    if (!details.expenseDate) {
      throw new AppError('Expense date is required', 400, 'VALIDATION_ERROR');
    }
  }
  if (requestType === 'HIRING') {
    if (!HIRING_TYPES.includes(details.hiringType)) {
      throw new AppError('Select a valid Hiring type', 400, 'VALIDATION_ERROR');
    }
    if (!HIRING_HCW_TYPES.includes(details.hcwType)) {
      throw new AppError('Select a valid HCW type', 400, 'VALIDATION_ERROR');
    }
    if (!HIRING_CAMP_TYPES.includes(details.campType)) {
      throw new AppError('Select a valid Camp type', 400, 'VALIDATION_ERROR');
    }
    if (!HIRING_METHODS.includes(details.hiringMethod)) {
      throw new AppError('Select a valid Hiring method', 400, 'VALIDATION_ERROR');
    }
    if (
      !details.engagementDateTime ||
      !Number.isFinite(Date.parse(details.engagementDateTime))
    ) {
      throw new AppError('A valid engagement date and time is required', 400, 'VALIDATION_ERROR');
    }
    if (
      !details.hiringAddress ||
      !details.hiringState ||
      !details.hiringCity ||
      !details.hiringName
    ) {
      throw new AppError(
        'Name, address, state, and city are required',
        400,
        'VALIDATION_ERROR'
      );
    }
    if (!/^\d{6}$/.test(details.hiringPinCode)) {
      throw new AppError('Pin code must contain 6 digits', 400, 'VALIDATION_ERROR');
    }
    if (
      details.budgetMin == null ||
      details.budgetMax == null ||
      details.budgetMin < 0 ||
      details.budgetMax < details.budgetMin
    ) {
      throw new AppError(
        'Enter a valid budget range where maximum is not less than minimum',
        400,
        'VALIDATION_ERROR'
      );
    }
  }
  if (requestType === 'OTHER') {
    const allowedOptions = OTHER_REQUEST_OPTIONS[details.otherCategory];
    if (!allowedOptions) {
      throw new AppError('Select a valid Others category', 400, 'VALIDATION_ERROR');
    }
    if (!allowedOptions.includes(details.otherSubcategory)) {
      throw new AppError(
        'Select a valid request option for the chosen category',
        400,
        'VALIDATION_ERROR'
      );
    }
  }
}

async function notifyApprovers({ request, actorId, reason }) {
  const roles = await Role.find({ isDeleted: false });
  const roleById = new Map(roles.map((r) => [String(r._id), r]));

  const users = await User.find({ isDeleted: false, isActive: true });
  const approvers = users.filter((u) => {
    if (String(u._id) === String(actorId)) return false;
    const roleIds = (u.roleIds || []).map((id) => String(id?._id || id));
    return roleIds.some((rid) => {
      const role = roleById.get(rid);
      if (!role) return false;
      const perms = role.permissions || [];
      return (
        perms.includes(PERMISSIONS.ASSET_REQUESTS_APPROVE) ||
        perms.includes(PERMISSIONS.MOVEMENTS_APPROVE) ||
        role.name === 'Approver'
      );
    });
  });

  const label = typeLabel(request.requestType);
  const subject = request.assetName || request.trainingTopic || request.payeeName || 'Request';

  for (const a of approvers) {
    await Notification.create({
      userId: a._id,
      type: 'ASSET_REQUEST_APPROVAL',
      title: `${label} request ${request.requestNumber} needs approval`,
      body: reason || `${subject} · ${request.custodianName || '—'}`,
      entityType: 'AssetRequest',
      entityId: request._id,
    });
  }
}

function isLogistics(type) {
  return type === 'LOGISTICS' || type === 'MOVEMENT';
}

async function revokePendingUploadInvites(requestId) {
  await AssetRequestUploadInvite.updateMany(
    { requestId, status: 'PENDING' },
    { $set: { status: 'REVOKED' } }
  );
}

async function releaseRequestAssetLock(row, { restoreServiceStatus = false } = {}) {
  if (!row.assetId) return null;
  const asset = await Asset.findOne({ _id: row.assetId, isDeleted: false });
  if (!asset) return null;
  if (row.requestType === 'REPAIR' && String(asset.openRepairId) === String(row._id)) {
    return Asset.findOneAndUpdate(
      { _id: asset._id, openRepairId: row._id },
      {
        $set: {
          openRepairId: null,
          ...(restoreServiceStatus ? { status: row.fromStatus || 'Purchased' } : {}),
        },
      }
    );
  }
  if (
    row.requestType === 'MAINTENANCE' &&
    String(asset.openMaintenanceId) === String(row._id)
  ) {
    return Asset.findOneAndUpdate(
      { _id: asset._id, openMaintenanceId: row._id },
      {
        $set: {
          openMaintenanceId: null,
          ...(restoreServiceStatus ? { status: row.fromStatus || 'Purchased' } : {}),
        },
      }
    );
  }
  if (isLogistics(row.requestType) && String(asset.openMovementId) === String(row._id)) {
    return Asset.findOneAndUpdate(
      { _id: asset._id, openMovementId: row._id },
      { $set: { openMovementId: null } }
    );
  }
  return asset;
}

router.get(
  '/',
  canRead,
  asyncHandler(async (req, res) => {
    const { page, limit, skip, sort } = parsePagination(req.query);
    const filter = { isDeleted: false };
    if (req.query.status) filter.status = req.query.status;
    if (req.query.requestType) {
      const t = normalizeRequestType(req.query.requestType);
      if (t === 'LOGISTICS') {
        filter.requestType = { $in: ['LOGISTICS', 'MOVEMENT'] };
      } else {
        filter.requestType = t;
      }
    }
    const [data, total] = await Promise.all([
      AssetRequest.find(filter)
        .populate('requestorId', 'fullName email')
        .populate('approverId', 'fullName email')
        .populate('assetId', 'assetTag deviceNameSnapshot serialNumber status custody')
        .populate('contactId', 'name contact city state')
        .populate('preferredVendorContactId', 'name organization resourceType')
        .populate('fromContactId', 'name contact city state')
        .populate('toContactId', 'name contact city state')
        .sort(sort || '-createdAt')
        .skip(skip)
        .limit(limit),
      AssetRequest.countDocuments(filter),
    ]);
    res.json(paginated(data, total, page, limit));
  })
);

router.get(
  '/export',
  canRead,
  asyncHandler(async (_req, res) => {
    const rows = await AssetRequest.find({ isDeleted: false })
      .populate('requestorId', 'fullName email')
      .populate('approverId', 'fullName email')
      .sort('-createdAt');
    sendExcel(
      res,
      'Request_Center.xlsx',
      [
        'Request Number',
        'Type',
        'Status',
        'Asset Name',
        'Custody',
        'Custodian Name',
        'Custodian Contact',
        'City',
        'State',
        'Priority',
        'Category / Kind',
        'Request Option',
        'Products',
        'Amount',
        'Currency',
        'Training Topic',
        'Trainee Name',
        'Hiring Type',
        'HCW Type',
        'Camp Type',
        'Hiring Method',
        'Engagement Date & Time',
        'Hiring Name',
        'Hiring Address',
        'Hiring State',
        'Hiring City',
        'Hiring Pin Code',
        'Budget Minimum (INR)',
        'Budget Maximum (INR)',
        'Preferred Vendor',
        'Reason',
        'Requestor',
        'Approver',
        'Created At',
      ],
      rows.map((r) => [
        r.requestNumber || r._id,
        typeLabel(r.requestType),
        r.status,
        r.assetName || '',
        r.assetCustody || '',
        r.custodianName || '',
        r.custodianContact || '',
        r.custodianCity || '',
        r.custodianState || '',
        r.priority || '',
        r.issueCategory ||
          r.maintenanceKind ||
          r.logisticsKind ||
          r.expenseCategory ||
          r.otherCategory ||
          '',
        r.otherSubcategory || '',
        productSummary(r.logisticsProducts),
        r.amount ?? '',
        r.currency || '',
        r.trainingTopic || '',
        r.traineeName || '',
        r.hiringType || '',
        r.hcwType || '',
        r.campType || '',
        r.hiringMethod || '',
        r.engagementDateTime || '',
        r.hiringName || '',
        r.hiringAddress || '',
        r.hiringState || '',
        r.hiringCity || '',
        r.hiringPinCode || '',
        r.budgetMin ?? '',
        r.budgetMax ?? '',
        r.preferredVendor || '',
        r.reason || '',
        r.requestorId?.fullName || r.requestorId?.email || '',
        r.approverId?.fullName || r.approverId?.email || '',
        r.createdAt,
      ]),
      { sheetName: 'The Request Center' }
    );
  })
);

router.get(
  '/:id/product-image',
  canRead,
  asyncHandler(async (req, res) => {
    const row = await AssetRequest.findOne({ _id: req.params.id, isDeleted: false });
    if (!row) throw new AppError('Request not found', 404);
    const filePath = existingImageFilePath(row.productImage);
    if (!filePath) {
      throw new AppError('Product image not found', 404);
    }
    res.type(row.productImage.mimeType || 'application/octet-stream');
    res.setHeader('Content-Disposition', `inline; filename="product-image${path.extname(filePath)}"`);
    await new Promise((resolve, reject) => {
      res.sendFile(filePath, (error) => (error ? reject(error) : resolve()));
    });
  })
);

router.post(
  '/:id/product-image',
  asyncHandler(async (req, _res, next) => {
    const row = await AssetRequest.findOne({ _id: req.params.id, isDeleted: false });
    if (!row) throw new AppError('Request not found', 404);
    assertProductImageAccess(req, row);
    req.assetRequest = row;
    next();
  }),
  productPhotoUpload,
  asyncHandler(async (req, res) => {
    if (!req.file) {
      throw new AppError('productPhoto is required', 400, 'VALIDATION_ERROR');
    }
    const image = imageMetadata(req.file, 'MANUAL', req.user._id);
    const previousImage = req.assetRequest.productImage;
    const updated = await AssetRequest.findOneAndUpdate(
      {
        _id: req.assetRequest._id,
        isDeleted: false,
        requestType: { $in: ['REPAIR', 'MAINTENANCE'] },
        status: { $in: ['REQUESTED', 'APPROVED'] },
      },
      { $set: { productImage: image } }
    );
    if (!updated) {
      removeImageFile(image);
      throw new AppError('Request is no longer active', 409, 'INVALID_STATUS');
    }
    if (previousImage?.filename && previousImage.filename !== image.filename) {
      removeImageFile(previousImage);
    }
    await writeAudit({
      actorId: req.user._id,
      actorEmail: req.user.email,
      action: 'ASSET_REQUEST.PRODUCT_IMAGE.UPLOAD',
      entityType: 'AssetRequest',
      entityId: req.assetRequest._id,
      after: image,
      requestId: req.requestId,
    });
    res.json({ data: { productImage: image } });
  })
);

router.get(
  '/:id/bill',
  canRead,
  asyncHandler(async (req, res) => {
    const row = await AssetRequest.findOne({ _id: req.params.id, isDeleted: false });
    if (!row) throw new AppError('Request not found', 404);
    if (row.requestType !== 'REIMBURSEMENT') {
      throw new AppError('Bill is not available for this request type', 400);
    }
    const filePath = existingAttachmentFilePath(row.billAttachment);
    if (!filePath) throw new AppError('Bill not found', 404);
    res.type(row.billAttachment.mimeType || 'application/octet-stream');
    res.setHeader(
      'Content-Disposition',
      `inline; filename="bill${path.extname(filePath)}"`
    );
    await new Promise((resolve, reject) => {
      res.sendFile(filePath, (error) => (error ? reject(error) : resolve()));
    });
  })
);

router.post(
  '/:id/bill',
  asyncHandler(async (req, _res, next) => {
    const row = await AssetRequest.findOne({ _id: req.params.id, isDeleted: false });
    if (!row) throw new AppError('Request not found', 404);
    assertBillAccess(req, row);
    req.assetRequest = row;
    next();
  }),
  reimbursementBillUpload,
  asyncHandler(async (req, res) => {
    if (!req.file) throw new AppError('Bill is required', 400, 'VALIDATION_ERROR');
    const attachment = imageMetadata(req.file, 'REIMBURSEMENT_BILL', req.user._id);
    const updated = await AssetRequest.findOneAndUpdate(
      {
        _id: req.assetRequest._id,
        isDeleted: false,
        requestType: 'REIMBURSEMENT',
        status: { $in: ['REQUESTED', 'APPROVED'] },
      },
      { $set: { billAttachment: attachment } }
    );
    if (!updated) {
      removeAttachmentFile(attachment);
      throw new AppError('Request is no longer active', 409, 'INVALID_STATUS');
    }
    if (req.assetRequest.billAttachment) {
      removeAttachmentFile(req.assetRequest.billAttachment);
    }
    await writeAudit({
      actorId: req.user._id,
      actorEmail: req.user.email,
      action: 'ASSET_REQUEST.REIMBURSEMENT_BILL.UPLOAD',
      entityType: 'AssetRequest',
      entityId: req.assetRequest._id,
      after: attachment,
      requestId: req.requestId,
    });
    res.json({ data: { billAttachment: attachment } });
  })
);

router.get(
  '/:id/attachment',
  canRead,
  asyncHandler(async (req, res) => {
    const row = await AssetRequest.findOne({ _id: req.params.id, isDeleted: false });
    if (!row) throw new AppError('Request not found', 404);
    if (row.requestType !== 'OTHER') {
      throw new AppError('Attachment is not available for this request type', 400);
    }
    const filePath = existingAttachmentFilePath(row.requestAttachment);
    if (!filePath) throw new AppError('Attachment not found', 404);
    res.type(row.requestAttachment.mimeType || 'application/octet-stream');
    res.setHeader(
      'Content-Disposition',
      `inline; filename="request-attachment${path.extname(filePath)}"`
    );
    await new Promise((resolve, reject) => {
      res.sendFile(filePath, (error) => (error ? reject(error) : resolve()));
    });
  })
);

router.post(
  '/:id/attachment',
  asyncHandler(async (req, _res, next) => {
    const row = await AssetRequest.findOne({ _id: req.params.id, isDeleted: false });
    if (!row) throw new AppError('Request not found', 404);
    assertOtherAttachmentAccess(req, row);
    req.assetRequest = row;
    next();
  }),
  requestAttachmentUpload,
  asyncHandler(async (req, res) => {
    if (!req.file) throw new AppError('Attachment is required', 400, 'VALIDATION_ERROR');
    const attachment = imageMetadata(req.file, 'OTHER_REQUEST_ATTACHMENT', req.user._id);
    const updated = await AssetRequest.findOneAndUpdate(
      {
        _id: req.assetRequest._id,
        isDeleted: false,
        requestType: 'OTHER',
        status: { $in: ['REQUESTED', 'APPROVED'] },
      },
      { $set: { requestAttachment: attachment } }
    );
    if (!updated) {
      removeAttachmentFile(attachment);
      throw new AppError('Request is no longer active', 409, 'INVALID_STATUS');
    }
    if (req.assetRequest.requestAttachment) {
      removeAttachmentFile(req.assetRequest.requestAttachment);
    }
    await writeAudit({
      actorId: req.user._id,
      actorEmail: req.user.email,
      action: 'ASSET_REQUEST.OTHER_ATTACHMENT.UPLOAD',
      entityType: 'AssetRequest',
      entityId: req.assetRequest._id,
      after: attachment,
      requestId: req.requestId,
    });
    res.json({ data: { requestAttachment: attachment } });
  })
);

router.post(
  '/:id/product-image-link',
  asyncHandler(async (req, res) => {
    const row = await AssetRequest.findOne({ _id: req.params.id, isDeleted: false });
    if (!row) throw new AppError('Request not found', 404);
    assertProductImageAccess(req, row);
    const activeRow = await AssetRequest.findOne({
      _id: row._id,
      isDeleted: false,
      requestType: { $in: ['REPAIR', 'MAINTENANCE'] },
      status: { $in: ['REQUESTED', 'APPROVED'] },
    });
    if (!activeRow) throw new AppError('Request is no longer active', 409, 'INVALID_STATUS');

    const contact = req.body.contactId
      ? await resolveContact(req.body.contactId, 'Custodian')
      : activeRow.contactId
        ? await Contact.findOne({ _id: activeRow.contactId, isDeleted: false })
        : null;
    const pending = await AssetRequestUploadInvite.find({
      requestId: row._id,
      status: 'PENDING',
    });
    await AssetRequestUploadInvite.updateMany(
      { requestId: row._id, status: 'PENDING' },
      { $set: { status: 'REVOKED' } }
    );

    const token = randomBytes(32).toString('base64url');
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
    const invite = await AssetRequestUploadInvite.create({
      requestId: row._id,
      tokenHash: createHash('sha256').update(token).digest('hex'),
      status: 'PENDING',
      contactId: contact?._id || null,
      custodianName: contact?.name || activeRow.custodianName || '',
      custodianContact:
        contact?.contact || contact?.mobile || activeRow.custodianContact || '',
      custodianCity: contact?.city || activeRow.custodianCity || '',
      custodianState: contact?.state || activeRow.custodianState || '',
      expiresAt,
      createdById: req.user._id,
    });

    await writeAudit({
      actorId: req.user._id,
      actorEmail: req.user.email,
      action: 'ASSET_REQUEST.PRODUCT_IMAGE_INVITE.CREATE',
      entityType: 'AssetRequestUploadInvite',
      entityId: invite._id,
      after: {
        requestId: row._id,
        expiresAt,
        revokedInviteIds: pending.map((item) => item._id),
      },
      requestId: req.requestId,
    });

    res.status(201).json({
      data: {
        token,
        expiresAt,
        uploadUrl: `/api/v1/request-upload/${token}`,
      },
    });
  })
);

router.get(
  '/:id',
  canRead,
  asyncHandler(async (req, res) => {
    const row = await AssetRequest.findOne({ _id: req.params.id, isDeleted: false })
      .populate('requestorId', 'fullName email')
      .populate('approverId', 'fullName email')
      .populate(
        'assetId',
        'assetTag deviceNameSnapshot name serialNumber status custody location contactId custodianName custodianContact custodianCity custodianState openMovementId openRepairId openMaintenanceId'
      )
      .populate('contactId', 'name contact city state')
      .populate('preferredVendorContactId', 'name organization resourceType')
      .populate('fromContactId', 'name contact city state')
      .populate('toContactId', 'name contact city state');
    if (!row) throw new AppError('Request not found', 404);
    res.json({ data: row });
  })
);

router.post(
  '/',
  canRequest,
  asyncHandler(async (req, res) => {
    const rawType = String(req.body.requestType || '').toUpperCase();
    if (!ALL_REQUEST_TYPES.includes(rawType) && !ALL_REQUEST_TYPES.includes(normalizeRequestType(rawType))) {
      throw new AppError(
        'requestType must be Repair, Maintenance, Logistics, Training, Reimbursement, Hiring, or Others',
        400,
        'VALIDATION_ERROR'
      );
    }
    const requestType = normalizeRequestType(rawType);
    assertCreatePermission(req, requestType);
    const reason = String(req.body.reason || req.body.description || '').trim();

    const details = pickDetails(req.body);
    validateTypeDetails(requestType, details);
    if (requestType === 'REIMBURSEMENT') {
      const expenseCategory = await LogisticsExpenseCategory.findOne({
        name: details.expenseCategory,
        isDeleted: false,
        isActive: true,
      });
      if (!expenseCategory) {
        throw new AppError(
          'Select a valid category from Expense Categories Master',
          400,
          'VALIDATION_ERROR'
        );
      }
      details.expenseCategory = expenseCategory.name;
      details.currency = 'INR';
      details.payeeName = '';
    }

    const logisticsProducts =
      requestType === 'LOGISTICS'
        ? await normalizeLogisticsProducts(req.body.logisticsProducts)
        : [];
    const needsAsset =
      ASSET_REQUIRED_TYPES.includes(requestType) ||
      (requestType === 'LOGISTICS' &&
        logisticsProductsNeedAsset(logisticsProducts));
    const assetId = req.body.assetId || null;

    if (needsAsset && !assetId) {
      throw new AppError(
        requestType === 'LOGISTICS'
          ? 'A linked asset is required for Medical Device and Non-Medical Device products'
          : 'Asset is required for this request type',
        400,
        'VALIDATION_ERROR'
      );
    }

    let linked = emptyLinkedSnapshot();
    let asset = null;
    if (assetId) {
      linked = await buildLinkedSnapshot(assetId);
      asset = await Asset.findOne({ _id: assetId, isDeleted: false });
    }

    if (isLogistics(requestType) && asset) {
      if (asset.openMovementId) {
        throw new AppError('Asset already has an open logistics / movement request', 400, 'ASSET_LOCKED');
      }
      if (['Repair', 'Maintenance', 'Disposed'].includes(asset.status)) {
        throw new AppError('Asset is not eligible for logistics transfer', 400, 'INVALID_STATUS');
      }
    }
    if (
      requestType === 'REPAIR' &&
      (asset?.openRepairId || asset?.openMaintenanceId || asset?.openMovementId)
    ) {
      throw new AppError('Asset already has an open request', 400, 'ASSET_LOCKED');
    }
    if (
      requestType === 'MAINTENANCE' &&
      (asset?.openRepairId || asset?.openMaintenanceId || asset?.openMovementId)
    ) {
      throw new AppError('Asset already has an open request', 400, 'ASSET_LOCKED');
    }

    const vendor = await preferredVendorSnapshot(req.body);
    const traineeContact =
      requestType === 'TRAINING' && req.body.traineeContactId
        ? await resolveContact(req.body.traineeContactId, 'Trainee')
        : null;
    if (requestType === 'TRAINING' && details.trainingMode.toLowerCase() === 'physical') {
      if (!traineeContact) {
        throw new AppError(
          'Physical training requires a trainee from Contact Directory',
          400,
          'VALIDATION_ERROR'
        );
      }
      if (!trim(traineeContact.city)) {
        throw new AppError(
          'The selected trainee must have a city in Contact Directory',
          400,
          'VALIDATION_ERROR'
        );
      }
      details.venue = trim(traineeContact.city);
    } else if (
      requestType === 'TRAINING' &&
      details.trainingMode.toLowerCase() === 'virtual'
    ) {
      details.venue = '';
    }
    const trainee = traineeContact
      ? { traineeContactId: traineeContact._id, traineeName: traineeContact.name || '' }
      : { traineeContactId: null, traineeName: '' };
    let logisticsEndpoints = {
      fromContactId: null,
      fromState: '',
      fromCity: '',
      fromName: '',
      fromNumber: '',
      fromPinCode: '',
      fromAddress: '',
      toContactId: null,
      toState: '',
      toCity: '',
      toName: '',
      toNumber: '',
      toPinCode: '',
      toAddress: '',
    };
    if (isLogistics(requestType)) {
      const fromContact = req.body.fromContactId
        ? await resolveContact(req.body.fromContactId, 'From')
        : linked.contactId
          ? await Contact.findOne({ _id: linked.contactId, isDeleted: false })
          : null;
      const toContact = await resolveContact(req.body.toContactId, 'To');
      const from = endpointSnapshot('from', req.body, fromContact, {
        contactId: fromContact?._id || null,
        state: linked.custodianState,
        city: linked.custodianCity,
        name: linked.custodianName,
        number: linked.custodianContact,
      });
      const to = endpointSnapshot('to', req.body, toContact);
      logisticsEndpoints = { ...from, ...to };

      const flow = logisticsFlow(details.logisticsKind);
      if (
        flow === 'INTER_TRANSFER' &&
        (!hasEndpoint(logisticsEndpoints, 'from') ||
          !hasEndpoint(logisticsEndpoints, 'to'))
      ) {
        throw new AppError(
          'Inter Transfer requires both From and To',
          400,
          'VALIDATION_ERROR'
        );
      }
      if (flow === 'FRESH_DISPATCH' && !hasEndpoint(logisticsEndpoints, 'to')) {
        throw new AppError('Fresh Dispatch requires To', 400, 'VALIDATION_ERROR');
      }
      if (flow === 'RECALL_PICKUP' && !hasEndpoint(logisticsEndpoints, 'from')) {
        throw new AppError('Recall / Pickup requires From', 400, 'VALIDATION_ERROR');
      }
    }

    const row = await AssetRequest.create({
      requestNumber: await nextSequence('assetRequestNumber', 'ARQ'),
      requestType,
      status: 'REQUESTED',
      requestorId: req.user._id,
      reason,
      assetId: linked.assetId,
      assetTag: linked.assetTag,
      serialNumber: linked.serialNumber,
      assetName: req.body.assetName?.trim() || linked.assetName,
      assetCustody: req.body.assetCustody?.trim() || linked.assetCustody,
      custodianState: req.body.custodianState?.trim() || linked.custodianState,
      custodianName: req.body.custodianName?.trim() || linked.custodianName,
      custodianContact: req.body.custodianContact?.trim() || linked.custodianContact,
      custodianCity: req.body.custodianCity?.trim() || linked.custodianCity,
      contactId: req.body.contactId || linked.contactId,
      fromStatus: linked.fromStatus,
      ...details,
      ...trainee,
      logisticsProducts,
      ...vendor,
      ...logisticsEndpoints,
    });

    await notifyApprovers({ request: row, actorId: req.user._id, reason });

    await writeAudit({
      actorId: req.user._id,
      actorEmail: req.user.email,
      action: 'ASSET_REQUEST.CREATE',
      entityType: 'AssetRequest',
      entityId: row._id,
      after: row.toObject?.() || row,
      requestId: req.requestId,
    });

    res.status(201).json({ data: row });
  })
);

router.post(
  '/:id/approve',
  canApprove,
  asyncHandler(async (req, res) => {
    let row = await AssetRequest.findOne({ _id: req.params.id, isDeleted: false });
    if (!row) throw new AppError('Request not found', 404);
    if (row.status !== 'REQUESTED') {
      throw new AppError('Only REQUESTED items can be approved', 400, 'INVALID_STATUS');
    }
    if (String(row.requestorId) === String(req.user._id)) {
      throw new AppError('Segregation of duties: requestor cannot approve', 403, 'SOD_VIOLATION');
    }
    if (row.requestType === 'REIMBURSEMENT' && !row.billAttachment) {
      throw new AppError(
        'A bill must be uploaded before this Reimbursement request can be approved',
        409,
        'BILL_REQUIRED'
      );
    }

    const needsAsset =
      ASSET_REQUIRED_TYPES.includes(row.requestType) ||
      (isLogistics(row.requestType) &&
        logisticsProductsNeedAsset(row.logisticsProducts));
    let asset = null;
    if (row.assetId) {
      asset = await Asset.findOne({ _id: row.assetId, isDeleted: false });
      if (needsAsset && !asset) throw new AppError('Linked asset not found', 404);
    } else if (needsAsset) {
      throw new AppError('Linked asset not found', 404);
    }

    if (asset) {
      if (
        row.requestType === 'REPAIR' &&
        ((asset.openRepairId && String(asset.openRepairId) !== String(row._id)) ||
          asset.openMaintenanceId ||
          asset.openMovementId)
      ) {
        throw new AppError('Asset already has an open request', 400, 'ASSET_LOCKED');
      }
      if (
        row.requestType === 'MAINTENANCE' &&
        ((asset.openMaintenanceId &&
          String(asset.openMaintenanceId) !== String(row._id)) ||
          asset.openRepairId ||
          asset.openMovementId)
      ) {
        throw new AppError('Asset already has an open request', 400, 'ASSET_LOCKED');
      }
      if (isLogistics(row.requestType)) {
        if (asset.openRepairId || asset.openMaintenanceId) {
          throw new AppError('Asset already has an open request', 400, 'ASSET_LOCKED');
        }
        if (
          asset.openMovementId &&
          String(asset.openMovementId) !== String(row._id)
        ) {
          throw new AppError(
            'Asset already has an open logistics / movement request',
            400,
            'ASSET_LOCKED'
          );
        }
        if (['Repair', 'Maintenance', 'Disposed'].includes(asset.status)) {
          throw new AppError(
            'Asset is not eligible for logistics transfer',
            400,
            'INVALID_STATUS'
          );
        }
      }
      if (row.requestType === 'REPAIR' || row.requestType === 'MAINTENANCE') {
        row.fromStatus = asset.status || row.fromStatus || null;
      }
    }

    const approvedAt = new Date().toISOString();
    row = await AssetRequest.findOneAndUpdate(
      { _id: row._id, isDeleted: false, status: 'REQUESTED' },
      {
        $set: {
          status: 'APPROVED',
          approverId: req.user._id,
          approvedAt,
          fromStatus: row.fromStatus || null,
        },
      }
    );
    if (!row) throw new AppError('Request status changed', 409, 'INVALID_STATUS');

    if (asset) {
      if (row.requestType === 'REPAIR') {
        await Asset.findOneAndUpdate(
          { _id: asset._id },
          { $set: { status: 'Repair', openRepairId: row._id } }
        );
      } else if (row.requestType === 'MAINTENANCE') {
        await Asset.findOneAndUpdate(
          { _id: asset._id },
          { $set: { status: 'Maintenance', openMaintenanceId: row._id } }
        );
      } else if (isLogistics(row.requestType)) {
        await Asset.findOneAndUpdate(
          { _id: asset._id },
          { $set: { openMovementId: row._id } }
        );
      }
    }

    await writeAudit({
      actorId: req.user._id,
      actorEmail: req.user.email,
      action: 'ASSET_REQUEST.APPROVE',
      entityType: 'AssetRequest',
      entityId: row._id,
      requestId: req.requestId,
    });

    if (row.requestorId) {
      await Notification.create({
        userId: row.requestorId,
        type: 'ASSET_REQUEST_APPROVAL',
        title: `Request ${row.requestNumber} approved`,
        body: `${typeLabel(row.requestType)} · ${row.assetName || row.trainingTopic || ''}`.trim(),
        entityType: 'AssetRequest',
        entityId: row._id,
      });
    }

    res.json({ data: row });
  })
);

router.post(
  '/:id/reject',
  canApprove,
  asyncHandler(async (req, res) => {
    let row = await AssetRequest.findOne({ _id: req.params.id, isDeleted: false });
    if (!row) throw new AppError('Request not found', 404);
    if (row.status !== 'REQUESTED') {
      throw new AppError('Only REQUESTED items can be rejected', 400, 'INVALID_STATUS');
    }
    if (String(row.requestorId) === String(req.user._id)) {
      throw new AppError('Segregation of duties: requestor cannot reject', 403, 'SOD_VIOLATION');
    }

    const rejectedAt = new Date().toISOString();
    const rejectionReason =
      String(req.body.reason || req.body.rejectionReason || '').trim() || null;
    row = await AssetRequest.findOneAndUpdate(
      { _id: row._id, isDeleted: false, status: 'REQUESTED' },
      {
        $set: {
          status: 'REJECTED',
          approverId: req.user._id,
          rejectedAt,
          rejectionReason,
        },
      }
    );
    if (!row) throw new AppError('Request status changed', 409, 'INVALID_STATUS');
    await revokePendingUploadInvites(row._id);

    await writeAudit({
      actorId: req.user._id,
      actorEmail: req.user.email,
      action: 'ASSET_REQUEST.REJECT',
      entityType: 'AssetRequest',
      entityId: row._id,
      requestId: req.requestId,
    });

    if (row.requestorId) {
      await Notification.create({
        userId: row.requestorId,
        type: 'ASSET_REQUEST_APPROVAL',
        title: `Request ${row.requestNumber} rejected`,
        body: row.rejectionReason || `${typeLabel(row.requestType)} · ${row.assetName || ''}`.trim(),
        entityType: 'AssetRequest',
        entityId: row._id,
      });
    }

    res.json({ data: row });
  })
);

router.post(
  '/:id/cancel',
  asyncHandler(async (req, res) => {
    const current = await AssetRequest.findOne({
      _id: req.params.id,
      isDeleted: false,
    });
    if (!current) throw new AppError('Request not found', 404);
    if (!canManageRequest(req, current)) {
      throw new AppError('Forbidden', 403, 'FORBIDDEN');
    }
    if (!['REQUESTED', 'APPROVED'].includes(current.status)) {
      throw new AppError(
        'Only REQUESTED or APPROVED items can be cancelled',
        400,
        'INVALID_STATUS'
      );
    }
    if ((current.fulfillmentPendingLineIds || []).length) {
      throw new AppError(
        'Request has a dispatch in progress',
        409,
        'FULFILLMENT_IN_PROGRESS'
      );
    }

    const cancelledAt = new Date().toISOString();
    const cancellationReason =
      String(req.body.reason || req.body.cancellationReason || '').trim() || null;
    const row = await AssetRequest.findOneAndUpdate(
      {
        _id: current._id,
        isDeleted: false,
        status: { $in: ['REQUESTED', 'APPROVED'] },
        fulfillmentPendingLineIds: { $nin: requestProductLineIds(current) },
      },
      {
        $set: {
          status: 'CANCELLED',
          cancelledAt,
          cancelledById: req.user._id,
          cancellationReason,
        },
      }
    );
    if (!row) throw new AppError('Request status changed', 409, 'INVALID_STATUS');

    if (current.status === 'APPROVED') {
      await releaseRequestAssetLock(current, { restoreServiceStatus: true });
    }
    await revokePendingUploadInvites(current._id);
    await writeAudit({
      actorId: req.user._id,
      actorEmail: req.user.email,
      action: 'ASSET_REQUEST.CANCEL',
      entityType: 'AssetRequest',
      entityId: row._id,
      after: { status: row.status, cancelledAt, cancellationReason },
      requestId: req.requestId,
    });
    res.json({ data: row });
  })
);

router.post(
  '/:id/complete',
  canApprove,
  asyncHandler(async (req, res) => {
    let row = await AssetRequest.findOne({ _id: req.params.id, isDeleted: false });
    if (!row) throw new AppError('Request not found', 404);
    if (row.status !== 'APPROVED') {
      throw new AppError('Only APPROVED items can be completed', 400, 'INVALID_STATUS');
    }

    if (isLogistics(row.requestType) && (row.logisticsProducts || []).length) {
      const lineIds = requestProductLineIds(row);
      const fulfilled = new Set(row.fulfilledLineIds || []);
      const remainingLineIds = lineIds.filter((lineId) => !fulfilled.has(lineId));
      if (remainingLineIds.length) {
        throw new AppError(
          'All logistics product lines must be dispatched before completion',
          409,
          'FULFILLMENT_INCOMPLETE',
          {
            totalLines: lineIds.length,
            fulfilledLineIds: [...fulfilled],
            remainingLineIds,
            allProductLinesFulfilled: false,
          }
        );
      }
    }

    const asset = row.assetId
      ? await Asset.findOne({ _id: row.assetId, isDeleted: false })
      : null;
    if (asset) {
      if (
        row.requestType === 'REPAIR' &&
        ((asset.openRepairId && String(asset.openRepairId) !== String(row._id)) ||
          asset.openMaintenanceId ||
          asset.openMovementId)
      ) {
        throw new AppError('Asset is locked by another request', 409, 'ASSET_LOCKED');
      }
      if (
        row.requestType === 'MAINTENANCE' &&
        ((asset.openMaintenanceId &&
          String(asset.openMaintenanceId) !== String(row._id)) ||
          asset.openRepairId ||
          asset.openMovementId)
      ) {
        throw new AppError('Asset is locked by another request', 409, 'ASSET_LOCKED');
      }
      if (
        isLogistics(row.requestType) &&
        ((asset.openMovementId && String(asset.openMovementId) !== String(row._id)) ||
          asset.openRepairId ||
          asset.openMaintenanceId)
      ) {
        throw new AppError('Asset is locked by another request', 409, 'ASSET_LOCKED');
      }
      if (isLogistics(row.requestType) && logisticsFlow(row.logisticsKind) === 'RECALL_PICKUP') {
        const currentContactId = contactIdOf(asset);
        const expectedContactId = row.fromContactId?._id || row.fromContactId;
        if (
          currentContactId &&
          expectedContactId &&
          String(currentContactId) !== String(expectedContactId)
        ) {
          throw new AppError(
            'Recall source no longer matches the asset’s current contact',
            409,
            'CUSTODY_CONFLICT'
          );
        }
      }
    }

    const completedAt = new Date().toISOString();
    row = await AssetRequest.findOneAndUpdate(
      {
        _id: row._id,
        isDeleted: false,
        status: 'APPROVED',
        fulfillmentPendingLineIds: { $nin: requestProductLineIds(row) },
      },
      { $set: { status: 'COMPLETED', completedAt } }
    );
    if (!row) throw new AppError('Request status changed', 409, 'INVALID_STATUS');

    if (asset) {
      if (row.requestType === 'REPAIR' || row.requestType === 'MAINTENANCE') {
        await releaseRequestAssetLock(row, { restoreServiceStatus: true });
      }
      if (isLogistics(row.requestType)) {
        const before = {
          contactId: contactIdOf(asset),
          location: asset.location || null,
          status: asset.status,
          custody: asset.custody,
        };
        const flow = logisticsFlow(row.logisticsKind);
        let patch;
        if (flow === 'RECALL_PICKUP') {
          patch = {
            openMovementId: null,
            contactId: null,
            hcwId: null,
            hcwBusinessId: null,
            status: 'Warehouse',
            custody: 'Warehouse',
            custodianName: '',
            custodianContact: '',
            custodianCity: '',
            custodianState: '',
            location: { type: 'Warehouse', name: 'Warehouse' },
          };
        } else {
          const contact = row.toContactId
            ? await Contact.findOne({ _id: row.toContactId, isDeleted: false })
            : null;
          patch = {
            openMovementId: null,
            contactId: row.toContactId || null,
            hcwId: null,
            hcwBusinessId: null,
            status: 'Assigned',
            custody: contact?.resourceType || row.toName || asset.custody,
            custodianName: row.toName || contact?.name || '',
            custodianContact:
              row.toNumber || contact?.contact || contact?.mobile || '',
            custodianCity: row.toCity || contact?.city || '',
            custodianState: row.toState || contact?.state || '',
            location: {
              type: 'Field',
              name: row.toName || contact?.name || '',
              city: row.toCity || contact?.city || '',
              state: row.toState || contact?.state || '',
            },
          };
        }
        const updatedAsset = await Asset.findOneAndUpdate(
          { _id: asset._id },
          { $set: patch }
        );
        await AssetEvent.create({
          assetId: asset._id,
          eventType: 'CUSTODY_CHANGE',
          fromContactId: before.contactId,
          toContactId: updatedAsset?.contactId || null,
          fromLocation: before.location,
          toLocation: updatedAsset?.location || null,
          fromStatus: before.status,
          toStatus: updatedAsset?.status || patch.status,
          relatedEntityType: 'AssetRequest',
          relatedEntityId: row._id,
          actorId: req.user._id,
          actorType: 'USER',
          at: completedAt,
          reason: `Completed ${row.requestNumber || row._id}`,
        });
      }
    }

    await revokePendingUploadInvites(row._id);

    await writeAudit({
      actorId: req.user._id,
      actorEmail: req.user.email,
      action: 'ASSET_REQUEST.COMPLETE',
      entityType: 'AssetRequest',
      entityId: row._id,
      after: { status: row.status, completedAt },
      requestId: req.requestId,
    });

    res.json({ data: row });
  })
);

export default router;

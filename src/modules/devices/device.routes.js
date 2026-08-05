import { Router } from 'express';
import multer from 'multer';
import XLSX from 'xlsx';
import { authenticate, requirePermission, requireAdmin } from '../../middleware/auth.js';
import { asyncHandler, parsePagination, paginated, AppError } from '../../utils/helpers.js';
import { PERMISSIONS } from '../../config/constants.js';
import { DeviceMaster } from './device.model.js';
import { Asset } from '../assets/asset.model.js';
import { Contact } from '../contacts/contact.model.js';
import { LogisticsProduct } from '../logistics/logistics.model.js';
import { productMasterAssetName, productPurchaseCost } from '../logistics/productMasterLabel.js';
import { createAsset } from '../assets/asset.service.js';
import { writeAudit } from '../../utils/audit.js';
import { sendExcel } from '../../utils/excelExport.js';
import { notifyImportFailures } from '../imports/importErrorReport.js';
import { assertValidPhoneOrEmail } from '../../utils/identityNormalize.js';
import {
  OWNERSHIP_TYPE_OPTIONS,
  AGREEMENT_STATUS_OPTIONS,
  DEVICE_CUSTODY_OPTIONS,
  normalizeAgreementStatus,
  normalizeDeviceCustody,
  normalizeAssetType,
  formatOwnershipType,
  normalizeCustodianState,
} from './device.constants.js';
import { escapeRegex } from '../../utils/escapeRegex.js';
import { formatTextValue, cleanSpaces } from '../../utils/textFormat.js';

const canWriteDevicesOrAssets = requirePermission(
  PERMISSIONS.DEVICES_WRITE,
  PERMISSIONS.ASSETS_WRITE
);

const ASSET_MASTER_HEADERS = [
  'Asset Type (Product Type)',
  'Model / Variant',
  'Serial Number',
  'Purchase Month & Year',
  'Purchase Amount',
  'Ownership Type',
  'Asset Status',
  'Asset Custody',
  'Asset & Peripheral Remarks',
];

const router = Router();
router.use(authenticate);

const canReadDevices = requirePermission(PERMISSIONS.ASSETS_READ, PERMISSIONS.DEVICES_WRITE);
router.use((req, res, next) => {
  if (req.method !== 'GET') return next();
  return canReadDevices(req, res, next);
});

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

const PURCHASE_RE = /^(0[1-9]|1[0-2])\/\d{4}$/;

/** Accept MM/YYYY or YYYY-MM (from `<input type="month">`). */
function normalizePurchaseMonth(raw) {
  const v = String(raw || '').trim();
  if (!v) return null;
  if (PURCHASE_RE.test(v)) return v;
  const loose = /^(0?[1-9]|1[0-2])\/(\d{4})$/.exec(v);
  if (loose) return `${String(loose[1]).padStart(2, '0')}/${loose[2]}`;
  const iso = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(v);
  if (iso) return `${iso[2]}/${iso[1]}`;
  return null;
}

function purchaseFromExcel(value) {
  if (value == null || value === '') return null;
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    const mm = String(value.getMonth() + 1).padStart(2, '0');
    return `${mm}/${value.getFullYear()}`;
  }
  if (typeof value === 'number' && XLSX.SSF?.parse_date_code) {
    const parsed = XLSX.SSF.parse_date_code(value);
    if (parsed?.y && parsed?.m) {
      return `${String(parsed.m).padStart(2, '0')}/${parsed.y}`;
    }
  }
  return normalizePurchaseMonth(String(value));
}

function purchaseMonthToDate(mmYyyy) {
  if (!mmYyyy || !PURCHASE_RE.test(mmYyyy)) return null;
  const [mm, yyyy] = mmYyyy.split('/');
  return `${yyyy}-${mm}-01`;
}

function normKey(row, candidates) {
  for (const c of candidates) {
    if (row[c] !== undefined && row[c] !== '') return row[c];
  }
  const keys = Object.keys(row);
  for (const c of candidates) {
    const needle = c.toLowerCase().replace(/[^a-z0-9]/g, '');
    const found = keys.find((k) => k.toLowerCase().replace(/[^a-z0-9]/g, '') === needle);
    if (found && row[found] !== '') return row[found];
  }
  return '';
}

function parseMasterFields(input) {
  const name = cleanSpaces(String(input.name || ''));
  if (!name) throw new AppError('Asset Name is required', 400, 'VALIDATION_ERROR');

  const assetType = normalizeAssetType(input.assetType);
  if (!assetType) {
    throw new AppError(
      `Ownership Type is required and must be one of: ${OWNERSHIP_TYPE_OPTIONS.join(', ')}`,
      400,
      'VALIDATION_ERROR'
    );
  }

  const serialNumber = formatTextValue(String(input.serialNumber || ''), 'serialNumber');
  if (!serialNumber) throw new AppError('Serial Number is required', 400, 'VALIDATION_ERROR');

  const purchaseMonth = input.purchaseMonth;
  if (!purchaseMonth || !PURCHASE_RE.test(purchaseMonth)) {
    throw new AppError('Purchase month is required as MM/YYYY', 400, 'VALIDATION_ERROR');
  }

  const cost = input.cost == null || input.cost === '' ? null : Number(input.cost);
  if (cost == null || !Number.isFinite(cost) || cost < 0) {
    throw new AppError('Purchase Amount is required and must be a non-negative number', 400, 'VALIDATION_ERROR');
  }

  const statusRaw = input.agreementStatus ?? input.assetStatus;
  let agreementStatus = 'Not Initiated';
  if (statusRaw != null && String(statusRaw).trim()) {
    agreementStatus = normalizeAgreementStatus(statusRaw);
    if (!agreementStatus) {
      throw new AppError(
        `Asset Status must be one of: ${AGREEMENT_STATUS_OPTIONS.join(', ')}`,
        400,
        'VALIDATION_ERROR'
      );
    }
  }

  const custody = normalizeDeviceCustody(input.custody);
  if (!custody) {
    throw new AppError(
      `Asset Custody is required and must be one of: ${DEVICE_CUSTODY_OPTIONS.join(', ')}`,
      400,
      'VALIDATION_ERROR'
    );
  }

  const custodianName = formatTextValue(String(input.custodianName || ''), 'custodianName') || '';
  const custodianContact =
    formatTextValue(String(input.custodianContact || ''), 'custodianContact') || '';
  if (custodianContact) {
    assertValidPhoneOrEmail(custodianContact, 'Custodian Contact');
  }

  const custodianCity =
    formatTextValue(String(input.custodianCity || input.city || ''), 'city') || '';
  const custodianState = normalizeCustodianState(input.custodianState) || '';
  // Custodian is optional on Add Asset; Contact Directory link remains available when provided.

  const description = formatTextValue(String(input.description || ''), 'peripheralRemarks') || null;

  const registerTypes = ['Medical Device', 'Non-Medical Device'];
  let productType = String(input.productType || '').trim() || 'Medical Device';
  if (!registerTypes.includes(productType)) {
    throw new AppError(
      `Product type for the asset register must be one of: ${registerTypes.join(', ')}`,
      400,
      'VALIDATION_ERROR'
    );
  }

  return {
    name,
    assetType,
    serialNumber,
    cost,
    purchaseMonth,
    agreementStatus,
    custody,
    custodianName,
    custodianContact,
    custodianCity,
    custodianState,
    description,
    productType,
    productId: input.productId || null,
    contactId: input.contactId || null,
  };
}

async function applyContactToFields(fields, contactId) {
  const id = String(contactId || '').trim();
  if (!id) return fields;
  const contact = await Contact.findOne({ _id: id, isDeleted: false });
  if (!contact) {
    throw new AppError('Custodian contact not found in Contact Directory', 400, 'VALIDATION_ERROR');
  }
  return {
    ...fields,
    contactId: contact._id,
    custodianName: contact.name || fields.custodianName,
    custodianContact:
      contact.contact || contact.mobile || contact.email || fields.custodianContact,
    custodianCity: contact.city || fields.custodianCity,
    custodianState: contact.state || fields.custodianState,
  };
}

async function resolveInputFromProduct(input = {}) {
  const productId = String(input.productId || '').trim();
  if (!productId) return { ...input };
  const product = await LogisticsProduct.findOne({ _id: productId, isDeleted: false });
  if (!product) {
    throw new AppError('Selected product was not found in Product Master', 400, 'VALIDATION_ERROR');
  }
  const registerTypes = ['Medical Device', 'Non-Medical Device'];
  const productType = String(input.productType || product.productType || '').trim();
  if (registerTypes.includes(productType) && !registerTypes.includes(product.productType)) {
    throw new AppError(
      'Selected product is not a Medical or Non-Medical Device for the asset register',
      400,
      'VALIDATION_ERROR'
    );
  }
  const name = String(input.name || '').trim() || productMasterAssetName(product);
  const providedCost =
    input.cost == null || input.cost === '' ? null : Number(input.cost);
  const cost =
    providedCost != null && Number.isFinite(providedCost) && providedCost >= 0
      ? providedCost
      : productPurchaseCost(product);
  return {
    ...input,
    productId,
    name,
    cost,
    productType: registerTypes.includes(productType) ? productType : product.productType,
    description: String(input.description || '').trim() || product.description || '',
  };
}

async function createDeviceRecord(input, user, requestId) {
  const resolved = await resolveInputFromProduct(input);
  if (!String(resolved.productId || '').trim()) {
    throw new AppError('Product Master selection is required', 400, 'VALIDATION_ERROR');
  }
  const fields = parseMasterFields(await resolveInputFromProduct(resolved));
  const withContact = await applyContactToFields(fields, resolved.contactId);

  const existing = await Asset.findOne({ serialNumber: withContact.serialNumber, isDeleted: false });
  if (existing) {
    throw new AppError(`Serial number “${withContact.serialNumber}” already exists`, 400, 'SERIAL_EXISTS');
  }

  const purchaseDate = purchaseMonthToDate(withContact.purchaseMonth);

  const device = await DeviceMaster.create({
    name: withContact.name,
    assetType: withContact.assetType,
    serialNumber: withContact.serialNumber,
    cost: withContact.cost,
    purchaseMonth: withContact.purchaseMonth,
    agreementStatus: withContact.agreementStatus,
    custody: withContact.custody,
    custodianName: withContact.custodianName,
    custodianContact: withContact.custodianContact,
    custodianCity: withContact.custodianCity,
    custodianState: withContact.custodianState,
    description: withContact.description,
    productId: withContact.productId || null,
    quantity: 1,
    isActive: true,
  });

  const asset = await createAsset(
    {
      deviceMasterId: device._id,
      deviceNameSnapshot: withContact.name,
      serialNumber: withContact.serialNumber,
      quantity: 1,
      status: 'Purchased',
      deviceValue: withContact.cost,
      purchaseDate,
      addedMonth: withContact.purchaseMonth,
      remarks: withContact.description || undefined,
      agreementStatus: withContact.agreementStatus,
      custody: withContact.custody,
      assetType: withContact.assetType,
      productType: withContact.productType || 'Medical Device',
      contactId: withContact.contactId || null,
      custodianName: withContact.custodianName,
      custodianContact: withContact.custodianContact,
      location: {
        city: withContact.custodianCity,
        state: withContact.custodianState,
      },
    },
    user
  );

  await writeAudit({
    actorId: user._id,
    actorEmail: user.email,
    action: 'ASSET_MASTER.CREATE',
    entityType: 'DeviceMaster',
    entityId: device._id,
    after: {
      ...device.toObject(),
      serialNumber: fields.serialNumber,
      inventoryCreated: 1,
    },
    requestId,
  });

  return {
    ...device.toObject(),
    serialNumber: fields.serialNumber,
    asset: asset.toObject ? asset.toObject() : asset,
  };
}

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const { page, limit, skip, sort } = parsePagination(req.query);
    const filter = { isDeleted: false };
    if (req.query.q) {
      const re = new RegExp(escapeRegex(String(req.query.q)), 'i');
      filter.$or = [
        { name: re },
        { description: re },
        { purchaseMonth: re },
        { serialNumber: re },
        { agreementStatus: re },
        { custody: re },
        { assetType: re },
        { custodianName: re },
        { custodianContact: re },
        { custodianCity: re },
        { custodianState: re },
      ];
    }
    const [data, total] = await Promise.all([
      DeviceMaster.find(filter).sort(sort).skip(skip).limit(limit),
      DeviceMaster.countDocuments(filter),
    ]);
    res.json(paginated(data, total, page, limit));
  })
);

router.get(
  '/export',
  asyncHandler(async (_req, res) => {
    const rows = await DeviceMaster.find({ isDeleted: false }).sort('name').populate('productId', 'productType name');
    sendExcel(
      res,
      'Asset_Inventory.xlsx',
      ASSET_MASTER_HEADERS,
      rows.map((d) => [
        d.productId?.productType || '',
        d.name,
        d.serialNumber,
        d.purchaseMonth,
        d.cost,
        d.assetType ? formatOwnershipType(d.assetType) : '',
        d.agreementStatus,
        d.custody,
        d.description || '',
      ]),
      { sheetName: 'Asset Registry' }
    );
  })
);

router.get(
  '/import-template',
  canWriteDevicesOrAssets,
  asyncHandler(async (_req, res) => {
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet([
      ASSET_MASTER_HEADERS,
      [
        'Medical Device',
        'CarePlus — BP Monitor Pro',
        'SN-1001',
        '07/2026',
        125000,
        'Tylo Owned',
        'Not Initiated',
        'Tylo Office',
        'Includes cuff kit',
      ],
      [
        'Non-Medical Device',
        'Dell — Latitude 5420',
        'SN-1002',
        '06/2026',
        85000,
        'Tylo Owned',
        'Tylo Office',
        'Tylo Office',
        '',
      ],
    ]);
    ws['!cols'] = [
      { wch: 24 },
      { wch: 28 },
      { wch: 14 },
      { wch: 20 },
      { wch: 16 },
      { wch: 16 },
      { wch: 16 },
      { wch: 20 },
      { wch: 28 },
    ];
    const help = XLSX.utils.aoa_to_sheet([
      ['Asset Type (Product Type) options'],
      ['Medical Device'],
      ['Non-Medical Device'],
      [''],
      ['Ownership Type options'],
      ...OWNERSHIP_TYPE_OPTIONS.map((o) => [o]),
      [''],
      ['Asset Status options'],
      ...AGREEMENT_STATUS_OPTIONS.map((o) => [o]),
      [''],
      ['Asset Custody options'],
      ...DEVICE_CUSTODY_OPTIONS.map((o) => [o]),
      [''],
      ['Note'],
      ['Model / Variant must match an active Product Master display name.'],
      ['Purchase Month & Year use MM/YYYY (e.g. 07/2026).'],
    ]);
    XLSX.utils.book_append_sheet(wb, ws, 'Asset Registry');
    XLSX.utils.book_append_sheet(wb, help, 'Options');
    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    );
    res.setHeader('Content-Disposition', 'attachment; filename="Asset_Inventory_Sample.xlsx"');
    res.send(buf);
  })
);

router.post(
  '/',
  canWriteDevicesOrAssets,
  asyncHandler(async (req, res) => {
    const purchaseMonth = normalizePurchaseMonth(req.body.purchaseMonth || req.body.purchase);
    const data = await createDeviceRecord(
      {
        productId: req.body.productId,
        productType: req.body.productType,
        name: req.body.name || req.body.deviceName,
        assetType: req.body.assetType,
        serialNumber: req.body.serialNumber || req.body.serial,
        cost: req.body.cost ?? req.body.assetValue ?? req.body.deviceValue,
        purchaseMonth,
        description: req.body.description,
        agreementStatus: req.body.agreementStatus ?? req.body.assetStatus,
        custody: req.body.custody || req.body.assetCustody || req.body.deviceCustody,
        contactId: req.body.contactId,
        custodianName: req.body.custodianName,
        custodianContact: req.body.custodianContact,
        custodianCity: req.body.custodianCity || req.body.city,
        custodianState: req.body.custodianState,
      },
      req.user,
      req.requestId
    );
    res.status(201).json({ data });
  })
);

router.post(
  '/import',
  canWriteDevicesOrAssets,
  upload.single('file'),
  asyncHandler(async (req, res) => {
    if (!req.file?.buffer) throw new AppError('Excel file is required', 400, 'VALIDATION_ERROR');

    const wb = XLSX.read(req.file.buffer, { type: 'buffer', cellDates: true });
    const sheet = wb.Sheets[wb.SheetNames[0]];
    if (!sheet) throw new AppError('Excel sheet is empty', 400, 'VALIDATION_ERROR');
    const rows = XLSX.utils.sheet_to_json(sheet, { defval: '' });
    if (!rows.length) throw new AppError('No data rows found in Excel', 400, 'VALIDATION_ERROR');

    const errors = [];
    const created = [];

    for (let i = 0; i < rows.length; i += 1) {
      const row = rows[i];
      const rowNum = i + 2;
      try {
        const name = String(
          normKey(row, [
            'Model / Variant',
            'Asset Name',
            'Device Name',
            'deviceName',
            'Name',
            'Display Name',
          ])
        ).trim();
        const productType = String(
          normKey(row, [
            'Asset Type (Product Type)',
            'Product Type',
            'productType',
            'Asset Type',
          ])
        ).trim();
        const assetType = String(normKey(row, [
          'Ownership Type',
          'ownershipType',
          'Type',
        ])).trim();
        const serialNumber = String(
          normKey(row, [
            'Serial Number',
            'Serial No',
            'Serial No.',
            'serialNumber',
            'Serial',
          ])
        ).trim();
        const cost = Number(
          normKey(row, [
            'Purchase Amount',
            'Asset Value',
            'Cost',
            'deviceValue',
            'Device Value',
            'Price',
          ])
        );
        const purchaseMonth = purchaseFromExcel(
          normKey(row, [
            'Purchase Month & Year',
            'Purchase (MM/YYYY)',
            'Purchase',
            'purchaseMonth',
            'Purchase Month',
            'Added Month',
          ])
        );
        const description = String(
          normKey(row, [
            'Asset & Peripheral Remarks',
            'Description',
            'description',
            'Remarks',
            'Notes',
          ])
        ).trim();
        const agreementStatus = String(
          normKey(row, ['Asset Status', 'Agreement Status', 'agreementStatus', 'assetStatus'])
        ).trim();
        const custody = String(
          normKey(row, ['Asset Custody', 'Device Custody', 'custody', 'Custody'])
        ).trim();
        const custodianName = String(
          normKey(row, ['Custodian Name', 'custodianName', 'Custodian'])
        ).trim();
        const custodianContact = String(
          normKey(row, ['Custodian Contact', 'custodianContact', 'Contact'])
        ).trim();
        const custodianCity = String(
          normKey(row, ['Custodian City', 'custodianCity', 'City'])
        ).trim();
        const custodianState = String(
          normKey(row, ['Custodian State', 'custodianState', 'State'])
        ).trim();

        let productId = '';
        if (name) {
          const product = await LogisticsProduct.findOne({
            isDeleted: false,
            isActive: { $ne: false },
            $or: [
              { name: new RegExp(`^${escapeRegex(name)}$`, 'i') },
              { model: new RegExp(`^${escapeRegex(name)}$`, 'i') },
            ],
            ...(productType ? { productType } : {}),
          }).select('_id name productType');
          if (product) productId = String(product._id);
        }

        const record = await createDeviceRecord(
          {
            name,
            productId: productId || undefined,
            productType: productType || undefined,
            assetType,
            serialNumber,
            cost,
            purchaseMonth,
            description,
            agreementStatus,
            custody,
            custodianName,
            custodianContact,
            custodianCity,
            custodianState,
          },
          req.user,
          req.requestId
        );
        created.push({
          row: rowNum,
          name: record.name,
          serialNumber: record.serialNumber,
        });
      } catch (err) {
        errors.push({ row: rowNum, message: err.message || 'Import failed' });
      }
    }

    await writeAudit({
      actorId: req.user._id,
      actorEmail: req.user.email,
      action: 'ASSET_MASTER.IMPORT',
      entityType: 'DeviceMaster',
      after: {
        fileName: req.file.originalname,
        totalRows: rows.length,
        created: created.length,
        inventoryCreated: created.length,
        errorRows: errors.length,
      },
      requestId: req.requestId,
    });

    let errorReport = null;
    if (errors.length) {
      errorReport = await notifyImportFailures({
        userId: req.user._id,
        importType: 'ASSET_MASTER',
        sourceFileName: req.file.originalname,
        totalRows: rows.length,
        successRows: created.length,
        errors,
        entityType: 'DeviceMaster',
      });
    }

    res.json({
      data: {
        totalRows: rows.length,
        created: created.length,
        inventoryCreated: created.length,
        errorRows: errors.length,
        rows: created,
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

router.patch(
  '/:id',
  canWriteDevicesOrAssets,
  asyncHandler(async (req, res) => {
    const device = await DeviceMaster.findOne({ _id: req.params.id, isDeleted: false });
    if (!device) throw new AppError('Asset not found', 404);

    const updates = {};
    if (req.body.name != null || req.body.deviceName != null) {
      updates.name = String(req.body.name || req.body.deviceName).trim();
      if (!updates.name) throw new AppError('Asset Name is required', 400, 'VALIDATION_ERROR');
    }
    if (req.body.assetType != null) {
      const assetType = normalizeAssetType(req.body.assetType);
      if (!assetType) {
        throw new AppError(
          `Ownership Type must be one of: ${OWNERSHIP_TYPE_OPTIONS.join(', ')}`,
          400,
          'VALIDATION_ERROR'
        );
      }
      updates.assetType = assetType;
    }
    if (req.body.description != null) {
      updates.description = String(req.body.description).trim() || null;
    }
    if (req.body.serialNumber != null || req.body.serial != null) {
      updates.serialNumber = String(req.body.serialNumber || req.body.serial).trim();
      if (!updates.serialNumber) {
        throw new AppError('Serial Number is required', 400, 'VALIDATION_ERROR');
      }
      if (updates.serialNumber !== device.serialNumber) {
        const clash = await Asset.findOne({
          serialNumber: updates.serialNumber,
          isDeleted: false,
        });
        if (clash && String(clash.deviceMasterId) !== String(device._id)) {
          throw new AppError(
            `Serial number “${updates.serialNumber}” already exists`,
            400,
            'SERIAL_EXISTS'
          );
        }
      }
    }
    if (req.body.cost != null || req.body.assetValue != null || req.body.deviceValue != null) {
      const cost = Number(req.body.cost ?? req.body.assetValue ?? req.body.deviceValue);
      if (!Number.isFinite(cost) || cost < 0) {
        throw new AppError('Asset Value must be a valid non-negative number', 400, 'VALIDATION_ERROR');
      }
      updates.cost = cost;
    }
    if (req.body.purchaseMonth != null || req.body.purchase != null) {
      const purchaseMonth = normalizePurchaseMonth(req.body.purchaseMonth || req.body.purchase);
      if (!purchaseMonth) {
        throw new AppError('Purchase month must be MM/YYYY', 400, 'VALIDATION_ERROR');
      }
      updates.purchaseMonth = purchaseMonth;
    }
    if (req.body.agreementStatus != null || req.body.assetStatus != null) {
      const agreementStatus = normalizeAgreementStatus(
        req.body.agreementStatus ?? req.body.assetStatus
      );
      if (!agreementStatus) {
        throw new AppError(
          `Asset Status must be one of: ${AGREEMENT_STATUS_OPTIONS.join(', ')}`,
          400,
          'VALIDATION_ERROR'
        );
      }
      updates.agreementStatus = agreementStatus;
    }
    if (
      req.body.custody != null ||
      req.body.assetCustody != null ||
      req.body.deviceCustody != null
    ) {
      const custody = normalizeDeviceCustody(
        req.body.custody || req.body.assetCustody || req.body.deviceCustody
      );
      if (!custody) {
        throw new AppError(
          `Asset Custody must be one of: ${DEVICE_CUSTODY_OPTIONS.join(', ')}`,
          400,
          'VALIDATION_ERROR'
        );
      }
      updates.custody = custody;
    }
    if (req.body.custodianName != null) {
      updates.custodianName = String(req.body.custodianName).trim();
    }
    if (req.body.custodianContact != null) {
      const custodianContact = String(req.body.custodianContact).trim();
      if (custodianContact) {
        assertValidPhoneOrEmail(custodianContact, 'Custodian Contact');
      }
      updates.custodianContact = custodianContact;
    }
    if (req.body.custodianCity != null || req.body.city != null) {
      updates.custodianCity = String(req.body.custodianCity ?? req.body.city).trim();
    }
    if (req.body.custodianState != null) {
      const custodianState = normalizeCustodianState(req.body.custodianState);
      updates.custodianState = custodianState || '';
    }
    if (req.body.isActive != null) updates.isActive = Boolean(req.body.isActive);

    const next = await DeviceMaster.findOneAndUpdate(
      { _id: device._id, isDeleted: false },
      { $set: updates },
      { new: true }
    );

    const assetPatch = {};
    if (updates.name != null) assetPatch.deviceNameSnapshot = updates.name;
    if (updates.serialNumber != null) assetPatch.serialNumber = updates.serialNumber;
    if (updates.cost != null) assetPatch.deviceValue = updates.cost;
    if (updates.purchaseMonth != null) {
      assetPatch.addedMonth = updates.purchaseMonth;
      assetPatch.purchaseDate = purchaseMonthToDate(updates.purchaseMonth);
    }
    if (updates.description !== undefined) {
      assetPatch.remarks = updates.description || undefined;
    }
    if (updates.agreementStatus != null) assetPatch.agreementStatus = updates.agreementStatus;
    if (updates.custody != null) assetPatch.custody = updates.custody;
    if (updates.assetType != null) assetPatch.assetType = updates.assetType;
    if (updates.custodianName != null) assetPatch.custodianName = updates.custodianName;
    if (updates.custodianContact != null) assetPatch.custodianContact = updates.custodianContact;
    if (updates.custodianCity != null || updates.custodianState != null) {
      const merged = {
        ...(device.custodianCity || next.custodianCity
          ? { city: updates.custodianCity ?? next.custodianCity }
          : {}),
        ...(updates.custodianState || next.custodianState
          ? { state: updates.custodianState ?? next.custodianState }
          : {}),
      };
      if (updates.custodianCity != null) merged.city = updates.custodianCity;
      if (updates.custodianState != null) merged.state = updates.custodianState;
      assetPatch.location = merged;
    }
    if (Object.keys(assetPatch).length) {
      await Asset.updateMany(
        { deviceMasterId: device._id, isDeleted: false },
        { $set: assetPatch }
      );
    }

    await writeAudit({
      actorId: req.user._id,
      actorEmail: req.user.email,
      action: 'ASSET_MASTER.UPDATE',
      entityType: 'DeviceMaster',
      entityId: next._id,
      after: next.toObject(),
      requestId: req.requestId,
    });

    res.json({ data: next });
  })
);

router.delete(
  '/:id',
  requireAdmin,
  asyncHandler(async (req, res) => {
    const device = await DeviceMaster.findOne({ _id: req.params.id, isDeleted: false });
    if (!device) throw new AppError('Asset not found', 404);

    const inUse = await Asset.countDocuments({
      deviceMasterId: device._id,
      isDeleted: false,
    });
    if (inUse > 0) {
      throw new AppError(
        `Cannot delete “${device.name}”: ${inUse} Asset Registry item${inUse === 1 ? '' : 's'} still use this asset. Retire or reassign those items first.`,
        400,
        'ASSET_IN_USE'
      );
    }

    device.isDeleted = true;
    device.isActive = false;
    await device.save();

    await writeAudit({
      actorId: req.user._id,
      actorEmail: req.user.email,
      action: 'ASSET_MASTER.DELETE',
      entityType: 'DeviceMaster',
      entityId: device._id,
      requestId: req.requestId,
    });

    res.json({ data: { ok: true } });
  })
);

export default router;

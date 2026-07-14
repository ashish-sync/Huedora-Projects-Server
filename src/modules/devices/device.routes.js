import { Router } from 'express';
import multer from 'multer';
import XLSX from 'xlsx';
import { authenticate, requirePermission } from '../../middleware/auth.js';
import { asyncHandler, parsePagination, paginated, AppError } from '../../utils/helpers.js';
import { PERMISSIONS } from '../../config/constants.js';
import { DeviceMaster } from './device.model.js';
import { Asset } from '../assets/asset.model.js';
import { createAsset } from '../assets/asset.service.js';
import { writeAudit } from '../../utils/audit.js';
import { sendExcel } from '../../utils/excelExport.js';
import {
  ASSET_TYPE_OPTIONS,
  AGREEMENT_STATUS_OPTIONS,
  DEVICE_CUSTODY_OPTIONS,
  INDIAN_STATES_AND_UTS,
  normalizeAgreementStatus,
  normalizeDeviceCustody,
  normalizeAssetType,
  normalizeCustodianState,
} from './device.constants.js';

const canWriteDevicesOrAssets = requirePermission(
  PERMISSIONS.DEVICES_WRITE,
  PERMISSIONS.ASSETS_WRITE
);

const ASSET_MASTER_HEADERS = [
  'Asset Name',
  'Asset Type',
  'Serial Number',
  'Asset Value',
  'Purchase (MM/YYYY)',
  'Asset Status',
  'Asset Custody',
  'Custodian Name',
  'Custodian Contact',
  'Custodian City',
  'Custodian State',
  'Description',
];

const router = Router();
router.use(authenticate);

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
  const name = String(input.name || '').trim();
  if (!name) throw new AppError('Asset Name is required', 400, 'VALIDATION_ERROR');

  const assetType = normalizeAssetType(input.assetType);
  if (!assetType) {
    throw new AppError(
      `Asset Type is required and must be one of: ${ASSET_TYPE_OPTIONS.join(', ')}`,
      400,
      'VALIDATION_ERROR'
    );
  }

  const serialNumber = String(input.serialNumber || '').trim();
  if (!serialNumber) throw new AppError('Serial Number is required', 400, 'VALIDATION_ERROR');

  const purchaseMonth = input.purchaseMonth;
  if (!purchaseMonth || !PURCHASE_RE.test(purchaseMonth)) {
    throw new AppError('Purchase month is required as MM/YYYY', 400, 'VALIDATION_ERROR');
  }

  const cost = input.cost == null || input.cost === '' ? null : Number(input.cost);
  if (cost == null || !Number.isFinite(cost) || cost < 0) {
    throw new AppError('Asset Value is required and must be a non-negative number', 400, 'VALIDATION_ERROR');
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

  const custodianName = String(input.custodianName || '').trim();
  if (!custodianName) throw new AppError('Custodian Name is required', 400, 'VALIDATION_ERROR');

  const custodianContact = String(input.custodianContact || '').trim();
  if (!custodianContact) throw new AppError('Custodian Contact is required', 400, 'VALIDATION_ERROR');

  const custodianCity = String(input.custodianCity || input.city || '').trim();
  if (!custodianCity) throw new AppError('Custodian City is required', 400, 'VALIDATION_ERROR');

  const custodianState = normalizeCustodianState(input.custodianState);
  if (!custodianState) {
    throw new AppError('Custodian State is required (Indian state or union territory)', 400, 'VALIDATION_ERROR');
  }

  const description = String(input.description || '').trim() || null;

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
  };
}

async function createDeviceRecord(input, user, requestId) {
  const fields = parseMasterFields(input);

  const existing = await Asset.findOne({ serialNumber: fields.serialNumber, isDeleted: false });
  if (existing) {
    throw new AppError(`Serial number “${fields.serialNumber}” already exists`, 400, 'SERIAL_EXISTS');
  }

  const purchaseDate = purchaseMonthToDate(fields.purchaseMonth);

  const device = await DeviceMaster.create({
    ...fields,
    quantity: 1,
    isActive: true,
  });

  const asset = await createAsset(
    {
      deviceMasterId: device._id,
      deviceNameSnapshot: fields.name,
      serialNumber: fields.serialNumber,
      quantity: 1,
      status: 'Purchased',
      deviceValue: fields.cost,
      purchaseDate,
      addedMonth: fields.purchaseMonth,
      remarks: fields.description || undefined,
      agreementStatus: fields.agreementStatus,
      custody: fields.custody,
      assetType: fields.assetType,
      custodianName: fields.custodianName,
      custodianContact: fields.custodianContact,
      location: {
        city: fields.custodianCity,
        state: fields.custodianState,
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
      const re = new RegExp(String(req.query.q), 'i');
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
    const rows = await DeviceMaster.find({ isDeleted: false }).sort('name');
    sendExcel(
      res,
      'Asset_Inventory.xlsx',
      ASSET_MASTER_HEADERS,
      rows.map((d) => [
        d.name,
        d.assetType,
        d.serialNumber,
        d.cost,
        d.purchaseMonth,
        d.agreementStatus,
        d.custody,
        d.custodianName,
        d.custodianContact,
        d.custodianCity,
        d.custodianState,
        d.description,
      ]),
      { sheetName: 'Asset Inventory' }
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
        'Ultrasound Probe X2',
        'Owned',
        'SN-1001',
        125000,
        '07/2026',
        'Not Initiated',
        'KHPL - Mumbai Warehouse',
        'Ravi Kumar',
        '9876543210',
        'Mumbai',
        'Maharashtra',
        'Sample vendor batch',
      ],
      [
        'BP Monitor A1',
        'Rented',
        'SN-1002',
        8500,
        '06/2026',
        'Agreement Signed',
        'Client / Rented',
        'Priya Sharma',
        'priya@example.com',
        'Hyderabad',
        'Telangana',
        '',
      ],
    ]);
    ws['!cols'] = [
      { wch: 22 },
      { wch: 12 },
      { wch: 14 },
      { wch: 12 },
      { wch: 18 },
      { wch: 16 },
      { wch: 26 },
      { wch: 18 },
      { wch: 18 },
      { wch: 14 },
      { wch: 28 },
      { wch: 24 },
    ];
    const help = XLSX.utils.aoa_to_sheet([
      ['Asset Type options'],
      ...ASSET_TYPE_OPTIONS.map((o) => [o]),
      [''],
      ['Asset Status options'],
      ...AGREEMENT_STATUS_OPTIONS.map((o) => [o]),
      [''],
      ['Asset Custody options'],
      ...DEVICE_CUSTODY_OPTIONS.map((o) => [o]),
      [''],
      ['Custodian State options (28 states + 8 UTs)'],
      ...INDIAN_STATES_AND_UTS.map((o) => [o]),
    ]);
    XLSX.utils.book_append_sheet(wb, ws, 'Asset Inventory');
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
        name: req.body.name || req.body.deviceName,
        assetType: req.body.assetType,
        serialNumber: req.body.serialNumber || req.body.serial,
        cost: req.body.cost ?? req.body.assetValue ?? req.body.deviceValue,
        purchaseMonth,
        description: req.body.description,
        agreementStatus: req.body.agreementStatus ?? req.body.assetStatus,
        custody: req.body.custody || req.body.assetCustody || req.body.deviceCustody,
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
          normKey(row, ['Asset Name', 'Device Name', 'deviceName', 'Name'])
        ).trim();
        const assetType = String(normKey(row, ['Asset Type', 'assetType', 'Type'])).trim();
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
          normKey(row, ['Asset Value', 'Cost', 'deviceValue', 'Device Value', 'Price'])
        );
        const purchaseMonth = purchaseFromExcel(
          normKey(row, [
            'Purchase (MM/YYYY)',
            'Purchase',
            'purchaseMonth',
            'Purchase Month',
            'Added Month',
          ])
        );
        const description = String(
          normKey(row, ['Description', 'description', 'Remarks', 'Notes'])
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

        const record = await createDeviceRecord(
          {
            name,
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

    res.json({
      data: {
        totalRows: rows.length,
        created: created.length,
        inventoryCreated: created.length,
        errorRows: errors.length,
        rows: created,
        errors: errors.slice(0, 200),
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
          `Asset Type must be one of: ${ASSET_TYPE_OPTIONS.join(', ')}`,
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
      const custodianName = String(req.body.custodianName).trim();
      if (!custodianName) {
        throw new AppError('Custodian Name is required', 400, 'VALIDATION_ERROR');
      }
      updates.custodianName = custodianName;
    }
    if (req.body.custodianContact != null) {
      const custodianContact = String(req.body.custodianContact).trim();
      if (!custodianContact) {
        throw new AppError('Custodian Contact is required', 400, 'VALIDATION_ERROR');
      }
      updates.custodianContact = custodianContact;
    }
    if (req.body.custodianCity != null || req.body.city != null) {
      const custodianCity = String(req.body.custodianCity ?? req.body.city).trim();
      if (!custodianCity) {
        throw new AppError('Custodian City is required', 400, 'VALIDATION_ERROR');
      }
      updates.custodianCity = custodianCity;
    }
    if (req.body.custodianState != null) {
      const custodianState = normalizeCustodianState(req.body.custodianState);
      if (!custodianState) {
        throw new AppError(
          'Custodian State must be a valid Indian state or union territory',
          400,
          'VALIDATION_ERROR'
        );
      }
      updates.custodianState = custodianState;
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
  canWriteDevicesOrAssets,
  asyncHandler(async (req, res) => {
    const device = await DeviceMaster.findOne({ _id: req.params.id, isDeleted: false });
    if (!device) throw new AppError('Asset not found', 404);

    const inUse = await Asset.countDocuments({
      deviceMasterId: device._id,
      isDeleted: false,
    });
    if (inUse > 0) {
      throw new AppError(
        `Cannot delete “${device.name}” — ${inUse} Asset Inventory item${inUse === 1 ? '' : 's'} still use this asset. Retire or reassign those items first.`,
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

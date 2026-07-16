import {
  DEFAULT_MOVEMENT_TYPES,
  DEFAULT_REASON_CODES,
  DEFAULT_STOCK_STATUSES,
  DEFAULT_WAREHOUSE_CODE,
  DEFAULT_WAREHOUSE_NAME,
} from './logistics.constants.js';
import {
  LogisticsCategory,
  LogisticsMovementType,
  LogisticsProduct,
  LogisticsReasonCode,
  LogisticsStockStatus,
  LogisticsSupplier,
  LogisticsUom,
  LogisticsWarehouse,
} from './logistics.model.js';

/** Seed logistics lookup rows — idempotent, does not touch DHub lifecycle data */
export async function ensureLogisticsSeed() {
  const mum = await LogisticsWarehouse.findOne({
    $or: [{ code: DEFAULT_WAREHOUSE_CODE }, { name: DEFAULT_WAREHOUSE_NAME }],
    isDeleted: false,
  });
  if (!mum) {
    await LogisticsWarehouse.create({
      code: DEFAULT_WAREHOUSE_CODE,
      name: DEFAULT_WAREHOUSE_NAME,
      city: 'Mumbai',
      state: 'Maharashtra',
      address: '',
      isActive: true,
    });
  }

  for (const name of DEFAULT_STOCK_STATUSES) {
    const code = name.toUpperCase().replace(/\s+/g, '_');
    const existing = await LogisticsStockStatus.findOne({ code, isDeleted: false });
    if (!existing) {
      await LogisticsStockStatus.create({
        code,
        name,
        isSystem: true,
        isActive: true,
      });
    }
  }

  for (const m of DEFAULT_MOVEMENT_TYPES) {
    const existing = await LogisticsMovementType.findOne({ code: m.code, isDeleted: false });
    if (!existing) {
      await LogisticsMovementType.create({
        code: m.code,
        name: m.name,
        direction: m.direction,
        isSystem: true,
        isActive: true,
      });
    }
  }

  for (const r of DEFAULT_REASON_CODES) {
    const existing = await LogisticsReasonCode.findOne({ code: r.code, isDeleted: false });
    if (!existing) {
      await LogisticsReasonCode.create({
        code: r.code,
        name: r.name,
        isSystem: true,
        isActive: true,
      });
    }
  }

  const defaultUoms = [
    { code: 'EA', name: 'Each' },
    { code: 'BOX', name: 'Box' },
    { code: 'SET', name: 'Set' },
  ];
  for (const u of defaultUoms) {
    const existing = await LogisticsUom.findOne({ code: u.code, isDeleted: false });
    if (!existing) {
      await LogisticsUom.create({ ...u, isActive: true });
    }
  }

  const defaultCategories = [
    { code: 'CONSUMABLE', name: 'Consumable', description: 'Field consumables' },
    { code: 'MED_DEVICE', name: 'Medical Device', description: 'Medical devices' },
  ];
  for (const c of defaultCategories) {
    const existing = await LogisticsCategory.findOne({ code: c.code, isDeleted: false });
    if (!existing) {
      await LogisticsCategory.create({ ...c, isActive: true });
    }
  }

  const defaultProducts = [
    {
      code: 'GLUCOSTRIP',
      name: 'Glucose Test Strips',
      productType: 'Consumable',
      sku: 'GLUCOSTRIP',
      expiryApplicable: true,
      trackingKind: 'Batch',
      defaultPerUnitCost: 12,
    },
    {
      code: 'BP-MONITOR',
      name: 'BP Monitor',
      productType: 'Medical Device',
      sku: 'BP-MONITOR',
      expiryApplicable: false,
      trackingKind: 'Serial',
      defaultPerUnitCost: 2500,
    },
  ];
  for (const p of defaultProducts) {
    const existing = await LogisticsProduct.findOne({
      $or: [{ code: p.code }, { sku: p.sku }],
      isDeleted: false,
    });
    if (!existing) {
      await LogisticsProduct.create({ ...p, isActive: true });
    }
  }

  const parties = await LogisticsSupplier.find({ isDeleted: false });
  for (const party of parties) {
    const raw = String(party.partyType || '').trim();
    let next = raw;
    if (!raw || /^supplier$/i.test(raw)) next = 'Supplier';
    else if (/^vendor$/i.test(raw)) next = 'Vendor';
    if (next !== party.partyType) {
      party.partyType = next;
      await party.save();
    }
  }

  const demoSupplier = await LogisticsSupplier.findOne({ code: 'DEMO-SUP', isDeleted: false });
  if (!demoSupplier) {
    await LogisticsSupplier.create({
      code: 'DEMO-SUP',
      name: 'Demo Supplier',
      partyType: 'Supplier',
      city: 'Mumbai',
      state: 'Maharashtra',
      isActive: true,
    });
  }
  const demoVendor = await LogisticsSupplier.findOne({ code: 'DEMO-VEN', isDeleted: false });
  if (!demoVendor) {
    await LogisticsSupplier.create({
      code: 'DEMO-VEN',
      name: 'Demo Vendor',
      partyType: 'Vendor',
      city: 'Mumbai',
      state: 'Maharashtra',
      isActive: true,
    });
  }
}

import {
  DEFAULT_EXPENSE_CATEGORIES,
  DEFAULT_MOVEMENT_TYPES,
  DEFAULT_REASON_CODES,
  DEFAULT_STOCK_STATUSES,
  DEFAULT_WAREHOUSE_CODE,
  DEFAULT_WAREHOUSE_NAME,
} from './logistics.constants.js';
import {
  LogisticsCategory,
  LogisticsExpenseCategory,
  LogisticsMovementType,
  LogisticsProduct,
  LogisticsReasonCode,
  LogisticsStockStatus,
  LogisticsSupplier,
  LogisticsUom,
  LogisticsWarehouse,
} from './logistics.model.js';

/** Seed logistics lookup rows. idempotent, does not touch TYLO One lifecycle data */
export async function ensureLogisticsSeed() {
  const mum = await LogisticsWarehouse.findOne({
    $or: [
      { code: DEFAULT_WAREHOUSE_CODE },
      { name: DEFAULT_WAREHOUSE_NAME },
      { name: 'Mumbai Warehouse' },
    ],
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
  } else {
    let changed = false;
    if (mum.name !== DEFAULT_WAREHOUSE_NAME) {
      mum.name = DEFAULT_WAREHOUSE_NAME;
      changed = true;
    }
    if (mum.code !== DEFAULT_WAREHOUSE_CODE) {
      mum.code = DEFAULT_WAREHOUSE_CODE;
      changed = true;
    }
    if (!mum.city) {
      mum.city = 'Mumbai';
      changed = true;
    }
    if (mum.isActive === false) {
      mum.isActive = true;
      changed = true;
    }
    if (changed) await mum.save();
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

  const canonicalExpenseNames = new Set(
    DEFAULT_EXPENSE_CATEGORIES.map((c) => c.name.toLowerCase())
  );
  for (const cat of DEFAULT_EXPENSE_CATEGORIES) {
    const existing = await LogisticsExpenseCategory.findOne({
      $or: [{ code: cat.code }, { name: cat.name }],
      isDeleted: false,
    });
    if (!existing) {
      await LogisticsExpenseCategory.create({
        code: cat.code,
        name: cat.name,
        covers: cat.covers,
        isSystem: true,
        isActive: true,
      });
    } else {
      existing.code = cat.code;
      existing.name = cat.name;
      existing.covers = cat.covers;
      existing.isSystem = true;
      existing.isActive = true;
      await existing.save();
    }
  }
  // Soft-delete legacy seeded expense categories not in the finance master list
  const legacyNames = new Set(['travel', 'meals', 'parts', 'shipping', 'service']);
  const legacyExpense = await LogisticsExpenseCategory.find({ isDeleted: false });
  for (const row of legacyExpense) {
    const nameKey = String(row.name || '').toLowerCase();
    if (canonicalExpenseNames.has(nameKey)) continue;
    if (legacyNames.has(nameKey) || legacyNames.has(String(row.code || '').toLowerCase())) {
      row.isDeleted = true;
      row.isActive = false;
      await row.save();
    }
  }

  const defaultUoms = [
    { code: 'PCS', name: 'Piece' },
    { code: 'BOX', name: 'Box' },
    { code: 'PACK', name: 'Pack' },
    { code: 'KIT', name: 'Kit' },
    { code: 'CTN', name: 'Carton' },
    { code: 'ROLL', name: 'Roll' },
    { code: 'BTL', name: 'Bottle' },
    { code: 'SET', name: 'Set' },
    { code: 'PAIR', name: 'Pair' },
    { code: 'DOC', name: 'Document' },
  ];
  for (const u of defaultUoms) {
    const existing = await LogisticsUom.findOne({ code: u.code, isDeleted: false });
    if (!existing) {
      await LogisticsUom.create({ ...u, isActive: true });
    } else if (existing.name !== u.name) {
      existing.name = u.name;
      existing.isActive = true;
      await existing.save();
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
      code: 'OT0001',
      name: 'Glucose Test Strips',
      productType: 'Other',
      inventoryType: 'Multi-use',
      sku: 'SKU-SEED01',
      brand: 'Generic',
      manufacturer: 'Generic',
      expiryApplicable: true,
      shelfLifeMonths: 24,
      trackingKind: 'Batch',
      unitsPerPack: 100,
      standardCost: 12,
      defaultPerUnitCost: 12,
      gstRate: 12,
    },
    {
      code: 'MD0001',
      name: 'BP Monitor',
      productType: 'Medical Device',
      inventoryType: 'Multi-use',
      sku: 'SKU-SEED02',
      brand: 'Generic',
      manufacturer: 'Generic',
      expiryApplicable: false,
      trackingKind: 'Serial',
      unitsPerPack: 1,
      standardCost: 2500,
      defaultPerUnitCost: 2500,
      gstRate: 18,
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

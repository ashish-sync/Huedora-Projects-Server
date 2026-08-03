import {
  DEFAULT_MOVEMENT_TYPES,
  DEFAULT_REASON_CODES,
  DEFAULT_STOCK_STATUSES,
  DEFAULT_UOMS,
  DEFAULT_WAREHOUSE_CODE,
  DEFAULT_WAREHOUSE_NAME,
  IN_OUT_PRODUCT_TYPE_ALIASES,
  IN_OUT_PRODUCT_TYPES,
  MEDICAL_DEVICE_CATEGORY_ALIASES,
  MEDICAL_DEVICE_PRODUCT_CATEGORIES,
  PRODUCT_INVENTORY_TYPE_ALIASES,
  SUPPLEMENTAL_UOMS,
  UOM_LEGACY_CODE_ALIASES,
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

function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Create or update a UOM row without duplicating by code or name. */
async function ensureUom({ code, name }) {
  const normCode = String(code).trim().toUpperCase();
  const normName = String(name).trim();

  let existing = await LogisticsUom.findOne({ code: normCode, isDeleted: false });
  if (!existing) {
    for (const [legacy, canonical] of Object.entries(UOM_LEGACY_CODE_ALIASES)) {
      if (canonical === normCode) {
        existing = await LogisticsUom.findOne({ code: legacy, isDeleted: false });
        if (existing) break;
      }
    }
  }
  if (!existing) {
    existing = await LogisticsUom.findOne({
      isDeleted: false,
      name: new RegExp(`^${escapeRegex(normName)}$`, 'i'),
    });
  }

  if (!existing) {
    await LogisticsUom.create({ code: normCode, name: normName, isActive: true });
    return;
  }

  let changed = false;
  if (existing.code !== normCode) {
    existing.code = normCode;
    changed = true;
  }
  if (existing.name !== normName) {
    existing.name = normName;
    changed = true;
  }
  if (existing.isActive === false) {
    existing.isActive = true;
    changed = true;
  }
  if (changed) await existing.save();
}

function normalizeSeededProductType(raw) {
  const v = String(raw || '').trim();
  if (!v) return v;
  if (IN_OUT_PRODUCT_TYPES.includes(v)) return v;
  if (IN_OUT_PRODUCT_TYPE_ALIASES[v]) return IN_OUT_PRODUCT_TYPE_ALIASES[v];
  const hit = Object.entries(IN_OUT_PRODUCT_TYPE_ALIASES).find(
    ([k]) => k.toLowerCase() === v.toLowerCase()
  );
  return hit?.[1] || v;
}

function normalizeSeededInventoryType(raw) {
  const v = String(raw || '').trim();
  if (!v) return v;
  if (v === 'Asset' || v === 'Inventory') return v;
  return PRODUCT_INVENTORY_TYPE_ALIASES[v] || v;
}

function normalizeSeededMedicalDeviceCategory(raw) {
  const v = String(raw || '').trim();
  if (!v) return '';
  if (MEDICAL_DEVICE_PRODUCT_CATEGORIES.includes(v)) return v;
  if (MEDICAL_DEVICE_CATEGORY_ALIASES[v]) return MEDICAL_DEVICE_CATEGORY_ALIASES[v];
  const hit = Object.entries(MEDICAL_DEVICE_CATEGORY_ALIASES).find(
    ([k]) => k.toLowerCase() === v.toLowerCase()
  );
  return hit?.[1] || 'Others';
}

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

  const EXPENSE_MASTER_RESET_CODE = '_EXPENSE_MASTER_RESET_2026';
  const legacyReset = await LogisticsExpenseCategory.findOne({ code: EXPENSE_MASTER_RESET_CODE });
  if (legacyReset) {
    legacyReset.isDeleted = true;
    legacyReset.isActive = false;
    await legacyReset.save();
  }

  const { ensureExpenseMasterSeed } = await import('./expenseMaster.seed.js');
  await ensureExpenseMasterSeed();

  for (const u of [...DEFAULT_UOMS, ...SUPPLEMENTAL_UOMS]) {
    await ensureUom(u);
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
      inventoryType: 'Asset',
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
      inventoryType: 'Asset',
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

  const catalogProducts = await LogisticsProduct.find({ isDeleted: false });
  for (const row of catalogProducts) {
    const nextType = normalizeSeededProductType(row.productType);
    const nextInventory = normalizeSeededInventoryType(row.inventoryType);
    let changed = false;
    if (nextType && nextType !== row.productType) {
      row.productType = nextType;
      changed = true;
    }
    if (nextInventory && nextInventory !== row.inventoryType) {
      row.inventoryType = nextInventory;
      changed = true;
    }
    if (nextType === 'Medical Device' || row.productType === 'Medical Device') {
      const nextCategory = normalizeSeededMedicalDeviceCategory(row.productCategory);
      if (nextCategory && nextCategory !== row.productCategory) {
        row.productCategory = nextCategory;
        changed = true;
      }
    }
    if (changed) await row.save();
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

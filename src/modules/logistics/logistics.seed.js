import {
  DEFAULT_MOVEMENT_TYPES,
  DEFAULT_REASON_CODES,
  DEFAULT_STOCK_STATUSES,
  DEFAULT_WAREHOUSE_CODE,
  DEFAULT_WAREHOUSE_NAME,
} from './logistics.constants.js';
import {
  LogisticsMovementType,
  LogisticsReasonCode,
  LogisticsStockStatus,
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
}

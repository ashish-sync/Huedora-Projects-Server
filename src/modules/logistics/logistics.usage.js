import { CampRequest } from '../camps/camp.model.js';
import { LogisticsUsageEntry } from './logistics.model.js';

/** Map camp process → default inventory type label for usage rollups */
const PROCESS_INVENTORY = {
  'NT PRO - BNP': 'NTPro BNP Strips',
  Lipidocare: 'Lipid Strips',
  'Vitamin D3': 'Afias strips',
  Neuro: 'Neuro Consumable',
  BMD: 'BMD Report',
  Uroflow: 'Uroflow Consumable',
  Dietitian: 'Dietitian Kit',
};

/**
 * Ensure approved camps appear as usage rows (auto-updated from Camp Management).
 * Idempotent upsert by campRequestId.
 */
export async function syncUsageFromCamps() {
  const camps = await CampRequest.find({
    isDeleted: false,
    status: { $in: ['Approved', 'Completed', 'Executed'] },
  });

  let upserted = 0;
  for (const camp of camps) {
    const campId = camp._id;
    if (!campId) continue;
    const existing = await LogisticsUsageEntry.findOne({
      campRequestId: campId,
      isDeleted: false,
    });

    const inventoryType =
      PROCESS_INVENTORY[camp.process] || camp.process || 'Camp consumable';
    const screenCount =
      Number(camp.screenCount ?? camp.actualPatients ?? camp.expectedPatients ?? camp.patients ?? 0) ||
      0;
    const wastage = Number(camp.wastage ?? camp.wastageQty ?? 0) || 0;

    const payload = {
      hcwId: String(camp.technicianContactId || camp.technicianNumber || '').trim(),
      hcwName: camp.technicianName || '',
      clientName: camp.clientName || camp.requesterName || '',
      processName: camp.process || '',
      inventoryType,
      productName: inventoryType,
      doctorName: camp.doctorName || '',
      machineCity: camp.city || '',
      campDate: camp.campDate || '',
      screenCount: existing ? Number(existing.screenCount) || screenCount : screenCount,
      usedQty: existing ? Number(existing.usedQty) || screenCount : screenCount,
      wastage: existing ? Number(existing.wastage) || wastage : wastage,
      campRequestId: campId,
      source: 'camp',
      remark: existing?.remark || `Camp ${camp.requestKey || campId}`,
      isActive: true,
      isDeleted: false,
    };

    if (existing) {
      // Keep manual overrides for screenCount/wastage if already edited
      Object.assign(existing, {
        hcwId: payload.hcwId || existing.hcwId,
        hcwName: payload.hcwName || existing.hcwName,
        clientName: payload.clientName || existing.clientName,
        processName: payload.processName,
        inventoryType: existing.inventoryType || payload.inventoryType,
        productName: existing.productName || payload.productName,
        doctorName: payload.doctorName,
        machineCity: payload.machineCity,
        campDate: payload.campDate,
        source: 'camp',
      });
      await existing.save();
    } else {
      await LogisticsUsageEntry.create(payload);
      upserted += 1;
    }
  }
  return { camps: camps.length, upserted };
}

export async function listUsageMerged() {
  await syncUsageFromCamps();
  return LogisticsUsageEntry.find({ isDeleted: false }).sort('-campDate');
}

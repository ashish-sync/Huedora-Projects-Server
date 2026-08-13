import { Asset } from '../modules/assets/asset.model.js';
import { DeviceMaster } from '../modules/devices/device.model.js';
import { normalizeSerialNumber } from '../modules/assets/serialNumber.js';

function assetScore(asset) {
  let score = 0;
  if (asset.deviceMasterId) score += 4;
  if (asset.contactId) score += 2;
  if (asset.deviceValue != null && Number(asset.deviceValue) > 0) score += 2;
  if (asset.location?.city || asset.custodianName) score += 1;
  if (Array.isArray(asset.documents) && asset.documents.length) score += 3;
  if (asset.agreementId) score += 2;
  return score;
}

function pickKeeper(assets) {
  return [...assets].sort((a, b) => {
    const scoreDiff = assetScore(b) - assetScore(a);
    if (scoreDiff) return scoreDiff;
    return String(a.createdAt || '').localeCompare(String(b.createdAt || ''));
  })[0];
}

/**
 * Soft-delete duplicate active assets that share the same normalized serial number.
 * Keeps the richest/oldest row per serial and normalizes its serialNumber.
 */
export async function dedupeAssetsBySerialNumber({
  actorId = null,
  dryRun = false,
} = {}) {
  const assets = await Asset.find({ isDeleted: false });
  const groups = new Map();

  for (const asset of assets) {
    const key = normalizeSerialNumber(asset.serialNumber);
    if (!key) continue;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(asset);
  }

  const duplicateGroups = [...groups.entries()].filter(([, rows]) => rows.length > 1);
  const now = new Date().toISOString();
  const kept = [];
  const purged = [];
  const normalizedKeepers = [];

  for (const [serialNumber, rows] of duplicateGroups) {
    const keeper = pickKeeper(rows);
    const dupes = rows.filter((row) => String(row._id) !== String(keeper._id));

    kept.push({
      _id: String(keeper._id),
      serialNumber,
      assetTag: keeper.assetTag || null,
      count: rows.length,
    });

    if (!dryRun) {
      if (normalizeSerialNumber(keeper.serialNumber) !== serialNumber
        || String(keeper.serialNumber || '') !== serialNumber) {
        keeper.serialNumber = serialNumber;
        await keeper.save();
        normalizedKeepers.push(String(keeper._id));
      }
    } else if (String(keeper.serialNumber || '') !== serialNumber) {
      normalizedKeepers.push(String(keeper._id));
    }

    for (const dupe of dupes) {
      purged.push({
        _id: String(dupe._id),
        serialNumber,
        assetTag: dupe.assetTag || null,
        deviceMasterId: dupe.deviceMasterId ? String(dupe.deviceMasterId) : null,
      });
      if (dryRun) continue;
      dupe.isDeleted = true;
      dupe.deletedAt = now;
      dupe.deletedBy = actorId ? String(actorId) : null;
      await dupe.save();
    }
  }

  // Soft-delete DeviceMaster rows that no longer have any active assets and
  // share a serial with a kept asset (or are blank orphans left by dedupe).
  let deviceMastersPurged = 0;
  if (!dryRun) {
    const activeAssets = await Asset.find({ isDeleted: false });
    const activeDeviceIds = new Set(
      activeAssets
        .map((a) => (a.deviceMasterId ? String(a.deviceMasterId) : ''))
        .filter(Boolean),
    );
    const keptSerials = new Set(kept.map((k) => k.serialNumber));
    const devices = await DeviceMaster.find({ isDeleted: false });
    for (const device of devices) {
      const id = String(device._id);
      if (activeDeviceIds.has(id)) {
        const serial = normalizeSerialNumber(device.serialNumber);
        if (serial && String(device.serialNumber || '') !== serial) {
          device.serialNumber = serial;
          await device.save();
        }
        continue;
      }
      const serial = normalizeSerialNumber(device.serialNumber);
      if (!serial || !keptSerials.has(serial)) continue;
      device.isDeleted = true;
      device.deletedAt = now;
      device.deletedBy = actorId ? String(actorId) : null;
      await device.save();
      deviceMastersPurged += 1;
    }
  }

  return {
    dryRun: Boolean(dryRun),
    duplicateSerialCount: duplicateGroups.length,
    assetsScanned: assets.length,
    assetsKept: kept.length,
    assetsPurged: purged.length,
    keepersNormalized: normalizedKeepers.length,
    deviceMastersPurged,
    samples: kept.slice(0, 20),
  };
}

export async function countDuplicateAssetSerials() {
  const assets = await Asset.find({ isDeleted: false });
  const counts = new Map();
  for (const asset of assets) {
    const key = normalizeSerialNumber(asset.serialNumber);
    if (!key) continue;
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  const duplicates = [...counts.entries()].filter(([, n]) => n > 1);
  return {
    totalAssets: assets.length,
    duplicateSerialCount: duplicates.length,
    duplicateAssetCount: duplicates.reduce((sum, [, n]) => sum + n, 0),
  };
}

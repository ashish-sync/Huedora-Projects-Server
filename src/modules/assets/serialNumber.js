import { AppError } from '../../utils/helpers.js';
import { formatTextValue } from '../../utils/textFormat.js';
import { Asset } from './asset.model.js';

/**
 * Normalize Asset One serial numbers before validation/storage:
 * trim, remove all internal whitespace, uppercase.
 */
export function normalizeSerialNumber(value) {
  const formatted = formatTextValue(String(value ?? ''), 'serialNumber');
  if (typeof formatted !== 'string') return '';
  return formatted.replace(/\s+/g, '');
}

export function requireNormalizedSerialNumber(value) {
  const serialNumber = normalizeSerialNumber(value);
  if (!serialNumber) {
    throw new AppError('Serial Number is required', 400, 'VALIDATION_ERROR');
  }
  return serialNumber;
}

/**
 * Find an active asset whose normalized serial matches.
 * Compares after normalization so " 1626 013605 " matches "1626013605".
 */
export async function findActiveAssetBySerial(serialNumber, { excludeAssetId = null, excludeDeviceMasterId = null } = {}) {
  const normalized = normalizeSerialNumber(serialNumber);
  if (!normalized) return null;

  const assets = await Asset.find({ isDeleted: false });
  return (
    assets.find((asset) => {
      if (excludeAssetId && String(asset._id) === String(excludeAssetId)) return false;
      if (
        excludeDeviceMasterId
        && asset.deviceMasterId
        && String(asset.deviceMasterId) === String(excludeDeviceMasterId)
      ) {
        return false;
      }
      return normalizeSerialNumber(asset.serialNumber) === normalized;
    }) || null
  );
}

export async function assertSerialNumberAvailable(
  serialNumber,
  { excludeAssetId = null, excludeDeviceMasterId = null } = {},
) {
  const normalized = requireNormalizedSerialNumber(serialNumber);
  const clash = await findActiveAssetBySerial(normalized, {
    excludeAssetId,
    excludeDeviceMasterId,
  });
  if (clash) {
    throw new AppError(
      `Serial number “${normalized}” already exists`,
      400,
      'SERIAL_EXISTS',
    );
  }
  return normalized;
}

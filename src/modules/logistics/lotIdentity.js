/** Exact stock lot identity — never merge across batch / expiry / serial. */

export function lotBatchKey(batchNumber) {
  return String(batchNumber || '').trim();
}

export function lotExpiryKey(expiryDate) {
  return String(expiryDate || '').trim().slice(0, 10);
}

export function lotSerialKey(serialNumber) {
  return String(serialNumber || '').trim();
}

export function stockLotIdentityKey(row = {}) {
  return [
    lotBatchKey(row.batchNumber),
    lotExpiryKey(row.expiryDate),
    lotSerialKey(row.serialNumber),
  ].join('|');
}

export function isUnbatchedLot(row = {}) {
  return !lotBatchKey(row.batchNumber) && !lotSerialKey(row.serialNumber);
}

/**
 * Critical mutation helpers — stale concurrency + idempotency.
 */
import { AppError } from './helpers.js';
import { assertNotStale } from '../store/dataIntegrity.js';

export function readIdempotencyKey(req) {
  const bodyKey = req.body?.uniqueKey ?? req.body?.idempotencyKey ?? '';
  const header =
    req.get?.('Idempotency-Key') ||
    req.get?.('X-Idempotency-Key') ||
    req.headers?.['idempotency-key'] ||
    '';
  return String(bodyKey || header || '').trim();
}

export function assertEntityNotStale(entity, body, label = 'Record') {
  assertNotStale(entity, body?.expectedUpdatedAt || body?.updatedAt, { label });
}

/**
 * Replay-safe create: if findExisting returns a row for the key, return it.
 * @returns {{ replay: true, row } | { replay: false, key: string }}
 */
export async function beginIdempotentCreate(key, findExisting) {
  const idem = String(key || '').trim();
  if (!idem) return { replay: false, key: '' };
  const existing = await findExisting(idem);
  if (existing) return { replay: true, row: existing };
  return { replay: false, key: idem };
}

export function requireIdempotencyKey(req, { required = false } = {}) {
  const key = readIdempotencyKey(req);
  if (required && !key) {
    throw new AppError('Idempotency-Key (or uniqueKey) is required', 400, 'VALIDATION_ERROR');
  }
  return key;
}

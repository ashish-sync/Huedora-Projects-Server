/**
 * Cross-module master reference validation.
 */
import { AppError } from '../utils/helpers.js';

export async function assertActiveMasterRef({
  Model,
  id,
  label = 'Master record',
  allowInactive = false,
}) {
  if (id == null || id === '') return null;
  const row = await Model.findOne({ _id: id, isDeleted: false });
  if (!row) {
    throw new AppError(`${label} not found or deleted`, 400, 'INVALID_REFERENCE');
  }
  if (!allowInactive && row.isActive === false) {
    throw new AppError(`${label} is inactive`, 400, 'INACTIVE_REFERENCE');
  }
  return row;
}

export async function assertActiveMasterRefs(pairs = []) {
  const out = [];
  for (const pair of pairs) {
    out.push(await assertActiveMasterRef(pair));
  }
  return out;
}

import { defineCollection } from '../../store/filedb.js';
import { softDelete } from '../common/counter.model.js';

/**
 * Central registry for uploaded object lifecycle (optimize, dedupe, access, cold tier).
 * Separate from entity soft-archive in modules/retention.
 */
export const StoredFile = defineCollection('stored_files', {
  ...softDelete,
  objectKey: '',
  contentHash: '',
  kind: 'other', // image | pdf | other
  contentType: '',
  sizeBytes: 0,
  originalName: '',
  status: 'pending', // pending (local ok, R2 deferred) | ready | failed | archived
  storageClass: 'STANDARD', // STANDARD | STANDARD_IA
  refCount: 1,
  lastAccessedAt: null,
  processedAt: null,
  processAttempts: 0,
  lastError: '',
  reductionRatio: null,
});

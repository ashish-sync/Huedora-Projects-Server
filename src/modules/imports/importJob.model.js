import { defineCollection } from '../../store/filedb.js';

/**
 * Tracks tabular import progress for CSV/XLSB streaming jobs.
 * Temp files are referenced by tempPath only while RUNNING, then deleted.
 */
export const ImportJob = defineCollection('import_jobs', {
  type: 'TABULAR',
  mode: 'COMMIT',
  status: 'QUEUED', // QUEUED | RUNNING | SUCCEEDED | FAILED
  phase: 'queued',
  fileName: '',
  tempPath: null,
  startedBy: null,
  idempotencyKey: undefined,
  totalRows: 0,
  processedRows: 0,
  successRows: 0,
  errorRows: 0,
  percent: 0,
  rowErrors: [],
  summary: {},
  errorReport: null,
  startedAt: null,
  finishedAt: null,
});

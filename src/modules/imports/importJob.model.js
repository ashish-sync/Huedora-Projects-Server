import { defineCollection } from '../../store/filedb.js';

export const ImportJob = defineCollection('import_jobs', {
  status: 'RUNNING',
  totalRows: 0,
  successRows: 0,
  errorRows: 0,
  rowErrors: [],
});

import { defineCollection } from '../../store/filedb.js';
import { softDelete, archiveFields } from '../common/counter.model.js';

export const Movement = defineCollection('movements', {
  ...softDelete,
  ...archiveFields,
  status: 'REQUESTED',
  assets: [],
  from: {},
  to: {},
});

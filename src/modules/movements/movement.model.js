import { defineCollection } from '../../store/filedb.js';
import { softDelete } from '../common/counter.model.js';

export const Movement = defineCollection('movements', {
  ...softDelete,
  status: 'REQUESTED',
  assets: [],
  from: {},
  to: {},
});

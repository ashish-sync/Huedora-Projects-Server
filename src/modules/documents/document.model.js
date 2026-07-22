import { defineCollection } from '../../store/filedb.js';
import { softDelete } from '../common/counter.model.js';

export const Document = defineCollection('documents', {
  ...softDelete,
  storageProvider: 'LOCAL',
  version: 1,
});

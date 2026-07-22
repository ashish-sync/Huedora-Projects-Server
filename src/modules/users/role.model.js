import { defineCollection } from '../../store/filedb.js';
import { softDelete } from '../common/counter.model.js';

export const Role = defineCollection('roles', {
  ...softDelete,
  name: '',
  description: '',
  permissions: [],
  isSystem: false,
});

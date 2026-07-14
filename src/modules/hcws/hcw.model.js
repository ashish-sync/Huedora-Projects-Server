import { defineCollection } from '../../store/filedb.js';
import { softDelete } from '../common/counter.model.js';

export const Hcw = defineCollection('hcws', { ...softDelete, status: 'ACTIVE' });

import { defineCollection } from '../../store/filedb.js';
import { softDelete } from '../common/counter.model.js';

export const RepairTicket = defineCollection('repair_tickets', {
  ...softDelete,
  status: 'OPEN',
  priority: 'MEDIUM',
  currency: 'INR',
  disposition: null,
});

export const MaintenanceOrder = defineCollection('maintenance_orders', {
  ...softDelete,
  status: 'PLANNED',
  maintenanceType: 'PM',
});

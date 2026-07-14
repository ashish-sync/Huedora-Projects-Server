import { defineCollection } from '../../store/filedb.js';
import { softDelete } from '../common/counter.model.js';

export const Asset = defineCollection('assets', {
  ...softDelete,
  quantity: 1,
  status: 'Purchased',
  location: {},
  currency: 'INR',
  hcwId: null,
  contactId: null,
  activeAgreementId: null,
  openMovementId: null,
  openRepairId: null,
  openMaintenanceId: null,
});

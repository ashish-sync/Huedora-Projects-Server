import { defineCollection } from '../../store/filedb.js';
import { softDelete } from '../common/counter.model.js';

export const Asset = defineCollection('assets', {
  ...softDelete,
  quantity: 1,
  status: 'Purchased',
  /** Product Master type — agreements/custody only for Medical / Non-Medical Device */
  productType: 'Medical Device',
  location: {},
  currency: 'INR',
  hcwId: null,
  contactId: null,
  activeAgreementId: null,
  openMovementId: null,
  openRepairId: null,
  openMaintenanceId: null,
});

import { defineCollection } from '../../store/filedb.js';
import { softDelete } from '../common/counter.model.js';

export const DeviceMaster = defineCollection('device_masters', {
  ...softDelete,
  isActive: true,
  name: '',
  assetType: null, // Rented | Owned | Hybrid
  description: null,
  cost: null, // Asset Value
  purchaseMonth: null, // MM/YYYY
  serialNumber: null,
  agreementStatus: 'Not Initiated', // Asset Status
  custody: null, // Asset Custody
  custodianName: null,
  custodianContact: null,
  custodianCity: null,
  custodianState: null,
  quantity: 1,
});

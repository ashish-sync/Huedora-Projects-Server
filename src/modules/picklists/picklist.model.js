import { defineCollection } from '../../store/filedb.js';
import { softDelete } from '../common/counter.model.js';

export const PICKLIST_STATUSES = ['PENDING', 'APPROVED', 'REJECTED'];

export const PicklistSuggestion = defineCollection('picklist_suggestions', {
  ...softDelete,
  picklistKey: '',
  value: '',
  normalizedValue: '',
  status: 'PENDING',
  source: '',
  requestedBy: null,
  approvedBy: null,
  rejectedBy: null,
  approvedAt: null,
  rejectedAt: null,
  rejectReason: '',
});

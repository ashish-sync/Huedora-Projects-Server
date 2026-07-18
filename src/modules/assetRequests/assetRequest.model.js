import { defineCollection } from '../../store/filedb.js';
import { softDelete } from '../common/counter.model.js';

/** Canonical request types for Request One */
export const REQUEST_TYPES = [
  'REPAIR',
  'MAINTENANCE',
  'LOGISTICS',
  'TRAINING',
  'REIMBURSEMENT',
  'HIRING',
  'OTHER',
  'MASTER_ADD',
];

/** Legacy type still accepted / displayed as Logistics */
export const LEGACY_REQUEST_TYPES = ['MOVEMENT'];

export const ALL_REQUEST_TYPES = [...REQUEST_TYPES, ...LEGACY_REQUEST_TYPES];

export const REQUEST_TYPE_LABELS = {
  REPAIR: 'Repair',
  MAINTENANCE: 'Maintenance',
  LOGISTICS: 'Stock Transfer',
  MOVEMENT: 'Stock Transfer',
  TRAINING: 'Training',
  REIMBURSEMENT: 'Reimbursement',
  HIRING: 'Hiring',
  OTHER: 'Others',
  MASTER_ADD: 'Master One Request',
};

export const OTHER_REQUEST_OPTIONS = {
  'Asset Request': ['New Asset', 'Asset Replacement', 'Asset Return', 'Asset Transfer'],
  'Document Request': [
    'Agreement / Contract',
    'Official Letter (Employment, Salary, Experience)',
    'Certificate / ID Document',
  ],
  'Procurement Request': [
    'Office Supplies',
    'Device & Equipment Purchase',
    'Consumables / Miscellaneous',
  ],
  'IT Support': [
    'Hardware Support',
    'Software Support',
    'Network & Email Support',
    'Password / Account Issues',
  ],
  'Access Request': [
    'Application Access',
    'Role & Permission Change',
    'New User / Account Creation',
    'Access Removal',
  ],
  'Facility Request': [
    'Housekeeping',
    'Electrical / Plumbing',
    'Furniture & Workspace',
    'Meeting Room / Office Facilities',
  ],
};

export const HIRING_TYPES = ['Full Timer', 'Freelancer'];
export const HIRING_HCW_TYPES = [
  'Phlebotomist',
  'Technician',
  'Dietitian',
  'Physio',
  'Others',
];
export const HIRING_CAMP_TYPES = [
  'No Device',
  'Light Device (1-5 KG)',
  'Heavy Device (5-12 KG)',
];
export const HIRING_METHODS = ['BMD', 'Diagnostics', 'Uroflow', 'Dietitian', 'Others'];

export const REQUEST_STATUSES = ['REQUESTED', 'APPROVED', 'REJECTED', 'CANCELLED', 'COMPLETED'];

/** Types that always require a linked Asset Registry asset. */
export const ASSET_REQUIRED_TYPES = ['REPAIR', 'MAINTENANCE'];

/** Canonical values accepted for newly-created Logistics requests. */
export const LOGISTICS_KINDS = ['Inter Transfer', 'Fresh Dispatch', 'Recall / Pickup'];
export const LOGISTICS_MODES = [
  'Hand Delivery',
  'Regular Courier',
  'Apex',
  'Porter',
  'Other',
];

export function normalizeRequestType(raw) {
  const t = String(raw || '').toUpperCase();
  if (t === 'MOVEMENT') return 'LOGISTICS';
  return t;
}

export function typeLabel(raw) {
  const t = String(raw || '').toUpperCase();
  return REQUEST_TYPE_LABELS[t] || t;
}

export const AssetRequest = defineCollection('asset_requests', {
  ...softDelete,
  status: 'REQUESTED',
  requestType: 'REPAIR',
  preferredVendorContactId: null,
  preferredVendor: '',
  productImage: null,
  billAttachment: null,
  requestAttachment: null,
  logisticsProducts: [],
  traineeContactId: null,
  traineeName: '',
  otherSubcategory: '',
  hiringType: '',
  hcwType: '',
  campType: '',
  hiringMethod: '',
  engagementDateTime: '',
  hiringAddress: '',
  hiringState: '',
  hiringCity: '',
  hiringName: '',
  hiringPinCode: '',
  budgetMin: null,
  budgetMax: null,
  fulfilledLineIds: [],
  fulfillmentPendingLineIds: [],
  fromContactId: null,
  fromState: '',
  fromCity: '',
  fromName: '',
  fromNumber: '',
  fromPinCode: '',
  fromAddress: '',
  toContactId: null,
  toState: '',
  toCity: '',
  toName: '',
  toNumber: '',
  toPinCode: '',
  toAddress: '',
  masterModule: '',
  masterEntity: '',
  masterPayload: null,
  createdMasterId: null,
  createdMasterCode: '',
});

/** Single-use, hashed upload invitation for a request custodian. */
export const AssetRequestUploadInvite = defineCollection('asset_request_upload_invites', {
  requestId: null,
  tokenHash: '',
  status: 'PENDING', // PENDING | COMPLETED | REVOKED
  contactId: null,
  custodianName: '',
  custodianContact: '',
  custodianCity: '',
  custodianState: '',
  expiresAt: null,
  completedAt: null,
  createdById: null,
  image: null,
});

export const ASSET_STATUSES = [
  'Purchased',
  'Received',
  'Warehouse',
  'Available',
  'Assigned',
  'Verified',
  'Maintenance',
  'Repair',
  'Retired',
  'Disposed',
];

/** fromStatus -> allowed toStatuses */
export const ASSET_TRANSITIONS = {
  Purchased: ['Received'],
  Received: ['Warehouse'],
  Warehouse: ['Available', 'Retired'],
  Available: ['Assigned', 'Retired', 'Maintenance', 'Repair'],
  Assigned: ['Verified', 'Maintenance', 'Repair', 'Retired', 'Available'],
  Verified: ['Assigned', 'Maintenance', 'Repair', 'Retired'],
  Maintenance: ['Warehouse', 'Available', 'Assigned'],
  Repair: ['Warehouse', 'Available', 'Assigned', 'Retired'],
  Retired: ['Disposed'],
  Disposed: [],
};

export const PERMISSIONS = {
  ALL: '*',
  ASSETS_READ: 'assets:read',
  ASSETS_WRITE: 'assets:write',
  ASSETS_TRANSITION: 'assets:transition',
  ASSETS_VIEW_VALUE: 'assets:view-value',
  MOVEMENTS_READ: 'movements:read',
  MOVEMENTS_REQUEST: 'movements:request',
  MOVEMENTS_APPROVE: 'movements:approve',
  VERIFICATIONS_READ: 'verifications:read',
  VERIFICATIONS_WRITE: 'verifications:write',
  AGREEMENTS_READ: 'agreements:read',
  AGREEMENTS_WRITE: 'agreements:write',
  REPAIRS_READ: 'repairs:read',
  REPAIRS_WRITE: 'repairs:write',
  MAINTENANCE_WRITE: 'maintenance:write',
  DOCUMENTS_WRITE: 'documents:write',
  USERS_READ: 'users:read',
  USERS_WRITE: 'users:write',
  HCWS_WRITE: 'hcws:write',
  AUDIT_READ: 'audit:read',
  IMPORTS_EXECUTE: 'imports:execute',
  DASHBOARDS_READ: 'dashboards:read',
  NOTIFICATIONS_READ: 'notifications:read',
  DEVICES_WRITE: 'devices:write',
  MASTERS_READ: 'masters:read',
  /** Camp Management */
  CAMPS_READ: 'camps:read',
  CAMPS_REQUEST: 'camps:request',
  CAMPS_APPROVE: 'camps:approve',
  /** Request One (Repair & Service / Goods Issuance / Training / Finance One / Hiring / Master One / Other) */
  ASSET_REQUESTS_READ: 'asset-requests:read',
  ASSET_REQUESTS_REQUEST: 'asset-requests:request',
  ASSET_REQUESTS_APPROVE: 'asset-requests:approve',
  /** Inventory & Logistics */
  LOGISTICS_READ: 'logistics:read',
  LOGISTICS_WRITE: 'logistics:write',
  LOGISTICS_MASTER: 'logistics:master',
  /** Finance One */
  FINANCE_READ: 'finance:read',
  FINANCE_WRITE: 'finance:write',
  FINANCE_VERIFY: 'finance:verify',
  FINANCE_APPROVE: 'finance:approve',
  FINANCE_PAY: 'finance:pay',
};

/** Read-only access across TYLO One modules. */
export const VIEW_ALL_MODULES = [
  PERMISSIONS.ASSETS_READ,
  PERMISSIONS.AGREEMENTS_READ,
  PERMISSIONS.VERIFICATIONS_READ,
  PERMISSIONS.CAMPS_READ,
  PERMISSIONS.ASSET_REQUESTS_READ,
  PERMISSIONS.MOVEMENTS_READ,
  PERMISSIONS.REPAIRS_READ,
  PERMISSIONS.LOGISTICS_READ,
  PERMISSIONS.FINANCE_READ,
  PERMISSIONS.DASHBOARDS_READ,
  PERMISSIONS.NOTIFICATIONS_READ,
  PERMISSIONS.MASTERS_READ,
];

/** Five standard roles — keep this list small for easier user management. */
export const ROLE_PERMISSIONS = {
  Admin: [PERMISSIONS.ALL],
  Viewer: [...VIEW_ALL_MODULES],
  Requester: [
    ...VIEW_ALL_MODULES,
    PERMISSIONS.CAMPS_REQUEST,
    PERMISSIONS.MOVEMENTS_REQUEST,
    PERMISSIONS.ASSET_REQUESTS_REQUEST,
  ],
  Editor: [
    ...VIEW_ALL_MODULES,
    PERMISSIONS.ASSETS_WRITE,
    PERMISSIONS.ASSETS_TRANSITION,
    PERMISSIONS.ASSETS_VIEW_VALUE,
    PERMISSIONS.AGREEMENTS_WRITE,
    PERMISSIONS.VERIFICATIONS_WRITE,
    PERMISSIONS.DOCUMENTS_WRITE,
    PERMISSIONS.REPAIRS_WRITE,
    PERMISSIONS.MAINTENANCE_WRITE,
    PERMISSIONS.HCWS_WRITE,
    PERMISSIONS.DEVICES_WRITE,
    PERMISSIONS.IMPORTS_EXECUTE,
    PERMISSIONS.CAMPS_REQUEST,
    PERMISSIONS.ASSET_REQUESTS_REQUEST,
    PERMISSIONS.MOVEMENTS_REQUEST,
    PERMISSIONS.LOGISTICS_WRITE,
    PERMISSIONS.LOGISTICS_MASTER,
    PERMISSIONS.FINANCE_WRITE,
    PERMISSIONS.FINANCE_PAY,
  ],
  Approver: [
    ...VIEW_ALL_MODULES,
    PERMISSIONS.CAMPS_REQUEST,
    PERMISSIONS.CAMPS_APPROVE,
    PERMISSIONS.ASSET_REQUESTS_REQUEST,
    PERMISSIONS.ASSET_REQUESTS_APPROVE,
    PERMISSIONS.MOVEMENTS_REQUEST,
    PERMISSIONS.MOVEMENTS_APPROVE,
    PERMISSIONS.FINANCE_READ,
    PERMISSIONS.FINANCE_VERIFY,
    PERMISSIONS.FINANCE_APPROVE,
  ],
  /** Healthcare Camp Coordinator — five applications only (see designationAccess.js). */
  'Camp Coordinator': [
    PERMISSIONS.AGREEMENTS_READ,
    PERMISSIONS.AGREEMENTS_WRITE,
    PERMISSIONS.DOCUMENTS_WRITE,
    PERMISSIONS.CAMPS_READ,
    PERMISSIONS.CAMPS_REQUEST,
    PERMISSIONS.CAMPS_APPROVE,
    PERMISSIONS.VERIFICATIONS_READ,
    PERMISSIONS.ASSET_REQUESTS_READ,
    PERMISSIONS.MOVEMENTS_READ,
    PERMISSIONS.REPAIRS_READ,
    PERMISSIONS.ASSET_REQUESTS_REQUEST,
    PERMISSIONS.MOVEMENTS_REQUEST,
    PERMISSIONS.REPAIRS_WRITE,
    PERMISSIONS.MAINTENANCE_WRITE,
    PERMISSIONS.DASHBOARDS_READ,
    PERMISSIONS.NOTIFICATIONS_READ,
  ],
};

export const PHYSICAL_CHECK = ['PASS', 'FAIL'];
export const FUNCTIONALITY_CHECK = ['CHECKED', 'NOT_CHECKED'];
/** @deprecated use PHYSICAL_CHECK / FUNCTIONALITY_CHECK */
export const CHECKLIST = PHYSICAL_CHECK;

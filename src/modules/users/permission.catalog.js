import { PERMISSIONS } from '../../config/constants.js';

/** Ordered action labels for the Roles UI matrix */
export const ACCESS_ACTIONS = [
  { id: 'all', label: 'All Access' },
  { id: 'view', label: 'View' },
  { id: 'add', label: 'Add' },
  { id: 'delete', label: 'Delete' },
  { id: 'upload', label: 'Upload' },
  { id: 'request', label: 'Request' },
  { id: 'approve', label: 'Approve' },
];

function withAll(actions) {
  const union = [
    ...new Set(
      Object.entries(actions)
        .filter(([k]) => k !== 'all')
        .flatMap(([, keys]) => keys)
    ),
  ];
  return { ...actions, all: union };
}

/**
 * Module access matrix for Roles & Permissions.
 * Each module exposes a subset of actions that map to backend permission keys.
 * Admin all Access is handled as global `*` in the UI (not a module row).
 */
export const MODULE_ACCESS_CATALOG = [
  {
    id: 'assets',
    label: 'Asset Registry',
    description: 'Ownership, lifecycle, and status tracking',
    actions: withAll({
      view: [PERMISSIONS.ASSETS_READ],
      add: [
        PERMISSIONS.ASSETS_WRITE,
        PERMISSIONS.ASSETS_TRANSITION,
        PERMISSIONS.ASSETS_VIEW_VALUE,
        PERMISSIONS.DEVICES_WRITE,
        PERMISSIONS.HCWS_WRITE,
      ],
      delete: [
        PERMISSIONS.ASSETS_WRITE,
        PERMISSIONS.ASSETS_TRANSITION,
        PERMISSIONS.ASSETS_VIEW_VALUE,
        PERMISSIONS.DEVICES_WRITE,
        PERMISSIONS.HCWS_WRITE,
      ],
    }),
  },
  {
    id: 'agreements',
    label: 'Document Center',
    description: 'Contracts, approvals, and digital records',
    actions: withAll({
      view: [PERMISSIONS.AGREEMENTS_READ],
      add: [PERMISSIONS.AGREEMENTS_WRITE],
      delete: [PERMISSIONS.AGREEMENTS_WRITE],
      upload: [PERMISSIONS.DOCUMENTS_WRITE],
    }),
  },
  {
    id: 'verifications',
    label: 'Asset Verification',
    description: 'Photo, GPS, and audit checks',
    actions: withAll({
      view: [PERMISSIONS.VERIFICATIONS_READ],
      add: [PERMISSIONS.VERIFICATIONS_WRITE],
      delete: [PERMISSIONS.VERIFICATIONS_WRITE],
    }),
  },
  {
    id: 'camps',
    label: 'Camp Management',
    description: 'Schedule, approve, and monitor camps',
    actions: withAll({
      view: [PERMISSIONS.CAMPS_READ],
      request: [PERMISSIONS.CAMPS_REQUEST],
      approve: [PERMISSIONS.CAMPS_APPROVE],
    }),
  },
  {
    id: 'assetRequests',
    label: 'Request Center',
    description: 'Repair, maintenance, logistics, training, reimbursement, and hiring requests',
    actions: withAll({
      view: [
        PERMISSIONS.ASSET_REQUESTS_READ,
        PERMISSIONS.MOVEMENTS_READ,
        PERMISSIONS.REPAIRS_READ,
      ],
      request: [
        PERMISSIONS.ASSET_REQUESTS_REQUEST,
        PERMISSIONS.MOVEMENTS_REQUEST,
        PERMISSIONS.REPAIRS_WRITE,
        PERMISSIONS.MAINTENANCE_WRITE,
      ],
      approve: [PERMISSIONS.ASSET_REQUESTS_APPROVE, PERMISSIONS.MOVEMENTS_APPROVE],
    }),
  },
  {
    id: 'logistics',
    label: 'Inventory & Logistics',
    description: 'Stock, vendors, transfers, and procurement',
    actions: {
      ...withAll({
        view: [PERMISSIONS.LOGISTICS_READ],
        add: [PERMISSIONS.LOGISTICS_WRITE],
        delete: [PERMISSIONS.LOGISTICS_WRITE],
      }),
      all: [
        PERMISSIONS.LOGISTICS_READ,
        PERMISSIONS.LOGISTICS_WRITE,
        PERMISSIONS.LOGISTICS_MASTER,
      ],
    },
  },
  {
    id: 'platform',
    label: 'Dashboard, Alerts & Notifications',
    description: 'Home dashboards and notifications',
    actions: withAll({
      view: [PERMISSIONS.DASHBOARDS_READ, PERMISSIONS.NOTIFICATIONS_READ],
    }),
  },
];

/** Flat checkbox catalog (legacy / advanced) */
export const PERMISSION_CATALOG = MODULE_ACCESS_CATALOG.map((m) => ({
  group: m.label,
  items: ACCESS_ACTIONS.filter((a) => m.actions?.[a.id]?.length).map((a) => ({
    key: `${m.id}:${a.id}`,
    label: a.label,
    access: a.id,
    permissionKeys: m.actions[a.id],
  })),
})).concat([
  {
    group: 'Administration',
    items: [{ key: PERMISSIONS.ALL, label: 'Admin all Access', access: 'all' }],
  },
]);

export const ALL_PERMISSION_KEYS = [
  ...new Set(
    [
      ...MODULE_ACCESS_CATALOG.flatMap((m) => Object.values(m.actions || {}).flat()),
      PERMISSIONS.ALL,
      PERMISSIONS.USERS_READ,
      PERMISSIONS.USERS_WRITE,
      PERMISSIONS.AUDIT_READ,
      PERMISSIONS.IMPORTS_EXECUTE,
      PERMISSIONS.MASTERS_READ,
    ].filter(Boolean)
  ),
];

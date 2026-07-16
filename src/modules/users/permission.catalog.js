import { PERMISSIONS } from '../../config/constants.js';

/**
 * Module access matrix for Roles & Permissions.
 * Each module exposes Read and/or Write toggles.
 */
export const MODULE_ACCESS_CATALOG = [
  {
    id: 'assets',
    label: 'Asset Inventory',
    description: 'Assets, custodians, and lifecycle status',
    readKey: PERMISSIONS.ASSETS_READ,
    writeKey: PERMISSIONS.ASSETS_WRITE,
    writeIncludes: [PERMISSIONS.ASSETS_TRANSITION, PERMISSIONS.ASSETS_VIEW_VALUE],
  },
  {
    id: 'agreements',
    label: 'Document Hub',
    description: 'Documents, contacts, signatures, and e-signature envelopes',
    readKey: PERMISSIONS.AGREEMENTS_READ,
    writeKey: PERMISSIONS.AGREEMENTS_WRITE,
    writeIncludes: [PERMISSIONS.DOCUMENTS_WRITE],
  },
  {
    id: 'verifications',
    label: 'Asset Verification',
    description: 'Campaigns and Round I/II checks',
    readKey: PERMISSIONS.VERIFICATIONS_READ,
    writeKey: PERMISSIONS.VERIFICATIONS_WRITE,
  },
  {
    id: 'camps',
    label: 'In-House Camp Management',
    description: 'Camp requests, status tracking, and approvals',
    readKey: PERMISSIONS.CAMPS_READ,
    writeKey: PERMISSIONS.CAMPS_REQUEST,
    writeIncludes: [PERMISSIONS.CAMPS_APPROVE],
  },
  {
    id: 'movements',
    label: 'Movements',
    description: 'Request and approve asset moves',
    readKey: PERMISSIONS.MOVEMENTS_READ,
    writeKey: PERMISSIONS.MOVEMENTS_REQUEST,
    writeIncludes: [PERMISSIONS.MOVEMENTS_APPROVE],
  },
  {
    id: 'repairs',
    label: 'Repairs & maintenance',
    description: 'Repair tickets and maintenance work',
    readKey: PERMISSIONS.REPAIRS_READ,
    writeKey: PERMISSIONS.REPAIRS_WRITE,
    writeIncludes: [PERMISSIONS.MAINTENANCE_WRITE],
  },
  {
    id: 'masters',
    label: 'Catalog sync',
    description: 'Register and update assets (catalog + inventory sync)',
    readKey: PERMISSIONS.MASTERS_READ,
    writeKey: PERMISSIONS.DEVICES_WRITE,
    writeIncludes: [PERMISSIONS.HCWS_WRITE],
  },
  {
    id: 'imports',
    label: 'Excel imports',
    description: 'Bulk data import jobs',
    readKey: null,
    writeKey: PERMISSIONS.IMPORTS_EXECUTE,
  },
  {
    id: 'users',
    label: 'Roles & Permissions',
    description: 'Create users and manage roles',
    readKey: PERMISSIONS.USERS_READ,
    writeKey: PERMISSIONS.USERS_WRITE,
  },
  {
    id: 'audit',
    label: 'Audit log',
    description: 'Security and change history',
    readKey: PERMISSIONS.AUDIT_READ,
    writeKey: null,
  },
  {
    id: 'platform',
    label: 'Dashboards & alerts',
    description: 'Home dashboards and notifications',
    readKey: PERMISSIONS.DASHBOARDS_READ,
    writeKey: null,
    readIncludes: [PERMISSIONS.NOTIFICATIONS_READ],
  },
];

/** Flat checkbox catalog (legacy / advanced) */
export const PERMISSION_CATALOG = MODULE_ACCESS_CATALOG.map((m) => ({
  group: m.label,
  items: [
    ...(m.readKey ? [{ key: m.readKey, label: 'Read', access: 'read' }] : []),
    ...(m.writeKey ? [{ key: m.writeKey, label: 'Write', access: 'write' }] : []),
  ],
})).concat([
  {
    group: 'Administration',
    items: [{ key: PERMISSIONS.ALL, label: 'Full access (Admin)', access: 'all' }],
  },
]);

export const ALL_PERMISSION_KEYS = [
  ...new Set(
    [
      ...MODULE_ACCESS_CATALOG.flatMap((m) => [
        m.readKey,
        m.writeKey,
        ...(m.readIncludes || []),
        ...(m.writeIncludes || []),
      ]),
      PERMISSIONS.ALL,
      PERMISSIONS.NOTIFICATIONS_READ,
      PERMISSIONS.DOCUMENTS_WRITE,
      PERMISSIONS.MAINTENANCE_WRITE,
      PERMISSIONS.MOVEMENTS_APPROVE,
      PERMISSIONS.HCWS_WRITE,
      PERMISSIONS.ASSETS_TRANSITION,
      PERMISSIONS.ASSETS_VIEW_VALUE,
    ].filter(Boolean)
  ),
];

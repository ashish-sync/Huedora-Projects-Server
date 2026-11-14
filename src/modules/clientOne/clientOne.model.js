import { defineCollection } from '../../store/filedb.js';

/**
 * Client One portal access — one active grant per Client Master programme.
 * PIN is stored hashed only; plaintext is returned once on mint/rotate.
 * Retained as programme-level config; member PINs are separate (client_one_members).
 */
export const ClientOneAccess = defineCollection('client_one_access', {
  clientMasterId: null,
  clientId: null,
  clientName: '',
  programName: '',
  campName: '',
  accessId: '',
  pinHash: '',
  label: '',
  isActive: true,
  expiresAt: null,
  createdById: null,
  createdByEmail: '',
  rotatedAt: null,
  revokedAt: null,
  failedAttempts: 0,
  lockedUntil: null,
  lastLoginAt: null,
  /** Per-programme Client One feature gates (staff-configurable). */
  features: null,
});

/**
 * Client One User Base members — HO / Regional / Location organogram.
 * Per-member PIN (hashed); plaintext returned only on create / rotate.
 */
export const ClientOneMember = defineCollection('client_one_members', {
  clientMasterId: null,
  clientId: null,
  accessId: '',
  fullName: '',
  mobile: '',
  email: '',
  designation: '',
  /** ho | regional | location */
  level: 'ho',
  parentId: null,
  /** Region / state labels for Regional (and inherited context). */
  regions: [],
  /** Location / branch labels for Location level. */
  locations: [],
  pinHash: '',
  /** active | inactive */
  status: 'active',
  failedAttempts: 0,
  lockedUntil: null,
  lastLoginAt: null,
  createdByMemberId: null,
  createdByAccessId: '',
  updatedAt: null,
});

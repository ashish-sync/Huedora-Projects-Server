import { defineCollection } from '../../store/filedb.js';

/**
 * Client One portal access — one active grant per Client Master programme.
 * PIN is stored hashed only; plaintext is returned once on mint/rotate.
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

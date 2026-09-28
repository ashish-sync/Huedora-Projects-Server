/**
 * Asset One import sample — column headers and picklist values must match
 * device.constants.js / the Asset Register form exactly (case and spelling).
 */
import {
  OWNERSHIP_TYPE_OPTIONS,
  AGREEMENT_STATUS_OPTIONS,
  DEVICE_CUSTODY_OPTIONS,
} from './device.constants.js';

export const ASSET_REGISTER_PRODUCT_TYPES = ['Medical Device', 'Non-Medical Device'];

export const ASSET_MASTER_HEADERS = [
  'Asset Type (Product Type)',
  'Display Name',
  'Serial Number',
  'Purchase Month & Year',
  'Purchase Amount',
  'Ownership Type',
  'Asset Status',
  'Asset Custody',
  'Custodian Contact',
  'Asset & Peripheral Remarks',
];

/**
 * Example rows — every allowed Product Type, Ownership Type, Asset Status, and
 * Asset Custody value appears at least once. Use these strings exactly on import.
 * Display Name must already exist in Product Master.
 * Individual / Service Provider custody requires a matching Healthcare Worker
 * contact (phone or email) in Contact Directory.
 */
export const ASSET_SAMPLE_ROWS = [
  [
    'Medical Device',
    'CarePlus — BP Monitor Pro',
    'SN-SAMPLE-001',
    '01/2025',
    125000,
    'Tylo Owned',
    'Not Initiated',
    'Tylo Office',
    '',
    'Includes cuff kit',
  ],
  [
    'Non-Medical Device',
    'Dell — Latitude 5420',
    'SN-SAMPLE-002',
    '02/2025',
    85000,
    'Client Owned',
    'Tylo Office',
    'Client / Rented',
    '',
    '',
  ],
  [
    'Medical Device',
    'CarePlus — BP Monitor Pro',
    'SN-SAMPLE-003',
    '03/2025',
    125000,
    'Rented Asset',
    'Agreement Signed',
    'Tylo Office',
    '',
    '',
  ],
  [
    'Medical Device',
    'CarePlus — BP Monitor Pro',
    'SN-SAMPLE-004',
    '04/2025',
    125000,
    'Tylo Owned',
    'Lost/Stolen',
    'Tylo Office',
    '',
    '',
  ],
  [
    'Medical Device',
    'CarePlus — BP Monitor Pro',
    'SN-SAMPLE-005',
    '05/2025',
    125000,
    'Tylo Owned',
    'Under Repairs',
    'Tylo Office',
    '',
    '',
  ],
  [
    'Medical Device',
    'CarePlus — BP Monitor Pro',
    'SN-SAMPLE-006',
    '06/2025',
    125000,
    'Tylo Owned',
    'Untraceable',
    'Tylo Office',
    '',
    '',
  ],
  [
    'Medical Device',
    'CarePlus — BP Monitor Pro',
    'SN-SAMPLE-007',
    '07/2025',
    125000,
    'Tylo Owned',
    'End of Life',
    'Tylo Office',
    '',
    '',
  ],
  [
    'Medical Device',
    'CarePlus — BP Monitor Pro',
    'SN-SAMPLE-008',
    '08/2025',
    125000,
    'Tylo Owned',
    'Not Initiated',
    'Individual',
    '9876543210',
    'Custodian Contact = Healthcare Worker / Individual phone or email from Contact Directory',
  ],
  [
    'Medical Device',
    'CarePlus — BP Monitor Pro',
    'SN-SAMPLE-009',
    '09/2025',
    125000,
    'Tylo Owned',
    'Not Initiated',
    'Service Provider',
    '9123456780',
    'Custodian Contact = Healthcare Worker / Service Provider phone or email from Contact Directory',
  ],
];

/** One row per allowed picklist value — for the Allowed Values sheet. */
export function assetAllowedValueRows() {
  const rows = [];
  for (const value of ASSET_REGISTER_PRODUCT_TYPES) {
    rows.push(['Asset Type (Product Type)', value]);
  }
  for (const value of OWNERSHIP_TYPE_OPTIONS) {
    rows.push(['Ownership Type', value]);
  }
  for (const value of AGREEMENT_STATUS_OPTIONS) {
    rows.push(['Asset Status', value]);
  }
  for (const value of DEVICE_CUSTODY_OPTIONS) {
    rows.push(['Asset Custody', value]);
  }
  rows.push([
    'Purchase Month & Year',
    'MM/YYYY (example: 01/2025)',
  ]);
  rows.push([
    'Custodian Contact',
    'Required only when Asset Custody is Individual or Service Provider — must match Contact Directory',
  ]);
  return rows;
}

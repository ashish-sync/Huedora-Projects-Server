/** Contact Directory excel columns — aligned with Contact form labels. */

import { isServiceProviderContact } from './contact.constants.js';
import { normalizePhone } from '../../utils/identityNormalize.js';

export const CONTACT_HEADERS = [
  'Name',
  'Email',
  'Contact Category',
  'Resource Type',
  'Profession / Role',
  'Organization Name',
  'Supply Category',
  'Contact',
  'City',
  'State',
  'Address',
  'PIN Code',
  'PAN Number',
  'IFSC Code',
  'Bank Name',
  'Account Number',
  'Service Provider (agency)',
];

function contactToExportCells(c = {}) {
  return [
    c.name || '',
    c.email || '',
    c.contactCategory || '',
    c.resourceType || '',
    c.profession || '',
    c.organization || '',
    c.supplyCategory || '',
    c.contact || c.mobile || '',
    c.city || '',
    c.state || '',
    c.address || '',
    c.pinCode || '',
    c.panNumber || '',
    c.ifscCode || '',
    c.bankName || '',
    c.accountNumber || '',
    c.serviceProviderName || '',
  ];
}

/**
 * Flatten Contact Directory for Excel download.
 * Includes Service Provider agency rows plus embedded providerEmployees staff
 * (roster staff are not separate Contact documents).
 * Skips roster rows when a linked staff Contact already exists for the same
 * provider + mobile so re-import does not create duplicates.
 */
export function buildContactExportRows(contacts = []) {
  const list = Array.isArray(contacts) ? contacts : [];
  const linkedStaffKeys = new Set();

  for (const c of list) {
    const providerId = String(c?.serviceProviderContactId || '').trim();
    const phone = normalizePhone(c?.contact || c?.mobile || '');
    if (providerId && phone) {
      linkedStaffKeys.add(`${providerId}|${phone}`);
    }
  }

  const rows = [];
  for (const c of list) {
    rows.push(contactToExportCells(c));

    if (!isServiceProviderContact(c)) continue;
    const providerId = String(c._id || '');
    const agencyName = String(c.name || '').trim();
    const employees = Array.isArray(c.providerEmployees) ? c.providerEmployees : [];

    for (const emp of employees) {
      const name = String(emp?.name || '').trim();
      const mobile = String(emp?.mobile || emp?.contact || '').trim();
      const profession = String(emp?.profession || '').trim();
      if (!name && !mobile) continue;

      const phoneKey = normalizePhone(mobile);
      if (providerId && phoneKey && linkedStaffKeys.has(`${providerId}|${phoneKey}`)) {
        continue;
      }

      rows.push([
        name,
        '',
        'Healthcare Worker',
        'Individual',
        profession,
        '',
        '',
        mobile,
        c.city || '',
        c.state || '',
        c.address || '',
        c.pinCode || '',
        '',
        '',
        '',
        '',
        agencyName,
      ]);
    }
  }

  return rows;
}

export const CONTACT_SAMPLE_ROWS = [
  [
    'Dr. Ananya Rao',
    'ananya@example.com',
    'Resource',
    'Full-Time',
    'Doctor',
    '',
    '',
    '9876543210',
    'Hyderabad',
    'Telangana',
    '12 Health Park Road',
    '500081',
    'ABCDE1234F',
    'HDFC0001234',
    'HDFC Bank',
    '123456789012',
    '',
  ],
  [
    'City Hospital',
    'ops@cityhospital.example',
    'Client',
    '',
    '',
    'City Hospital Group',
    '',
    '9123456780',
    'Mumbai',
    'Maharashtra',
    '',
    '',
    '',
    '',
    '',
    '',
    '',
  ],
];

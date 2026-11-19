/** Contact Directory excel columns — aligned with Directory Record form labels. */

import { isServiceProviderContact } from './contact.constants.js';
import { normalizePhone } from '../../utils/identityNormalize.js';

/**
 * Sample / export headers mirror the Directory Record form.
 *
 * Rules:
 * - Individual / Full-Time never carry a Service Provider (agency) link in Excel.
 * - Service Provider agencies are created in the form only.
 * - Once a Service Provider exists, Excel may add Employee Details under that agency
 *   (matched by Full Name / Email ID / Contact Number).
 *
 * Employee Contact Number / Employee Profession / Role are uniquely named so Excel
 * can map them (form labels "Contact Number" / "Profession / Role" already exist
 * on the main contact).
 */
export const CONTACT_HEADERS = [
  'Full Name',
  'Email ID',
  'Contact Number',
  'Contact Category',
  'Resource Type',
  'Profession / Role',
  'Street Address',
  'State',
  'City / District',
  'PAN Number',
  'Aadhaar Number',
  'UPI ID',
  'IFSC Code',
  'Bank Name',
  'Account Number',
  'Employee Full Name',
  'Employee Contact Number',
  'Employee Profession / Role',
];

export const CONTACT_HEADER_INDEX = Object.freeze(
  Object.fromEntries(CONTACT_HEADERS.map((h, i) => [h, i])),
);

function contactToExportCells(c = {}, employee = null) {
  const emp = employee && typeof employee === 'object' ? employee : null;
  return [
    c.name || '',
    c.email || '',
    c.contact || c.mobile || '',
    c.contactCategory || '',
    c.resourceType || '',
    c.profession || '',
    c.address || '',
    c.state || '',
    c.city || '',
    c.panNumber || '',
    c.aadhaarNumber || '',
    c.upiId || '',
    c.ifscCode || '',
    c.bankName || '',
    c.accountNumber || '',
    emp ? String(emp.name || '').trim() : '',
    emp ? String(emp.mobile || emp.contact || '').trim() : '',
    emp ? String(emp.profession || '').trim() : '',
  ];
}

/** Normalize one embedded employee from import/export cells. */
export function normalizeImportEmployee({
  name = '',
  mobile = '',
  profession = '',
} = {}) {
  const empName = String(name || '').trim();
  const empMobile = String(mobile || '').replace(/\D+/g, '').slice(0, 10);
  const empProfession = String(profession || '').trim();
  if (!empName && !empMobile) return null;
  return {
    name: empName,
    mobile: empMobile,
    profession: empProfession,
  };
}

/**
 * Merge an imported employee into a Service Provider roster (by mobile, else name).
 * Returns true when the roster changed.
 */
export function mergeProviderEmployee(contact, employee) {
  const emp = normalizeImportEmployee(employee || {});
  if (!emp || !contact) return false;
  const roster = Array.isArray(contact.providerEmployees)
    ? contact.providerEmployees.map((row) => ({ ...row }))
    : [];
  const phone = normalizePhone(emp.mobile);
  const nameKey = String(emp.name || '').trim().toLowerCase();
  const idx = roster.findIndex((row) => {
    const rowPhone = normalizePhone(row?.mobile || row?.contact || '');
    if (phone && rowPhone && phone === rowPhone) return true;
    if (!phone && nameKey && String(row?.name || '').trim().toLowerCase() === nameKey) return true;
    return false;
  });
  if (idx >= 0) {
    const prev = roster[idx];
    roster[idx] = {
      ...prev,
      name: emp.name || prev.name || '',
      mobile: emp.mobile || prev.mobile || '',
      profession: emp.profession || prev.profession || '',
    };
  } else {
    roster.push({
      id: `emp_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
      name: emp.name,
      mobile: emp.mobile,
      profession: emp.profession,
      educationalQualificationUrl: '',
    });
  }
  contact.providerEmployees = roster;
  return true;
}

/**
 * Flatten Contact Directory for Excel download.
 * Service Provider rows expand one export line per embedded employee (Employee Details columns).
 * Individual / Full-Time never export an agency link column.
 */
export function buildContactExportRows(contacts = []) {
  const list = Array.isArray(contacts) ? contacts : [];
  const rows = [];
  for (const c of list) {
    if (isServiceProviderContact(c)) {
      const employees = Array.isArray(c.providerEmployees) ? c.providerEmployees : [];
      const exportEmployees = employees.filter((emp) => {
        const name = String(emp?.name || '').trim();
        const mobile = String(emp?.mobile || emp?.contact || '').trim();
        return Boolean(name || mobile);
      });

      if (!exportEmployees.length) {
        rows.push(contactToExportCells(c, null));
      } else {
        for (const emp of exportEmployees) {
          rows.push(contactToExportCells(c, emp));
        }
      }
      continue;
    }

    rows.push(contactToExportCells(c, null));
  }

  return rows;
}

export const CONTACT_SAMPLE_ROWS = [
  // Resource
  [
    'Dr. Ananya Rao',
    'ananya@example.com',
    '9876543210',
    'Resource',
    'Full-Time',
    'Doctor',
    '12 Health Park Road',
    'Telangana',
    'Hyderabad',
    'ABCDE1234F',
    '123456789012',
    'ananya@upi',
    'HDFC0001234',
    'HDFC Bank',
    '123456789012',
    '',
    '',
    '',
  ],
  // Client — organization correlated from Full Name on import
  [
    'City Hospital',
    'ops@cityhospital.example',
    '9123456780',
    'Client',
    '',
    '',
    '',
    'Maharashtra',
    'Mumbai',
    '',
    '',
    '',
    '',
    '',
    '',
    '',
    '',
    '',
  ],
  // Healthcare Worker Individual — no agency, no employee columns
  [
    'Anita Desai',
    'anita@example.com',
    '9111000002',
    'Healthcare Worker',
    'Individual',
    'Doctor',
    '5 Clinic Road',
    'Maharashtra',
    'Pune',
    'BBBBB2222B',
    '345678901234',
    'anita@upi',
    'HDFC0002222',
    'HDFC Bank',
    '112233445566',
    '',
    '',
    '',
  ],
  // Add employee under an EXISTING Service Provider (agency must already exist in Directory).
  // Full Name / Email / Contact Number identify the agency; Employee* columns add roster staff.
  [
    'Care Staffing Agency',
    'ops@carestaff.example',
    '9000000001',
    'Healthcare Worker',
    'Service Provider',
    '',
    '',
    '',
    '',
    '',
    '',
    '',
    '',
    '',
    '',
    'Ravi Kumar',
    '9111000001',
    'Nurse',
  ],
];

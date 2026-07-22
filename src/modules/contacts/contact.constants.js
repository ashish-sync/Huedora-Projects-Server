/** Canonical picklists for Contact Directory */

export const CONTACT_CATEGORIES = ['Resource', 'Client', 'Vendor'];

/** Employment / engagement type — only when Contact Category is Resource */
export const RESOURCE_TYPES = [
  'Full-Time',
  'Contractual',
  'Freelancer',
  'Consultant',
  'Service Provider',
  'Individual',
  'Other',
];

/** Default Profession / Role when Contact Category is Resource */
export const PROFESSIONS = [
  'Technician',
  'Phlebotomist',
  'Dietitian',
  'Doctor',
  'Nurse',
  'Biomedical Engineer',
  'Project Manager',
  'Operations Executive',
  'Human Resources',
  'Finance',
  'IT Support',
  'Administration',
  'Procurement',
  'Other',
];

/** Profession / Role when Contact Category is Client */
export const CLIENT_PROFESSIONS = [
  'Finance',
  'Product Manager',
  'Admin',
  'Procurement',
  'Other',
];

/** Profession / Role when Contact Category is Vendor */
export const VENDOR_PROFESSIONS = [
  'Sales Executive',
  'Service Engineer',
  'Operations Executive',
  'Finance Executive',
  'Owner / Proprietor',
  'Other',
];

export function professionsForCategory(contactCategory) {
  if (contactCategory === 'Client') return CLIENT_PROFESSIONS;
  if (contactCategory === 'Vendor') return VENDOR_PROFESSIONS;
  return PROFESSIONS;
}

export function professionPicklistKey(contactCategory) {
  if (contactCategory === 'Client') return 'contact.profession.client';
  if (contactCategory === 'Vendor') return 'contact.profession.vendor';
  return 'contact.profession';
}

/** Supply Category — only when Contact Category is Vendor */
export const SUPPLY_CATEGORIES = [
  'Medical Devices',
  'Medical Consumables',
  'Printing & Branding',
  'Office Supplies & Stationery',
  'Courier & Logistics',
  'IT Hardware & Software',
  'Biomedical Service & AMC',
  'Facility & Housekeeping',
  'Recruitment & Staffing',
  'Travel & Transport',
  'Catering',
  'Other',
];

/** Loose match for Excel imports (case / spacing) */
export function matchPicklist(value, options) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  const norm = raw.toLowerCase().replace(/[\s_-]+/g, '');
  const found = options.find((o) => o.toLowerCase().replace(/[\s_-]+/g, '') === norm);
  if (found) return found;
  const aliases = {
    contratual: 'Contractual',
    contractual: 'Contractual',
    fulltimer: 'Full-Time',
    fulltime: 'Full-Time',
    'full-time': 'Full-Time',
    'full timer': 'Full-Time',
    serviceprovider: 'Service Provider',
    deitician: 'Dietitian',
    dietician: 'Dietitian',
    dietitian: 'Dietitian',
    humanresources: 'Human Resources',
    itsupport: 'IT Support',
    projectmanager: 'Project Manager',
    productmanager: 'Product Manager',
    operationsexecutive: 'Operations Executive',
    biomedicalengineer: 'Biomedical Engineer',
    administration: 'Administration',
    admin: 'Admin',
    others: 'Other',
    medicaldevices: 'Medical Devices',
    medicalconsumables: 'Medical Consumables',
    printingbranding: 'Printing & Branding',
    officesuppliesstationery: 'Office Supplies & Stationery',
    courierlogistics: 'Courier & Logistics',
    ithardwaresoftware: 'IT Hardware & Software',
    biomedicalserviceamc: 'Biomedical Service & AMC',
    facilityhousekeeping: 'Facility & Housekeeping',
    recruitmentstaffing: 'Recruitment & Staffing',
    traveltransport: 'Travel & Transport',
    catering: 'Catering',
    // Legacy category values that used to live in Resource Type
    supplier: 'Vendor',
    vendor: 'Vendor',
    client: 'Client',
    resource: 'Resource',
  };
  return aliases[norm] || raw;
}

/** Allow custom Other values on records (pending / approved via picklist suggestions) */
export function allowCustomPicklistValue(raw, options, otherLabel = 'Other') {
  const value = String(raw || '').trim();
  if (!value) return '';
  const matched = matchPicklist(value, options);
  if (options.includes(matched) && matched.toLowerCase() !== String(otherLabel).toLowerCase()) {
    return matched;
  }
  const norm = value.toLowerCase();
  if (norm === 'other' || norm === 'others' || norm === String(otherLabel).toLowerCase()) {
    return '';
  }
  return value;
}

export function normalizeProfession(raw, contactCategory) {
  const options = professionsForCategory(contactCategory);
  const value = String(raw || '').trim();
  if (!value) return '';

  if (contactCategory === 'Client') {
    const norm = value.toLowerCase().replace(/[\s_-]+/g, '');
    const clientAliases = {
      finance: 'Finance',
      productmanager: 'Product Manager',
      projectmanager: 'Product Manager',
      admin: 'Admin',
      administration: 'Admin',
      procurement: 'Procurement',
      other: 'Other',
      others: 'Other',
    };
    if (clientAliases[norm] && clientAliases[norm] !== 'Other') return clientAliases[norm];
    if (clientAliases[norm] === 'Other') return '';
  }

  if (contactCategory === 'Vendor') {
    const norm = value.toLowerCase().replace(/[\s_/-]+/g, '');
    const vendorAliases = {
      salesexecutive: 'Sales Executive',
      serviceengineer: 'Service Engineer',
      operationsexecutive: 'Operations Executive',
      financeexecutive: 'Finance Executive',
      ownerproprietor: 'Owner / Proprietor',
      owner: 'Owner / Proprietor',
      proprietor: 'Owner / Proprietor',
      other: 'Other',
      others: 'Other',
    };
    if (vendorAliases[norm] && vendorAliases[norm] !== 'Other') return vendorAliases[norm];
    if (vendorAliases[norm] === 'Other') return '';
  }

  return allowCustomPicklistValue(value, options, 'Other');
}

export function normalizeSupplyCategory(raw) {
  return allowCustomPicklistValue(raw, SUPPLY_CATEGORIES, 'Other');
}

export function normalizeContactCategory(raw) {
  const matched = matchPicklist(raw, CONTACT_CATEGORIES);
  if (CONTACT_CATEGORIES.includes(matched)) return matched;
  // Legacy: Supplier/Vendor used to be Resource Type
  const legacy = String(raw || '').trim().toLowerCase();
  if (legacy === 'supplier' || legacy === 'vendor') return 'Vendor';
  if (legacy === 'client') return 'Client';
  return '';
}

/** Vendor partners for goods issue / preferential vendor pickers (includes legacy rows). */
export function isVendorContact(contact) {
  if (!contact) return false;
  const cat = String(contact.contactCategory || '').trim().toLowerCase();
  if (cat === 'vendor') return true;
  const rt = String(contact.resourceType || '').trim().toLowerCase();
  return rt === 'vendor' || rt === 'supplier';
}

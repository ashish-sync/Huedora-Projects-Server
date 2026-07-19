import { defineCollection } from '../../store/filedb.js';
import { softDelete } from '../common/counter.model.js';
import {
  normalizeContactCategory,
  normalizeProfession,
  normalizeSupplyCategory,
  allowCustomPicklistValue,
  professionsForCategory,
  CONTACT_CATEGORIES,
  RESOURCE_TYPES,
  CLIENT_PROFESSIONS,
  VENDOR_PROFESSIONS,
  SUPPLY_CATEGORIES,
} from './contact.constants.js';
import { normalizeEmail } from '../../utils/identityNormalize.js';
import { AppError } from '../../utils/helpers.js';

/** Contact directory fields (Excel + form parity) */
export const Contact = defineCollection('contacts', {
  ...softDelete,
  name: '',
  email: '',
  contactCategory: '',
  resourceType: '',
  profession: '',
  contact: '',
  mobile: '',
  city: '',
  state: '',
  pinCode: '',
  address: '',
  organization: '',
  supplyCategory: '',
  panNumber: '',
  ifscCode: '',
  bankName: '',
  accountNumber: '',
  notes: '',
  district: '',
  stateId: null,
  districtId: null,
  cityId: null,
});

function inferCategoryFromLegacy(body, resourceTypeRaw) {
  const explicit = normalizeContactCategory(
    body.contactCategory || body['Contact Category'] || body.contact_category || ''
  );
  if (explicit) return explicit;

  const rt = String(resourceTypeRaw || '').trim().toLowerCase();
  if (rt === 'vendor' || rt === 'supplier') return 'Vendor';
  if (rt === 'client') return 'Client';
  if (rt) return 'Resource';
  return '';
}

export function normalizeContactPayload(body = {}, { validate = false } = {}) {
  const contact = String(body.contact || body.mobile || body.Contact || '').trim();
  const resourceTypeRaw =
    body.resourceType || body['Resource Type'] || body.resource_type || '';
  let contactCategory = inferCategoryFromLegacy(body, resourceTypeRaw);

  let resourceType = '';
  if (contactCategory === 'Resource') {
    resourceType = allowCustomPicklistValue(resourceTypeRaw, RESOURCE_TYPES, 'Other');
  }

  const professionRaw = body.profession || body.Profession || body['Profession / Role'] || '';
  const profession = normalizeProfession(professionRaw, contactCategory);
  const allowedProfessions = professionsForCategory(contactCategory);

  const isClient = contactCategory === 'Client';
  const isVendor = contactCategory === 'Vendor';

  const organization = isClient
    ? String(
        body.organization ||
          body.Organization ||
          body['Organization Name'] ||
          body['Organization'] ||
          ''
      ).trim()
    : '';

  const supplyCategoryRaw =
    body.supplyCategory ||
    body['Supply Category'] ||
    body.supply_category ||
    body.SupplyCategory ||
    '';
  const supplyCategory = isVendor ? normalizeSupplyCategory(supplyCategoryRaw) : '';

  const payload = {
    name: String(body.name || body.Name || '').trim(),
    email: normalizeEmail(body.email || body.Email || ''),
    contactCategory,
    resourceType: contactCategory === 'Resource' ? resourceType : '',
    profession,
    contact,
    mobile: contact,
    city: String(body.city || body.City || '').trim(),
    state: String(body.state || body.State || '').trim(),
    pinCode: isClient
      ? ''
      : String(
          body.pinCode || body.pincode || body['Pin Code'] || body.Pincode || body.PIN || ''
        ).trim(),
    address: isClient ? '' : String(body.address || body.Address || '').trim(),
    organization,
    supplyCategory,
    panNumber: isClient
      ? ''
      : String(body.panNumber || body.PAN || body['PAN Number'] || body.pan || '').trim().toUpperCase(),
    ifscCode: isClient
      ? ''
      : String(body.ifscCode || body.IFSC || body['IFSC Code'] || body.ifsc || '').trim().toUpperCase(),
    bankName: isClient
      ? ''
      : String(body.bankName || body['Bank Name'] || body.bank || '').trim(),
    accountNumber: isClient
      ? ''
      : String(body.accountNumber || body['Account Number'] || body.account || '').trim(),
    notes: String(body.notes || '').trim(),
    district: String(body.district || body.District || '').trim(),
    stateId: body.stateId || null,
    districtId: body.districtId || null,
    cityId: body.cityId || null,
  };

  if (validate) {
    if (!payload.name) throw new AppError('Name is required', 400, 'VALIDATION_ERROR');
    if (!payload.contactCategory || !CONTACT_CATEGORIES.includes(payload.contactCategory)) {
      throw new AppError(
        `Contact Category must be one of: ${CONTACT_CATEGORIES.join(', ')}`,
        400,
        'VALIDATION_ERROR'
      );
    }
    if (payload.contactCategory === 'Resource' && !payload.resourceType) {
      throw new AppError('Resource Type is required for Resource contacts', 400, 'VALIDATION_ERROR');
    }
    if (isClient && !payload.organization) {
      throw new AppError('Organization Name is required for Client', 400, 'VALIDATION_ERROR');
    }
    if (isVendor && !payload.supplyCategory) {
      throw new AppError(
        `Supply Category is required for Vendor (one of: ${SUPPLY_CATEGORIES.join(', ')})`,
        400,
        'VALIDATION_ERROR'
      );
    }
    if (String(professionRaw || '').trim() && !payload.profession) {
      const list =
        contactCategory === 'Client'
          ? CLIENT_PROFESSIONS
          : contactCategory === 'Vendor'
            ? VENDOR_PROFESSIONS
            : allowedProfessions;
      throw new AppError(
        `Profession / Role must be one of: ${list.join(', ')}`,
        400,
        'VALIDATION_ERROR'
      );
    }
    if (!payload.email && !payload.contact) {
      throw new AppError('Email or Contact is required', 400, 'VALIDATION_ERROR');
    }
  }

  return payload;
}

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
  HCW_RESOURCE_TYPES,
  isHcwStaffResourceType,
  isServiceProviderContact,
  matchPicklist,
  normalizeProviderEmployees,
  CLIENT_PROFESSIONS,
  VENDOR_PROFESSIONS,
  HEALTHCARE_WORKER_PROFESSIONS,
  SUPPLY_CATEGORIES,
} from './contact.constants.js';
import { normalizeEmail } from '../../utils/identityNormalize.js';
import { AppError } from '../../utils/helpers.js';
import { formatTextValue } from '../../utils/textFormat.js';

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
  passbookCopyUrl: '',
  panCardCopyUrl: '',
  notes: '',
  district: '',
  stateId: null,
  districtId: null,
  cityId: null,
  /** Healthcare Worker staff → parent Service Provider contact */
  serviceProviderContactId: null,
  /** Employees under a Service Provider (name, mobile, profession) */
  providerEmployees: [],
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
  } else if (contactCategory === 'Healthcare Worker') {
    const matched = matchPicklist(resourceTypeRaw, HCW_RESOURCE_TYPES);
    resourceType = HCW_RESOURCE_TYPES.includes(matched) ? matched : '';
  }

  let serviceProviderContactId = null;
  if (contactCategory === 'Healthcare Worker' && isHcwStaffResourceType(resourceType)) {
    const rawSp =
      body.serviceProviderContactId ||
      body.serviceProviderId ||
      body['Service Provider'] ||
      body.serviceProvider ||
      '';
    serviceProviderContactId = String(rawSp || '').trim() || null;
  }

  const professionRaw = body.profession || body.Profession || body['Profession / Role'] || '';
  const profession = normalizeProfession(professionRaw, contactCategory);
  const allowedProfessions = professionsForCategory(contactCategory);

  const isClient = contactCategory === 'Client';
  const isVendor = contactCategory === 'Vendor';

  const organization = isClient
    ? formatTextValue(
        String(
          body.organization ||
            body.Organization ||
            body['Organization Name'] ||
            body['Organization'] ||
            ''
        ),
        'organization'
      )
    : '';

  const supplyCategoryRaw =
    body.supplyCategory ||
    body['Supply Category'] ||
    body.supply_category ||
    body.SupplyCategory ||
    '';
  const supplyCategory = isVendor ? normalizeSupplyCategory(supplyCategoryRaw) : '';

  const payload = {
    name: formatTextValue(String(body.name || body.Name || ''), 'name'),
    email: normalizeEmail(body.email || body.Email || ''),
    contactCategory,
    resourceType:
      contactCategory === 'Resource' || contactCategory === 'Healthcare Worker' ? resourceType : '',
    serviceProviderContactId,
    profession,
    contact,
    mobile: contact,
    city: formatTextValue(String(body.city || body.City || ''), 'city'),
    state: formatTextValue(String(body.state || body.State || ''), 'state'),
    pinCode: isClient
      ? ''
      : String(
          body.pinCode || body.pincode || body['Pin Code'] || body.Pincode || body.PIN || ''
        ).trim(),
    address: isClient ? '' : formatTextValue(String(body.address || body.Address || ''), 'address'),
    organization,
    supplyCategory,
    panNumber: isClient
      ? ''
      : formatTextValue(String(body.panNumber || body.PAN || body['PAN Number'] || body.pan || ''), 'panNumber'),
    ifscCode: isClient
      ? ''
      : formatTextValue(String(body.ifscCode || body.IFSC || body['IFSC Code'] || body.ifsc || ''), 'ifscCode'),
    bankName: isClient
      ? ''
      : formatTextValue(String(body.bankName || body['Bank Name'] || body.bank || ''), 'bankName'),
    accountNumber: isClient
      ? ''
      : formatTextValue(String(body.accountNumber || body['Account Number'] || body.account || ''), 'accountNumber'),
    passbookCopyUrl: isClient
      ? ''
      : String(body.passbookCopyUrl || body.passbookCopy || '').trim(),
    panCardCopyUrl: isClient
      ? ''
      : String(body.panCardCopyUrl || body.panCardCopy || '').trim(),
    notes: formatTextValue(String(body.notes || ''), 'notes'),
    district: formatTextValue(String(body.district || body.District || ''), 'district'),
    stateId: body.stateId || null,
    districtId: body.districtId || null,
    cityId: body.cityId || null,
    providerEmployees: normalizeProviderEmployees(
      body.providerEmployees,
      contactCategory,
      contactCategory === 'Healthcare Worker' ? resourceType : ''
    ),
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
    if (payload.contactCategory === 'Healthcare Worker' && !payload.resourceType) {
      throw new AppError(
        'Resource Type is required for Healthcare Worker contacts',
        400,
        'VALIDATION_ERROR'
      );
    }
    if (
      payload.contactCategory === 'Healthcare Worker' &&
      payload.resourceType === 'Service Provider' &&
      payload.serviceProviderContactId
    ) {
      throw new AppError(
        'Service Provider contacts cannot be linked to another provider',
        400,
        'VALIDATION_ERROR'
      );
    }
    if (
      payload.contactCategory === 'Healthcare Worker' &&
      payload.resourceType === 'Service Provider'
    ) {
      if (!String(payload.state || '').trim()) {
        throw new AppError('State is required for Service Provider', 400, 'VALIDATION_ERROR');
      }
      if (!String(payload.contact || '').trim()) {
        throw new AppError('Mobile number is required for Service Provider', 400, 'VALIDATION_ERROR');
      }
      for (let i = 0; i < payload.providerEmployees.length; i += 1) {
        const emp = payload.providerEmployees[i];
        if (!emp.name) {
          throw new AppError(`Employee ${i + 1}: name is required`, 400, 'VALIDATION_ERROR');
        }
        if (!emp.mobile) {
          throw new AppError(`Employee ${i + 1}: mobile number is required`, 400, 'VALIDATION_ERROR');
        }
      }
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
            : contactCategory === 'Healthcare Worker'
              ? HEALTHCARE_WORKER_PROFESSIONS
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

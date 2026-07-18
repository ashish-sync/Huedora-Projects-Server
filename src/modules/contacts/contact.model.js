import { defineCollection } from '../../store/filedb.js';
import { softDelete } from '../common/counter.model.js';
import { matchPicklist, RESOURCE_TYPES, PROFESSIONS } from './contact.constants.js';

/** Contact directory fields (Excel + form parity) */
export const Contact = defineCollection('contacts', {
  ...softDelete,
  name: '',
  email: '',
  resourceType: '',
  profession: '',
  contact: '',
  mobile: '',
  city: '',
  state: '',
  pinCode: '',
  address: '',
  organization: '',
  notes: '',
});

export function normalizeContactPayload(body = {}) {
  const contact = String(body.contact || body.mobile || body.Contact || '').trim();
  const email = body.email || body.Email || '';
  return {
    name: String(body.name || body.Name || '').trim(),
    email: email ? String(email).toLowerCase().trim() : '',
    resourceType: matchPicklist(
      body.resourceType || body['Resource Type'] || body.resource_type || '',
      RESOURCE_TYPES
    ),
    profession: matchPicklist(body.profession || body.Profession || '', PROFESSIONS),
    contact,
    mobile: contact,
    city: String(body.city || body.City || '').trim(),
    state: String(body.state || body.State || '').trim(),
    pinCode: String(
      body.pinCode || body.pincode || body['Pin Code'] || body.Pincode || body.PIN || ''
    ).trim(),
    address: String(body.address || body.Address || '').trim(),
    organization: String(body.organization || '').trim(),
    notes: String(body.notes || '').trim(),
  };
}

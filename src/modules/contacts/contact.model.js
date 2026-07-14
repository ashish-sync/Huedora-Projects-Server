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
    organization: String(body.organization || '').trim(),
    notes: String(body.notes || '').trim(),
  };
}

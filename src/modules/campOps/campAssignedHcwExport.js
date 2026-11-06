import { Contact } from '../contacts/contact.model.js';
import {
  embeddedServiceProviderEmployeeId,
  embeddedServiceProviderId,
  findEmbeddedProviderEmployee,
} from '../contacts/campPayoutPayee.js';

function contactPhone(contact = {}) {
  return String(contact.contact || contact.mobile || '').trim();
}

function contactDisplayName(contact = {}) {
  return String(contact.name || '').trim();
}

/**
 * Resolve live Contact Directory identity for an assigned camp HCW.
 * Used by exports so Change HCW updates appear even when denormalized
 * camp.hcwName / hcwContact lagged behind hcwContactId.
 */
export function assignedHcwDetailsFromContacts(camp = {}, contactsById = new Map()) {
  const assignmentId = String(camp?.hcwContactId || '').trim();
  if (!assignmentId) {
    return {
      hcwName: String(camp?.hcwName || '').trim(),
      hcwContact: String(camp?.hcwContact || '').trim(),
      hcwCategory: String(camp?.hcwCategory || '').trim(),
    };
  }

  const embeddedProviderId = embeddedServiceProviderId(assignmentId);
  if (embeddedProviderId) {
    const provider = contactsById.get(embeddedProviderId) || null;
    const employee = findEmbeddedProviderEmployee(provider, assignmentId);
    if (employee) {
      return {
        hcwName: contactDisplayName(employee) || String(camp?.hcwName || '').trim(),
        hcwContact: contactPhone(employee) || String(camp?.hcwContact || '').trim(),
        hcwCategory: String(camp?.hcwCategory || '').trim(),
      };
    }
    return {
      hcwName: contactDisplayName(provider) || String(camp?.hcwName || '').trim(),
      hcwContact: contactPhone(provider) || String(camp?.hcwContact || '').trim(),
      hcwCategory: String(camp?.hcwCategory || '').trim(),
    };
  }

  const contact = contactsById.get(assignmentId) || null;
  if (!contact) {
    return {
      hcwName: String(camp?.hcwName || '').trim(),
      hcwContact: String(camp?.hcwContact || '').trim(),
      hcwCategory: String(camp?.hcwCategory || '').trim(),
    };
  }

  return {
    hcwName: contactDisplayName(contact) || String(camp?.hcwName || '').trim(),
    hcwContact: contactPhone(contact) || String(camp?.hcwContact || '').trim(),
    hcwCategory: String(camp?.hcwCategory || '').trim(),
  };
}

async function loadContactsByIds(ids = []) {
  const unique = [...new Set(ids.map((id) => String(id || '').trim()).filter(Boolean))];
  if (!unique.length) return new Map();
  const rows = await Contact.find({ _id: { $in: unique }, isDeleted: false });
  return new Map(rows.map((row) => [String(row._id), row]));
}

/**
 * Overlay live Contact Directory HCW name/phone onto camp rows for export/report.
 * Does not mutate Mongo — returns plain objects for spreadsheet builders.
 */
export async function enrichCampsAssignedHcwForExport(camps = []) {
  const list = Array.isArray(camps) ? camps : [];
  if (!list.length) return [];

  const directIds = [];
  const providerIds = new Set();
  for (const camp of list) {
    const assignmentId = String(camp?.hcwContactId || '').trim();
    if (!assignmentId) continue;
    const embeddedProviderId = embeddedServiceProviderId(assignmentId);
    if (embeddedProviderId) {
      providerIds.add(embeddedProviderId);
      continue;
    }
    directIds.push(assignmentId);
  }

  const contactsById = await loadContactsByIds(directIds);
  for (const contact of contactsById.values()) {
    const linked = String(contact.serviceProviderContactId || '').trim();
    if (linked) providerIds.add(linked);
  }
  const providersById = await loadContactsByIds([...providerIds]);
  for (const [id, contact] of providersById.entries()) {
    contactsById.set(id, contact);
  }

  return list.map((camp) => {
    const plain = camp?.toObject ? camp.toObject() : { ...camp };
    const live = assignedHcwDetailsFromContacts(plain, contactsById);
    return {
      ...plain,
      hcwName: live.hcwName,
      hcwContact: live.hcwContact,
      hcwCategory: live.hcwCategory || plain.hcwCategory || '',
    };
  });
}

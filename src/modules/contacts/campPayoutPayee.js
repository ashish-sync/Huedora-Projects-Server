import { Contact } from './contact.model.js';
import { isServiceProviderContact } from './contact.constants.js';

/** Embedded roster employee ids look like `spe:<providerId>:<employeeId>`. */
export function embeddedServiceProviderId(assignmentId = '') {
  const raw = String(assignmentId || '').trim();
  if (!raw.startsWith('spe:')) return '';
  const parts = raw.split(':');
  return String(parts[1] || '').trim();
}

export function payeeBankFieldsFromContact(contact) {
  if (!contact) {
    return {
      bankName: '',
      accountNumber: '',
      ifscCode: '',
      panCardCopyUrl: '',
      passbookCopyUrl: '',
    };
  }
  const row = contact.toObject ? contact.toObject() : contact;
  return {
    bankName: String(row.bankName || '').trim(),
    accountNumber: String(row.accountNumber || '').trim(),
    ifscCode: String(row.ifscCode || '').trim(),
    panCardCopyUrl: String(row.panCardCopyUrl || '').trim(),
    passbookCopyUrl: String(row.passbookCopyUrl || '').trim(),
  };
}

/**
 * Resolve who gets paid for a camp assignment.
 * Service Provider path → agency contact; otherwise the assigned HCW.
 */
export function resolveCampPayoutPayee({
  assignmentId = '',
  assignedContact = null,
  contactsById = new Map(),
} = {}) {
  const assignedId = String(assignmentId || assignedContact?._id || '').trim();
  const assigned = assignedContact
    || (assignedId && !assignedId.startsWith('spe:') ? contactsById.get(assignedId) : null)
    || null;

  const embeddedProviderId = embeddedServiceProviderId(assignedId);
  const linkedProviderId = String(
    assigned?.serviceProviderContactId
      || assignedContact?.serviceProviderContactId
      || '',
  ).trim();
  const providerId = embeddedProviderId || linkedProviderId;

  if (providerId) {
    const provider = contactsById.get(String(providerId)) || null;
    return {
      assignedContact: assigned,
      payeeContact: provider,
      payeeContactId: provider?._id || providerId,
      payeeName: String(provider?.name || assigned?.serviceProviderName || '').trim(),
      payeeIsServiceProvider: true,
    };
  }

  if (isServiceProviderContact(assigned)) {
    return {
      assignedContact: assigned,
      payeeContact: assigned,
      payeeContactId: assigned?._id || null,
      payeeName: String(assigned?.name || '').trim(),
      payeeIsServiceProvider: true,
    };
  }

  return {
    assignedContact: assigned,
    payeeContact: assigned,
    payeeContactId: assigned?._id || null,
    payeeName: String(assigned?.name || '').trim(),
    payeeIsServiceProvider: false,
  };
}

async function loadContactsByIds(ids = []) {
  const unique = [...new Set(ids.map((id) => String(id || '').trim()).filter(Boolean))];
  if (!unique.length) return new Map();
  const rows = await Contact.find({ _id: { $in: unique }, isDeleted: false });
  return new Map(rows.map((row) => [String(row._id), row]));
}

/**
 * Enrich camp payout summaries with payee identity + bank/KYC from Contact Directory.
 */
export async function enrichCampPayoutsWithPayee(summaries = []) {
  const assignmentIds = summaries
    .map((row) => String(row?.hcwContactId || '').trim())
    .filter(Boolean);

  const directIds = assignmentIds.filter((id) => !id.startsWith('spe:'));
  const contactsById = await loadContactsByIds(directIds);

  const providerIds = new Set();
  for (const id of assignmentIds) {
    const embedded = embeddedServiceProviderId(id);
    if (embedded) providerIds.add(embedded);
  }
  for (const contact of contactsById.values()) {
    const linked = String(contact.serviceProviderContactId || '').trim();
    if (linked) providerIds.add(linked);
  }

  const providersById = await loadContactsByIds([...providerIds]);
  for (const [id, contact] of providersById.entries()) {
    contactsById.set(id, contact);
  }

  return summaries.map((row) => {
    const assignmentId = String(row?.hcwContactId || '').trim();
    const resolved = resolveCampPayoutPayee({
      assignmentId,
      assignedContact: contactsById.get(assignmentId) || null,
      contactsById,
    });
    const payee = resolved.payeeContact;
    const fallbackName = String(row.hcwName || '').trim();

    return {
      ...row,
      payeeContactId: resolved.payeeContactId || '',
      payeeName: resolved.payeeName || fallbackName,
      payeeIsServiceProvider: Boolean(resolved.payeeIsServiceProvider),
      assignedHcwName: fallbackName,
      ...payeeBankFieldsFromContact(payee),
    };
  });
}

export async function resolveCampPayoutPayeeContact(assignmentId) {
  const id = String(assignmentId || '').trim();
  if (!id) {
    return resolveCampPayoutPayee({});
  }

  const embeddedProviderId = embeddedServiceProviderId(id);
  const idsToLoad = embeddedProviderId ? [embeddedProviderId] : [id];
  const contactsById = await loadContactsByIds(idsToLoad);

  let assignedContact = embeddedProviderId ? null : contactsById.get(id) || null;
  const linkedProviderId = String(assignedContact?.serviceProviderContactId || '').trim();
  if (linkedProviderId && !contactsById.has(linkedProviderId)) {
    const providers = await loadContactsByIds([linkedProviderId]);
    for (const [pid, contact] of providers.entries()) contactsById.set(pid, contact);
  }

  return resolveCampPayoutPayee({
    assignmentId: id,
    assignedContact,
    contactsById,
  });
}

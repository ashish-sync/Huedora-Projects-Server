function localTrim(value) {
  return String(value ?? '').trim();
}

export function getHcwFinanceBlockers(contact = {}, { requireDocuments = true, label = 'HCW' } = {}) {
  const blockers = [];
  const who = localTrim(label) || 'HCW';

  if (!contact || !contact._id) {
    blockers.push(
      who === 'Service Provider'
        ? 'Assign a healthcare worker linked to a Service Provider before submitting to Finance'
        : 'Assign a healthcare worker before submitting to Finance',
    );
    return blockers;
  }

  if (!localTrim(contact.name)) blockers.push(`${who} name is missing in Contact Directory`);
  if (!localTrim(contact.contact || contact.mobile)) {
    blockers.push(`${who} mobile number is missing in Contact Directory`);
  }
  if (who !== 'Service Provider' && !localTrim(contact.profession)) {
    blockers.push(`${who} profession is missing in Contact Directory`);
  }
  if (!localTrim(contact.city)) blockers.push(`${who} city is missing in Contact Directory`);
  if (!localTrim(contact.state)) blockers.push(`${who} state is missing in Contact Directory`);
  if (!localTrim(contact.address)) blockers.push(`${who} address is missing in Contact Directory`);
  if (!localTrim(contact.pinCode)) blockers.push(`${who} PIN code is missing in Contact Directory`);
  if (!localTrim(contact.panNumber)) blockers.push(`${who} PAN number is missing in Contact Directory`);
  if (!localTrim(contact.ifscCode)) blockers.push(`${who} IFSC code is missing in Contact Directory`);
  if (!localTrim(contact.bankName)) blockers.push(`${who} bank name is missing in Contact Directory`);
  if (!localTrim(contact.accountNumber)) {
    blockers.push(`${who} bank account number is missing in Contact Directory`);
  }

  if (requireDocuments) {
    if (!localTrim(contact.passbookCopyUrl)) {
      blockers.push(`${who} passbook copy is not uploaded in Contact Directory`);
    }
    if (!localTrim(contact.panCardCopyUrl)) {
      blockers.push(`${who} PAN card copy is not uploaded in Contact Directory`);
    }
  }

  return blockers;
}

export function isHcwReadyForFinance(contact = {}, options = {}) {
  return getHcwFinanceBlockers(contact, options).length === 0;
}

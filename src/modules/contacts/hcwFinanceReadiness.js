function localTrim(value) {
  return String(value ?? '').trim();
}

export function getHcwFinanceBlockers(contact = {}, { requireDocuments = true } = {}) {
  const blockers = [];

  if (!contact || !contact._id) {
    blockers.push('Assign a healthcare worker before submitting to Finance');
    return blockers;
  }

  if (!localTrim(contact.name)) blockers.push('HCW name is missing in Contact Directory');
  if (!localTrim(contact.contact || contact.mobile)) {
    blockers.push('HCW mobile number is missing in Contact Directory');
  }
  if (!localTrim(contact.profession)) blockers.push('HCW profession is missing in Contact Directory');
  if (!localTrim(contact.city)) blockers.push('HCW city is missing in Contact Directory');
  if (!localTrim(contact.state)) blockers.push('HCW state is missing in Contact Directory');
  if (!localTrim(contact.address)) blockers.push('HCW address is missing in Contact Directory');
  if (!localTrim(contact.pinCode)) blockers.push('HCW PIN code is missing in Contact Directory');
  if (!localTrim(contact.panNumber)) blockers.push('HCW PAN number is missing in Contact Directory');
  if (!localTrim(contact.ifscCode)) blockers.push('HCW IFSC code is missing in Contact Directory');
  if (!localTrim(contact.bankName)) blockers.push('HCW bank name is missing in Contact Directory');
  if (!localTrim(contact.accountNumber)) {
    blockers.push('HCW bank account number is missing in Contact Directory');
  }

  if (requireDocuments) {
    if (!localTrim(contact.passbookCopyUrl)) {
      blockers.push('HCW passbook copy is not uploaded in Contact Directory');
    }
    if (!localTrim(contact.panCardCopyUrl)) {
      blockers.push('HCW PAN card copy is not uploaded in Contact Directory');
    }
  }

  return blockers;
}

export function isHcwReadyForFinance(contact = {}, options = {}) {
  return getHcwFinanceBlockers(contact, options).length === 0;
}

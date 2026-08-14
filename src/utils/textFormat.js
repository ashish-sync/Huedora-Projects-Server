/**
 * Consistent text cleanup and Proper (Title) Case for user-entered data.
 */

const MINOR_WORDS = new Set([
  'a', 'an', 'the', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 'of', 'by', 'as', 'vs', 'via', 'per',
]);

const PLAIN_FIELDS = new Set([
  'googlePlaceId', 'pincode', 'pinCode', 'latitude', 'longitude',
  'startTime', 'endTime', 'inTime', 'outTime', 'campDate', 'requestDate', 'purchaseMonth',
  'assignedUserEmails', 'requestTimeline', 'accountNumber', 'transactionId', 'password',
  'campaignName', 'programName', 'campName', 'deviceNameSnapshot',
  'assetType', 'agreementStatus', 'custody', 'campaignType', 'source', 'contactPersonLevel',
  'resourceType', 'contactCategory', 'productType', 'assignmentStatus', 'executionStatus',
  'chargeableStatus', 'attire', 'labCoat', 'speciality', 'profession', 'supplyCategory',
  'healthcareWorker', 'hcwCategory', 'zone', 'method', 'remarks', 'hcwContactId',
  // Machine enums / ids — never title-case (breaks lifecycle & status checks)
  'lifecycleStage', 'status', 'assignmentDecision', 'assignmentRefusalReason',
  'requestReviewStatus', 'paymentSubmitStatus', 'financePaymentStatus',
  'closureType', 'closureReasonCode', 'closureSubReason', 'closureReasonCategory',
  'cancelledBy', 'editingStage', 'campSlot',
  // Client Master Camp Terms — dates / PO identifiers must stay verbatim
  'campTerms', 'poNumber', 'poIssueDate', 'poExpiryDate',
  'agreementStartDate', 'agreementEffectiveDate', 'agreementEndDate',
]);

const CODE_FIELDS = new Set([
  'doctorCode', 'clientCode', 'scCode', 'mslNo', 'serialNumber', 'panNumber', 'ifscCode', 'code',
]);

const PHONE_FIELDS = new Set([
  'fieldPersonPhone', 'hcwContact', 'spocNumber', 'contact', 'mobile', 'custodianContact', 'phone',
]);

const EMAIL_FIELDS = new Set(['email', 'spocEmail']);

export function cleanSpaces(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function capitalizeWord(word, isFirst) {
  const lower = word.toLowerCase();
  if (!isFirst && MINOR_WORDS.has(lower)) return lower;
  if (!lower) return '';
  return lower.charAt(0).toUpperCase() + lower.slice(1);
}

function formatTitleWord(word, isFirst) {
  if (!word) return '';
  if (/^[A-Z0-9][A-Z0-9./-]*$/.test(word) && word.length <= 8) return word;

  if (word.includes('-')) {
    return word
      .split('-')
      .map((part, index) => formatTitleWord(part, isFirst && index === 0))
      .join('-');
  }

  if (word.includes("'")) {
    return word
      .split("'")
      .map((part, index) => {
        if (!part) return part;
        return capitalizeWord(part, isFirst && index === 0);
      })
      .join("'");
  }

  if (word.includes('/')) {
    return word
      .split('/')
      .map((part, index) => formatTitleWord(part, isFirst && index === 0))
      .join('/');
  }

  return capitalizeWord(word, isFirst);
}

export function toProperTitleCase(value) {
  const text = cleanSpaces(value);
  if (!text) return '';
  return text
    .split(' ')
    .filter(Boolean)
    .map((word, index) => formatTitleWord(word, index === 0))
    .join(' ');
}

const DOCTOR_NAME_PREFIX_RE = /^(?:dr|doctor)\.?\s+/i;

/** Remove Dr / Dr. / Doctor prefix from camp doctor names. */
export function stripDoctorNamePrefix(value) {
  let text = cleanSpaces(value);
  while (text && DOCTOR_NAME_PREFIX_RE.test(text)) {
    text = cleanSpaces(text.replace(DOCTOR_NAME_PREFIX_RE, ''));
  }
  return text;
}

export function hasDoctorNamePrefix(value) {
  return DOCTOR_NAME_PREFIX_RE.test(cleanSpaces(value));
}

export function formatDoctorName(value) {
  const stripped = stripDoctorNamePrefix(value);
  if (!stripped) return '';
  return toProperTitleCase(stripped);
}

export function formatContactPersonName(value) {
  return toProperTitleCase(value);
}

export function getDoctorNameFormatError(value) {
  const raw = cleanSpaces(value);
  if (!raw) return 'Doctor name is required';
  if (hasDoctorNamePrefix(raw)) {
    return 'Enter doctor name without Dr or Dr. — use Title Case (e.g. Rajesh Kumar)';
  }
  if (!formatDoctorName(raw)) return 'Doctor name is required';
  return null;
}

export function formatTextValue(value, fieldKey = '') {
  if (value == null) return value;
  if (typeof value !== 'string') return value;

  const key = String(fieldKey || '');
  if (key === 'doctorName') return formatDoctorName(value);
  if (key === 'fieldPersonName' || key === 'contactPersonName' || key === 'hcwName') {
    return formatContactPersonName(value);
  }
  if (key === 'campAddress' || key === 'address' || key === 'hospitalName' || key === 'clinicName') {
    return toProperTitleCase(value);
  }
  if (EMAIL_FIELDS.has(key)) return cleanSpaces(value).toLowerCase();
  if (PHONE_FIELDS.has(key)) return cleanSpaces(value);
  if (CODE_FIELDS.has(key)) return cleanSpaces(value).toUpperCase();
  if (PLAIN_FIELDS.has(key)) return cleanSpaces(value);
  return toProperTitleCase(value);
}

export function formatFormFields(form = {}, keys = []) {
  const next = { ...form };
  keys.forEach((key) => {
    if (typeof next[key] === 'string') {
      next[key] = formatTextValue(next[key], key);
    }
  });
  return next;
}

export function formatObjectTextFields(object = {}, extraPlain = []) {
  const plain = new Set([...PLAIN_FIELDS, ...extraPlain]);
  const out = { ...object };
  Object.entries(out).forEach(([key, value]) => {
    if (typeof value !== 'string') return;
    if (plain.has(key)) {
      out[key] = cleanSpaces(value);
      return;
    }
    if (CODE_FIELDS.has(key)) {
      out[key] = cleanSpaces(value).toUpperCase();
      return;
    }
    if (EMAIL_FIELDS.has(key)) {
      out[key] = cleanSpaces(value).toLowerCase();
      return;
    }
    if (PHONE_FIELDS.has(key)) {
      out[key] = cleanSpaces(value);
      return;
    }
    out[key] = toProperTitleCase(value);
  });
  return out;
}

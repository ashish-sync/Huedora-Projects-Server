/** Finance One expense types (expense line items). Not the Movement One Expense Master. */
export const EXPENSE_CATEGORIES = [
  'Travel',
  'Training',
  'Camp',
  'Maintenance',
  'Courier',
  'Utilities',
  'Professional fees',
  'Other',
];

export const EXPENSE_STATUSES = ['Draft', 'Submitted', 'Approved', 'Paid', 'Rejected'];

/** @deprecated Prefer VENDOR_BILL_STATUSES — kept for older Open/Paid rows during migration. */
export const INVOICE_STATUSES = [
  'draft',
  'submitted',
  'under_verification',
  'verified',
  'approved',
  'rejected',
  'partially_paid',
  'paid',
  'cancelled',
  'Open',
  'Partially paid',
  'Paid',
  'Cancelled',
];

export const PAYMENT_MODES = ['Bank transfer', 'UPI', 'Cheque', 'Cash', 'Card', 'Other'];

export const CAMP_PAYOUT_SUBMIT_STATUSES = [
  { value: 'payment_confirmed', label: 'Validation Completed' },
  { value: 'payment_not_checked', label: 'Validation Pending' },
  { value: 'payment_hold', label: 'Payment On Hold' },
];

export const CAMP_FINANCE_PAYMENT_STATUSES = [
  { value: 'not_paid', label: 'Not Paid' },
  { value: 'under_review', label: 'Under Review' },
  { value: 'paid', label: 'Payment Completed' },
];

export const COMMERCIAL_DOC_TYPES = [
  'proforma',
  'client_invoice',
  'purchase_order',
  'credit_note',
];

export const COMMERCIAL_DOC_STATUSES = [
  'Draft',
  'Submitted',
  'Approved',
  'Issued',
  'Uploaded',
  'Cancelled',
  'Converted',
];

export const COMMERCIAL_PAYMENT_STATUSES = ['Unpaid', 'Partially paid', 'Fully paid'];

export const DEFAULT_SAC_CODE = '999316';

export const DEFAULT_ORG_PROFILE = {
  legalName: 'Tyo Care Private Limited',
  brandLine: 'Bringing Healthcare Closer',
  cin: 'U74999MH2008PTC184213',
  pan: 'AADCK4268L',
  gstin: '27AADCK4268L1Z4',
  state: 'Maharashtra',
  stateCode: '27',
  registeredOffice:
    '216, 2nd Floor, Corporate Avenue, Sonawala Road, Goregaon East, Mumbai, Maharashtra 400063',
  phone: '022 6113 1400',
  email: 'care@kartavyahealtheon.com',
  website: 'kartavyahealtheon.com',
  bankName: 'HDFC Bank Ltd',
  accountHolder: 'Tylo Care Pvt. Ltd.',
  accountNumber: '50200120975721',
  ifscCode: 'HDFC0000212',
  bankBranch: 'Goregaon E',
  upiId: '',
  logoDataUrl: '',
  paymentQrDataUrl: '',
  defaultPaymentTermsDays: 45,
  defaultTerms: [
    'Please pay on or before the due date. Interest @ 2% will be charged in case of any delay in the payments.',
    'Disputes, if any, will be subjected to the jurisdiction of Mumbai Courts',
    'Payment is to be made in favor of "Kartavya Healtheon Private Limited", Account no.: 50200120975721, HDFC Bank Ltd, IFSC code : HDFC0000212, Branch : Goregaon East, Mumbai – 400063',
  ],
  proformaNotes: [
    'Camp cancellation would require minimum 24 hours notice. In case of cancellation with less than 24 hours notice camp will be charged fully.',
    'Camp timings exceeding 4 hours will charge Rs 950 per hour',
    'Each Camp would not exceed 100 count.',
    'Payment terms - 45 days',
    'Logistic & Transport Cost is for One Time only apart from this any Internal movements or transfer will be on Actual basis',
    'The above charges apply to camps for Municipal Limits or within a 50km round trip',
  ],
  defaultPoTerms: [
    'By accepting this Purchase Order, you confirm your agreement to the terms and conditions.',
    'Rates, delivery, payment terms, and other conditions: As mutually agreed.',
    'Taxes: As applicable',
  ],
  defaultPurchaseTaxRate: 5,
};

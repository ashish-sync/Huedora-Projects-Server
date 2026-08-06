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
  'debit_note',
  'delivery_challan',
  'bill_of_supply',
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
  legalName: 'Tylo Care Private Limited',
  brandLine: 'Bringing Healthcare Closer',
  cin: 'U86909MH2026PTC472417',
  pan: 'AANCT2428H',
  gstin: '27AANCT2428H1Z4',
  state: 'Maharashtra',
  stateCode: '27',
  registeredOffice:
    'C-1207, Sahara Tower CHS Ltd., C Wing, Sahar Road, International Airport, Mumbai – 400099',
  phone: '',
  email: 'growth@tylocare.com',
  website: 'tylocare.com',
  udyam: 'UDYAM-MH-19-0446179',
  udyamLabel: 'Micro Enterprise',
  bankName: 'IDFC FIRST Bank',
  accountHolder: 'Tylo Care Private Limited',
  accountNumber: '10289978474',
  ifscCode: 'IDFB0040102',
  bankBranch: 'Prabhadevi Branch, Mumbai',
  upiId: '',
  logoDataUrl: '',
  paymentQrDataUrl: '',
  signatureDataUrl: '',
  signatoryName: '',
  defaultPaymentTermsDays: 30,
  defaultTerms: [
    'Payment is due within 30 days from the date of the Bill of Supply unless otherwise agreed.',
  ],
  proformaNotes: [
    'Camp cancellation would require minimum 24 hours notice. In case of cancellation with less than 24 hours notice camp will be charged fully.',
    'Camp timings exceeding 4 hours will charge Rs 950 per hour',
    'Each Camp would not exceed 100 count.',
    'Payment terms - 30 days',
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

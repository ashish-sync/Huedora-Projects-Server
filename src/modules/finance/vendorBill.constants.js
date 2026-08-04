/** Vendor bill (AP) lifecycle statuses. */
export const VENDOR_BILL_STATUSES = [
  'draft',
  'submitted',
  'under_verification',
  'verified',
  'approved',
  'rejected',
  'partially_paid',
  'paid',
  'cancelled',
];

export const VENDOR_BILL_STATUS_LABELS = {
  draft: 'Draft',
  submitted: 'Submitted',
  under_verification: 'Under verification',
  verified: 'Verified',
  approved: 'Approved',
  rejected: 'Rejected',
  partially_paid: 'Partially paid',
  paid: 'Paid',
  cancelled: 'Cancelled',
};

/** Map legacy FinanceInvoice statuses into the AP lifecycle. */
export function normalizeVendorBillStatus(raw) {
  const value = String(raw || '').trim();
  const lower = value.toLowerCase().replace(/\s+/g, '_');
  if (VENDOR_BILL_STATUSES.includes(lower)) return lower;
  if (value === 'Open') return 'approved';
  if (value === 'Partially paid') return 'partially_paid';
  if (value === 'Paid') return 'paid';
  if (value === 'Cancelled') return 'cancelled';
  if (value === 'Draft') return 'draft';
  return 'draft';
}

export function vendorBillStatusLabel(status) {
  const normalized = normalizeVendorBillStatus(status);
  return VENDOR_BILL_STATUS_LABELS[normalized] || status || '—';
}

export const VENDOR_BILL_EDITABLE_STATUSES = new Set(['draft', 'rejected']);
export const VENDOR_BILL_PAYABLE_STATUSES = new Set(['approved', 'partially_paid']);
export const VENDOR_BILL_ACTIVE_STATUSES = new Set([
  'draft',
  'submitted',
  'under_verification',
  'verified',
  'approved',
  'rejected',
  'partially_paid',
]);

export function assertVendorBillTransition(fromStatus, toStatus) {
  const from = normalizeVendorBillStatus(fromStatus);
  const to = normalizeVendorBillStatus(toStatus);
  if (from === to) return;

  const allowed = {
    draft: ['submitted', 'cancelled'],
    submitted: ['under_verification', 'cancelled'],
    under_verification: ['verified', 'draft', 'cancelled'],
    verified: ['approved', 'rejected', 'cancelled'],
    approved: ['partially_paid', 'paid', 'cancelled'],
    rejected: ['draft', 'submitted', 'cancelled'],
    partially_paid: ['paid', 'cancelled'],
    paid: [],
    cancelled: [],
  };

  if (!(allowed[from] || []).includes(to)) {
    const err = new Error(`Cannot move vendor bill from ${from} to ${to}`);
    err.code = 'VALIDATION_ERROR';
    err.status = 400;
    throw err;
  }
}

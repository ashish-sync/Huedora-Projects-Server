import { notifyEvent } from '../notifications/notifyEvent.js';
import { notifyRmInvolvement } from '../users/rmInvolve.js';

export function commercialDocLabel(row = {}) {
  return String(row.documentNumber || row.documentType || 'Document').trim() || 'Document';
}

export function vendorBillLabel(row = {}) {
  return String(row.billNumber || row.invoiceNumber || row._id || 'Vendor bill').trim() || 'Vendor bill';
}

export async function notifyCommercialSubmitted({ row, actor }) {
  return notifyRmInvolvement({
    level: 'approve',
    subjectUserId: actor?._id,
    actor,
    type: 'COMMERCIAL_SUBMIT',
    title: `${commercialDocLabel(row)} needs approval`,
    body: `${row.documentType || 'Commercial document'} submitted for approval`,
    entityType: 'FinanceCommercialDocument',
    entityId: row._id,
    module: 'finance',
    excludeActor: true,
    includeWatchers: false,
  });
}

export async function notifyCommercialDecision({ row, actor, approved }) {
  const submitter = row.submittedById || row.createdById;
  if (!submitter) return [];
  return notifyEvent({
    type: approved ? 'COMMERCIAL_APPROVED' : 'COMMERCIAL_REJECTED',
    title: `${commercialDocLabel(row)} ${approved ? 'approved' : 'rejected'}`,
    body: approved
      ? 'Your submission was approved.'
      : 'Your submission was rejected and returned to draft.',
    recipients: [submitter],
    actor,
    excludeActor: true,
    includeWatchers: false,
    includeReportingManagers: false,
    entityType: 'FinanceCommercialDocument',
    entityId: row._id,
    module: 'finance',
    meta: { kind: 'update' },
  });
}

export async function notifyVendorBillSubmitted({ row, actor }) {
  return notifyRmInvolvement({
    level: 'inform',
    subjectUserId: actor?._id,
    actor,
    type: 'VENDOR_BILL_SUBMITTED',
    title: `${vendorBillLabel(row)} entered verification`,
    body: 'A vendor bill is waiting for verification.',
    entityType: 'FinanceInvoice',
    entityId: row._id,
    module: 'finance',
    excludeActor: true,
    includeWatchers: false,
  });
}

export async function notifyVendorBillVerified({ row, actor }) {
  return notifyRmInvolvement({
    level: 'approve',
    subjectUserId: row.submittedById || row.createdById,
    actor,
    type: 'VENDOR_BILL_VERIFIED',
    title: `${vendorBillLabel(row)} needs approval`,
    body: 'Verification is complete. Commercial approval is required.',
    entityType: 'FinanceInvoice',
    entityId: row._id,
    module: 'finance',
    excludeActor: true,
    includeWatchers: false,
  });
}

export async function notifyVendorBillDecision({ row, actor, approved }) {
  const submitter = row.submittedById || row.createdById;
  if (!submitter) return [];
  return notifyEvent({
    type: approved ? 'VENDOR_BILL_APPROVED' : 'VENDOR_BILL_REJECTED',
    title: `${vendorBillLabel(row)} ${approved ? 'approved' : 'rejected'}`,
    body: approved
      ? 'Your vendor bill was approved.'
      : row.rejectionReason || 'Your vendor bill was rejected.',
    recipients: [submitter],
    actor,
    excludeActor: true,
    includeWatchers: false,
    includeReportingManagers: false,
    entityType: 'FinanceInvoice',
    entityId: row._id,
    module: 'finance',
    meta: { kind: 'update' },
  });
}

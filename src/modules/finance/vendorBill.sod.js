import { AppError } from '../../utils/helpers.js';
import { PERMISSIONS } from '../../config/constants.js';
import { normalizeVendorBillStatus } from './vendorBill.constants.js';
import { assertApprovalAuthority } from '../users/approvalAuthority.js';

function sameActor(a, b) {
  if (a == null || b == null) return false;
  return String(a) === String(b);
}

/**
 * Enforce segregation of duties on vendor-bill lifecycle transitions.
 * Approve/reject uses Reporting Manager authority (Director / Business Head /
 * Manager may self-approve). Verify stays submitter ≠ verifier.
 */
export async function assertVendorBillSegregationOfDuties(row, nextStatus, actor, permissions) {
  const to = normalizeVendorBillStatus(nextStatus);
  const from = normalizeVendorBillStatus(row?.status);
  const actorId = String(actor?._id || actor?.id || actor || '');

  if (to === 'verified' || (to === 'draft' && from === 'under_verification')) {
    if (sameActor(row.submittedById, actorId)) {
      throw new AppError(
        'Segregation of duties: the submitter cannot verify this bill',
        403,
        'SOD_VIOLATION'
      );
    }
  }

  if (to === 'approved' || to === 'rejected') {
    if (sameActor(row.verifiedById, actorId)) {
      throw new AppError(
        'Segregation of duties: the verifier cannot approve/reject this bill',
        403,
        'SOD_VIOLATION'
      );
    }
    const subjectUserId = row.submittedById || row.createdById;
    await assertApprovalAuthority({
      actor: typeof actor === 'object' && actor ? actor : { _id: actorId },
      subjectUserId,
      permissions,
      action: to === 'rejected' ? 'reject' : 'approve',
    });
  }
}

export function assertVendorBillPaySegregationOfDuties(row, actorId) {
  const actor = String(actorId || '');
  if (
    sameActor(row.submittedById, actor) ||
    sameActor(row.verifiedById, actor) ||
    sameActor(row.approvedById, actor)
  ) {
    throw new AppError(
      'Segregation of duties: a prior submitter, verifier, or approver cannot pay this bill',
      403,
      'SOD_VIOLATION'
    );
  }
}

/** Permission required for a transition target (after normalizing submitted → under_verification). */
export function permissionForVendorBillTransition(fromStatus, toStatus) {
  const from = normalizeVendorBillStatus(fromStatus);
  const to = normalizeVendorBillStatus(toStatus);
  const next = to === 'submitted' ? 'under_verification' : to;
  if (next === 'under_verification') return PERMISSIONS.FINANCE_WRITE;
  if (next === 'verified') return PERMISSIONS.FINANCE_VERIFY;
  if (next === 'draft' && from === 'under_verification') return PERMISSIONS.FINANCE_VERIFY;
  if (next === 'approved' || next === 'rejected') return PERMISSIONS.FINANCE_APPROVE;
  if (next === 'cancelled') return PERMISSIONS.FINANCE_WRITE;
  if (next === 'draft') return PERMISSIONS.FINANCE_WRITE;
  return PERMISSIONS.FINANCE_WRITE;
}

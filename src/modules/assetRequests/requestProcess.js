/**
 * Type-specific close-out (process) validation for Request One.
 * Hiring uses fulfill — not this module.
 */

import { AppError } from '../../utils/helpers.js';
import { LOGISTICS_MODES, normalizeLogisticsMode } from './assetRequest.model.js';

export const PROCESSABLE_TYPES = [
  'REIMBURSEMENT',
  'TRAINING',
  'LOGISTICS',
  'REPAIR',
  'MAINTENANCE',
  'SERVICE',
  'OTHER',
];

export function normalizeProcessType(requestType) {
  const t = String(requestType || '').toUpperCase();
  if (t === 'SERVICE') return 'SERVICE';
  return t;
}

/**
 * Validate and normalize process body for a request type.
 * @returns {{ patch: object, logMessage: string, actionLabel: string }}
 */
export function buildProcessOutcome(requestType, body = {}, row = {}) {
  const type = normalizeProcessType(requestType);
  const remark = String(body.processRemark || body.remark || '').trim();

  if (type === 'REIMBURSEMENT') {
    const processReference = String(
      body.processReference || body.utr || body.paymentRef || ''
    ).trim();
    const amountRaw = body.processAmount ?? body.amountPaid ?? body.amount;
    const processAmount =
      amountRaw === '' || amountRaw == null ? null : Number(amountRaw);
    if (!processReference) {
      throw new AppError('UTR is required', 400, 'VALIDATION_ERROR');
    }
    if (processAmount == null || !Number.isFinite(processAmount) || processAmount <= 0) {
      throw new AppError(
        'Exact payment amount is required and must be greater than zero',
        400,
        'VALIDATION_ERROR'
      );
    }
    return {
      actionLabel: 'Process',
      patch: {
        processAction: 'PROCESS',
        processReference,
        processAmount,
        processRemark: remark,
        currency: row.currency || body.currency || 'INR',
      },
      logMessage: remark
        ? `Processed · UTR ${processReference} · ₹${processAmount} — ${remark}`
        : `Processed · UTR ${processReference} · ₹${processAmount}`,
    };
  }

  if (type === 'TRAINING') {
    const scheduledAt = String(body.scheduledAt || body.scheduleAt || '').trim();
    const scheduleVenue = String(body.scheduleVenue || body.venue || '').trim();
    if (!scheduledAt) {
      throw new AppError('Schedule date/time is required', 400, 'VALIDATION_ERROR');
    }
    if (!scheduleVenue) {
      throw new AppError('Venue / trainer is required', 400, 'VALIDATION_ERROR');
    }
    const when = new Date(scheduledAt);
    if (!Number.isFinite(when.getTime())) {
      throw new AppError('Schedule date/time is invalid', 400, 'VALIDATION_ERROR');
    }
    return {
      actionLabel: 'Schedule',
      patch: {
        processAction: 'SCHEDULE',
        scheduledAt: when.toISOString(),
        scheduleVenue,
        processRemark: remark,
      },
      logMessage: remark
        ? `Scheduled · ${scheduleVenue} · ${when.toISOString()} — ${remark}`
        : `Scheduled · ${scheduleVenue} · ${when.toISOString()}`,
    };
  }

  if (type === 'LOGISTICS') {
    const processRemark = String(body.processRemark || body.issueNote || body.remark || '').trim();
    if (!processRemark) {
      throw new AppError('Issue note is required', 400, 'VALIDATION_ERROR');
    }
    const transportMode = normalizeLogisticsMode(
      body.transportMode || body.deliveryMode || row.transportMode || ''
    );
    if (!LOGISTICS_MODES.includes(transportMode)) {
      throw new AppError(
        `Mode of delivery must be one of: ${LOGISTICS_MODES.join(', ')}`,
        400,
        'VALIDATION_ERROR'
      );
    }
    const awbNumber = String(body.awbNumber || body.awb || body.trackingNumber || '').trim();
    if (transportMode === 'Courier' && !awbNumber) {
      throw new AppError('AWB number is required for Courier', 400, 'VALIDATION_ERROR');
    }
    return {
      actionLabel: 'Issue',
      patch: {
        processAction: 'ISSUE',
        processRemark,
        transportMode,
        awbNumber,
        issuedAt: new Date().toISOString(),
      },
      logMessage: awbNumber
        ? `Issued · ${transportMode} · AWB ${awbNumber} — ${processRemark}`
        : `Issued · ${transportMode} — ${processRemark}`,
    };
  }

  if (type === 'REPAIR' || type === 'MAINTENANCE' || type === 'SERVICE') {
    const assigneeName = String(body.assigneeName || body.name || '').trim();
    const assigneeContact = String(
      body.assigneeContact || body.phone || body.contact || ''
    ).trim();
    if (!assigneeName) {
      throw new AppError('Assignee name is required', 400, 'VALIDATION_ERROR');
    }
    if (!assigneeContact) {
      throw new AppError('Phone is required', 400, 'VALIDATION_ERROR');
    }
    return {
      actionLabel: 'Assign',
      patch: {
        processAction: 'ASSIGN',
        assigneeName,
        assigneeContact,
        processRemark: remark,
      },
      logMessage: remark
        ? `Assigned ${assigneeName} · ${assigneeContact} — ${remark}`
        : `Assigned ${assigneeName} · ${assigneeContact}`,
    };
  }

  if (type === 'OTHER') {
    if (!remark) {
      throw new AppError('Completion remark is required', 400, 'VALIDATION_ERROR');
    }
    return {
      actionLabel: 'Complete',
      patch: {
        processAction: 'COMPLETE',
        processRemark: remark,
      },
      logMessage: `Completed — ${remark}`,
    };
  }

  throw new AppError('This request type cannot be processed here', 400, 'INVALID_TYPE');
}

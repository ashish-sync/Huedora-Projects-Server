import { AppError } from '../../utils/helpers.js';
import { CampOpsClientMaster } from '../campOps/campOps.model.js';
import { FinanceCommercialDocument } from './finance.model.js';

const BILLING_DOC_TYPES = ['client_invoice', 'bill_of_supply'];
const ADJUST_DOC_TYPES = ['credit_note', 'debit_note'];
const COMMITTED_STATUSES = ['Submitted', 'Approved', 'Issued'];

function trimStr(value) {
  return String(value == null ? '' : value).trim();
}

function roundMoney(value) {
  return Math.round((Number(value) || 0) * 100) / 100;
}

function normalizeKey(value) {
  return trimStr(value).toLowerCase();
}

function billingAmount(doc) {
  const subtotal = Number(doc.subtotal);
  if (Number.isFinite(subtotal) && subtotal > 0) return roundMoney(subtotal);
  return roundMoney(doc.grandTotal);
}

function matchesPo(doc, po) {
  const poId = trimStr(po?.id);
  const poNumber = normalizeKey(po?.poNumber);
  const docPoId = trimStr(doc.clientPurchaseOrderId);
  if (poId && docPoId && docPoId === poId) return true;
  if (poNumber && normalizeKey(doc.reference) === poNumber) return true;
  return false;
}

function ensurePurchaseOrders(master) {
  const plain = master?.toObject ? master.toObject() : { ...master };
  let orders = Array.isArray(plain.purchaseOrders) ? plain.purchaseOrders.filter(Boolean) : [];
  if (!orders.length && (plain.poNumber || plain.poNetValue || plain.poFile)) {
    orders = [
      {
        id: 'po-legacy-0',
        poNumber: trimStr(plain.poNumber),
        poNetValue: Number(plain.poNetValue) || 0,
        poApplyGst18: Boolean(plain.poApplyGst18),
        poGstAmount: Number(plain.poGstAmount) || 0,
        poGrossValue: Number(plain.poGrossValue) || Number(plain.poNetValue) || 0,
        poExpiryDate: trimStr(plain.poExpiryDate).slice(0, 10),
      },
    ];
  }
  return orders.map((row, index) => ({
    id: trimStr(row.id) || `po-${index + 1}`,
    poNumber: trimStr(row.poNumber),
    poNetValue: roundMoney(row.poNetValue),
    poApplyGst18: Boolean(row.poApplyGst18),
    poGstAmount: roundMoney(row.poGstAmount),
    poGrossValue: roundMoney(row.poGrossValue || row.poNetValue),
    poExpiryDate: trimStr(row.poExpiryDate).slice(0, 10),
  }));
}

/**
 * Compute billed / remaining / utilization for Client Master POs
 * against Tax Invoices + Bills of Supply (credit/debit notes adjust).
 */
export async function computeClientMasterPoUtilization({
  clientMasterId,
  poId = null,
  excludeDocId = null,
} = {}) {
  const masterId = trimStr(clientMasterId);
  if (!masterId) {
    throw new AppError('Client Master is required for PO utilization', 400, 'VALIDATION_ERROR');
  }

  const master = await CampOpsClientMaster.findOne({ _id: masterId, isDeleted: false });
  if (!master) throw new AppError('Client Master not found', 404, 'NOT_FOUND');

  const purchaseOrders = ensurePurchaseOrders(master);
  const docs = await FinanceCommercialDocument.find({
    isDeleted: false,
    clientMasterId: masterId,
    status: { $in: COMMITTED_STATUSES },
    documentType: { $in: [...BILLING_DOC_TYPES, ...ADJUST_DOC_TYPES] },
  });

  const list = Array.isArray(docs) ? docs : [];
  const utilization = purchaseOrders.map((po) => {
    let billed = 0;
    const relatedDocs = [];
    for (const doc of list) {
      const id = String(doc._id || '');
      if (excludeDocId && id === String(excludeDocId)) continue;
      if (!matchesPo(doc, po)) continue;
      const amount = billingAmount(doc);
      const type = doc.documentType;
      let signed = 0;
      if (BILLING_DOC_TYPES.includes(type) || type === 'debit_note') signed = amount;
      else if (type === 'credit_note') signed = -amount;
      billed += signed;
      relatedDocs.push({
        id,
        documentType: type,
        documentNumber: doc.documentNumber || '',
        status: doc.status,
        amount: signed,
      });
    }
    billed = roundMoney(Math.max(0, billed));
    const totalValue = roundMoney(
      Number(po.poGrossValue) > 0 ? po.poGrossValue : po.poNetValue
    );
    const remaining = roundMoney(Math.max(0, totalValue - billed));
    const utilizationPct =
      totalValue > 0 ? Math.round((billed / totalValue) * 10000) / 100 : billed > 0 ? 100 : 0;
    return {
      ...po,
      totalValue,
      billedAmount: billed,
      remainingBalance: remaining,
      utilizationPct,
      relatedDocs,
    };
  });

  const selected = poId
    ? utilization.find((row) => String(row.id) === String(poId)) || null
    : null;

  return {
    clientMasterId: masterId,
    clientName: master.clientName || '',
    programName: master.programName || '',
    campTerms: master.campTerms || '',
    purchaseOrders: utilization,
    selected,
  };
}

/**
 * Block Tax Invoice / Bill of Supply when amount exceeds remaining PO balance.
 */
export async function assertCommercialDocWithinPoBalance(payload, { excludeDocId = null } = {}) {
  const type = payload?.documentType;
  if (!BILLING_DOC_TYPES.includes(type)) return null;

  const clientMasterId = trimStr(payload.clientMasterId);
  const poId = trimStr(payload.clientPurchaseOrderId);
  const poNumber = trimStr(payload.reference);
  if (!clientMasterId || (!poId && !poNumber)) return null;

  const data = await computeClientMasterPoUtilization({
    clientMasterId,
    excludeDocId,
  });

  const po =
    (poId && data.purchaseOrders.find((row) => String(row.id) === poId))
    || (poNumber
      && data.purchaseOrders.find((row) => normalizeKey(row.poNumber) === normalizeKey(poNumber)))
    || null;

  if (!po) {
    // Free-text PO not on Client Master — do not block.
    return null;
  }

  const thisAmount = billingAmount(payload);
  if (thisAmount <= 0) return po;

  if (thisAmount > po.remainingBalance + 0.009) {
    throw new AppError(
      `Invoice amount ₹${thisAmount.toLocaleString('en-IN')} exceeds remaining PO balance ₹${po.remainingBalance.toLocaleString('en-IN')} for ${po.poNumber || 'selected PO'} (PO value ₹${po.totalValue.toLocaleString('en-IN')}, already billed ₹${po.billedAmount.toLocaleString('en-IN')}).`,
      400,
      'PO_BALANCE_EXCEEDED'
    );
  }

  return po;
}

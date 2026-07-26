import {
  computeLifecycleDerived,
  FINANCE_PAYMENT_STATUSES,
  PAYMENT_SUBMIT_STATUSES,
} from './campOps.lifecycle.js';
import { AppError } from '../../utils/helpers.js';

const PAYMENT_SUBMIT_LABELS = {
  payment_confirmed: 'Payment Confirmed',
  payment_not_checked: 'Payment Not Checked',
  payment_hold: 'Payment Hold',
};

const FINANCE_PAYMENT_LABELS = {
  not_paid: 'Not Paid',
  under_review: 'Under Review',
  paid: 'Paid',
};

export const CAMP_FINANCE_EXPORT_COLUMNS = [
  { key: 'campId', label: 'Camp ID' },
  { key: 'clientName', label: 'Client Name' },
  { key: 'campaignType', label: 'Division / Therapy' },
  { key: 'campaignName', label: 'Method' },
  { key: 'campDate', label: 'Camp Date' },
  { key: 'city', label: 'City' },
  { key: 'state', label: 'State' },
  { key: 'doctorName', label: 'Doctor Name' },
  { key: 'hcwName', label: 'HCW Name' },
  { key: 'hcwContact', label: 'HCW Contact' },
  { key: 'hcwCategory', label: 'HCW Category' },
  { key: 'inTime', label: 'In Time' },
  { key: 'outTime', label: 'Out Time' },
  { key: 'patientsCount', label: 'Patients Count' },
  { key: 'rxCount', label: 'Rx Count' },
  { key: 'campRevenue', label: 'Camp Revenue' },
  { key: 'overtimeRevenue', label: 'Overtime Revenue' },
  { key: 'otherRevenue', label: 'Other Revenue' },
  { key: 'totalRevenue', label: 'Total Revenue' },
  { key: 'campAmount', label: 'Camp Amount' },
  { key: 'travelling', label: 'Travelling' },
  { key: 'overtimeExpense', label: 'Overtime Expense' },
  { key: 'otherExpenses', label: 'Other Expenses' },
  { key: 'totalPayout', label: 'Total Payout' },
  { key: 'paymentSubmitStatus', label: 'Payment Check' },
  { key: 'financePaymentStatus', label: 'Finance Status' },
  { key: 'paidAmount', label: 'Paid Amount' },
  { key: 'transactionId', label: 'Transaction ID / UTR' },
  { key: 'balance', label: 'Balance' },
  { key: 'paymentRemark', label: 'Payment Remark' },
  { key: 'submittedToFinanceAt', label: 'Submitted to Finance At' },
  { key: 'submittedToFinanceByEmail', label: 'Submitted By' },
  { key: 'financeProcessedAt', label: 'Finance Processed At' },
  { key: 'financeProcessedByEmail', label: 'Finance Processed By' },
  { key: 'status', label: 'Camp Status' },
];

function formatExportDate(value) {
  if (!value) return '';
  const text = String(value).trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(text)) {
    const [year, month, day] = text.slice(0, 10).split('-');
    return `${day}/${month}/${year}`;
  }
  const date = new Date(text);
  if (Number.isNaN(date.getTime())) return text;
  return date.toLocaleString('en-IN', { hour12: false });
}

function paymentSubmitLabel(value) {
  return PAYMENT_SUBMIT_LABELS[value] || value || '';
}

function financePaymentLabel(value) {
  return FINANCE_PAYMENT_LABELS[value] || value || '';
}

export function buildCampFinanceExportRow(camp = {}) {
  const row = camp?.toObject ? camp.toObject() : { ...camp };
  const derived = computeLifecycleDerived(row);
  const values = {
    ...row,
    ...derived,
    patientsCount: row.patientsCount ?? row.actualPatients ?? 0,
    paymentSubmitStatus: paymentSubmitLabel(row.paymentSubmitStatus),
    financePaymentStatus: financePaymentLabel(row.financePaymentStatus),
    submittedToFinanceAt: formatExportDate(row.submittedToFinanceAt),
    financeProcessedAt: formatExportDate(row.financeProcessedAt),
    campDate: formatExportDate(row.campDate),
    status: String(row.status || '').replaceAll('_', ' '),
  };

  return CAMP_FINANCE_EXPORT_COLUMNS.map((column) => values[column.key] ?? '');
}

export function campFinanceExportHeaders() {
  return CAMP_FINANCE_EXPORT_COLUMNS.map((column) => column.label);
}

export function campFinanceExportRows(camps = []) {
  return camps.map((camp) => buildCampFinanceExportRow(camp));
}

export function campFinanceExportFilename(camp) {
  const campId = String(camp?.campId || camp?._id || 'camp').replace(/[^\w.-]+/g, '_');
  return `Camp_Finance_${campId}.xlsx`;
}

export function campFinanceBulkExportFilename() {
  const stamp = new Date().toISOString().slice(0, 10);
  return `Camp_Finance_Payouts_${stamp}.xlsx`;
}

export function assertCampSubmittedToFinance(camp) {
  if (!camp?.submittedToFinanceAt) {
    throw new AppError('This camp has not been submitted to Finance One yet', 400, 'VALIDATION_ERROR');
  }
}

export { PAYMENT_SUBMIT_STATUSES, FINANCE_PAYMENT_STATUSES };

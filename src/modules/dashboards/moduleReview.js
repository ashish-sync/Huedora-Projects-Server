import { hasPermission } from '../../middleware/auth.js';
import { AppError } from '../../utils/helpers.js';
import { PERMISSIONS } from '../../config/constants.js';
import { Asset } from '../assets/asset.model.js';
import { Agreement } from '../agreements/agreement.model.js';
import { Contact } from '../contacts/contact.model.js';
import { VerificationRecord } from '../verifications/verification.model.js';
import { CampRequest } from '../camps/camp.model.js';
import { AssetRequest, REQUEST_TYPE_LABELS } from '../assetRequests/assetRequest.model.js';
import { LogisticsInOutEntry } from '../logistics/logistics.model.js';
import { FinanceExpense, FinanceInvoice } from '../finance/finance.model.js';
import { Movement } from '../movements/movement.model.js';
import { ImportJob } from '../imports/importJob.model.js';
import { Notification } from '../notifications/notification.model.js';
import { AuditLog } from '../audit/audit.model.js';
import { User } from '../users/user.model.js';

export const REVIEW_MODULES = [
  {
    id: 'assets',
    label: 'Asset One',
    linkTo: '/asset-inventory',
    permissions: [PERMISSIONS.ASSETS_READ, PERMISSIONS.ASSETS_WRITE, PERMISSIONS.DEVICES_WRITE],
  },
  {
    id: 'agreements',
    label: 'Document One',
    linkTo: '/agreements',
    permissions: [PERMISSIONS.AGREEMENTS_READ, PERMISSIONS.AGREEMENTS_WRITE],
  },
  {
    id: 'contacts',
    label: 'Business Partners',
    linkTo: '/master-data?scope=document&entity=contacts',
    permissions: [PERMISSIONS.AGREEMENTS_READ, PERMISSIONS.AGREEMENTS_WRITE],
  },
  {
    id: 'verifications',
    label: 'Verification One',
    linkTo: '/verifications',
    permissions: [PERMISSIONS.VERIFICATIONS_READ, PERMISSIONS.VERIFICATIONS_WRITE],
  },
  {
    id: 'camps',
    label: 'Camp One',
    linkTo: '/camps',
    permissions: [PERMISSIONS.CAMPS_READ, PERMISSIONS.CAMPS_REQUEST, PERMISSIONS.CAMPS_APPROVE],
  },
  {
    id: 'asset-requests',
    label: 'Request One',
    linkTo: '/asset-requests',
    permissions: [
      PERMISSIONS.ASSET_REQUESTS_READ,
      PERMISSIONS.ASSET_REQUESTS_REQUEST,
      PERMISSIONS.ASSET_REQUESTS_APPROVE,
    ],
  },
  {
    id: 'logistics',
    label: 'Movement One',
    linkTo: '/logistics',
    permissions: [PERMISSIONS.LOGISTICS_READ, PERMISSIONS.LOGISTICS_WRITE, PERMISSIONS.LOGISTICS_MASTER],
  },
  {
    id: 'finance',
    label: 'Finance One',
    linkTo: '/finance',
    permissions: [PERMISSIONS.FINANCE_READ, PERMISSIONS.FINANCE_WRITE],
  },
  {
    id: 'master-data',
    label: 'Master One',
    linkTo: '/master-data',
    permissions: [PERMISSIONS.LOGISTICS_MASTER, PERMISSIONS.LOGISTICS_WRITE, PERMISSIONS.AGREEMENTS_WRITE],
  },
  {
    id: 'movements',
    label: 'Goods Issue Requests',
    linkTo: '/asset-requests',
    permissions: [PERMISSIONS.MOVEMENTS_READ, PERMISSIONS.MOVEMENTS_REQUEST, PERMISSIONS.MOVEMENTS_APPROVE],
  },
  {
    id: 'imports',
    label: 'Imports',
    linkTo: '/imports',
    permissions: [PERMISSIONS.IMPORTS_EXECUTE],
  },
  {
    id: 'notifications',
    label: 'Notifications',
    linkTo: '/notifications',
    permissions: [PERMISSIONS.NOTIFICATIONS_READ],
  },
  {
    id: 'audit',
    label: 'Audit',
    linkTo: '/audit',
    permissions: [PERMISSIONS.AUDIT_READ],
  },
  {
    id: 'users',
    label: 'Users',
    linkTo: '/role-permission-master',
    permissions: [PERMISSIONS.USERS_READ, PERMISSIONS.USERS_WRITE],
  },
];

export function parseDayBound(raw, endOfDay = false) {
  if (!raw || !/^\d{4}-\d{2}-\d{2}$/.test(String(raw).trim())) return null;
  const [y, m, d] = String(raw).trim().split('-').map(Number);
  if (endOfDay) return new Date(y, m - 1, d, 23, 59, 59, 999);
  return new Date(y, m - 1, d, 0, 0, 0, 0);
}

export function parseReviewRange(query = {}) {
  const fromRaw = query.from ? String(query.from).trim() : '';
  const toRaw = query.to ? String(query.to).trim() : '';
  const fromDate = parseDayBound(fromRaw, false);
  const toDate = parseDayBound(toRaw, true);
  if ((fromRaw && !fromDate) || (toRaw && !toDate)) {
    throw new AppError('from and to must be YYYY-MM-DD', 400, 'VALIDATION_ERROR');
  }
  if (fromDate && toDate && fromDate.getTime() > toDate.getTime()) {
    throw new AppError('from must be on or before to', 400, 'VALIDATION_ERROR');
  }
  return { fromRaw, toRaw, fromDate, toDate };
}

function canAccessModule(req, _mod) {
  // Dashboard read is the reporting gate: any module can be reviewed from the dashboard.
  return (
    hasPermission(req, PERMISSIONS.ALL) || hasPermission(req, PERMISSIONS.DASHBOARDS_READ)
  );
}

export function listReviewModulesForUser(req) {
  return REVIEW_MODULES.filter((m) => canAccessModule(req, m)).map((m) => ({
    id: m.id,
    label: m.label,
    linkTo: m.linkTo,
  }));
}

function getDateValue(row, fields) {
  for (const field of fields) {
    const v = row?.[field];
    if (v) return v;
  }
  return null;
}

function inRange(iso, fromDate, toDate) {
  if (!fromDate && !toDate) return true;
  if (!iso) return false;
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return false;
  if (fromDate && t < fromDate.getTime()) return false;
  if (toDate && t > toDate.getTime()) return false;
  return true;
}

function countBy(rows, field) {
  const out = {};
  for (const row of rows) {
    const key = String(row?.[field] ?? 'Unknown') || 'Unknown';
    out[key] = (out[key] || 0) + 1;
  }
  return out;
}

function fmtDate(iso) {
  if (!iso) return '-';
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return String(iso);
  return d.toLocaleString();
}

function activeOnly(rows) {
  return (rows || []).filter((r) => !r.isDeleted);
}

async function loadModuleRows(moduleId, req, fromDate, toDate) {
  const limit = Math.min(Number(req.query.limit) || 200, 500);

  switch (moduleId) {
    case 'assets': {
      const all = activeOnly(await Asset.find({ isDeleted: false }).limit(20000));
      const filtered = all.filter((r) =>
        inRange(getDateValue(r, ['createdAt', 'purchaseDate', 'addedMonth']), fromDate, toDate)
      );
      return {
        dateFieldLabel: 'Created / onboarded',
        summary: {
          total: filtered.length,
          byStatus: countBy(filtered, 'status'),
          byAgreementStatus: countBy(filtered, 'agreementStatus'),
        },
        columns: [
          { key: 'name', label: 'Asset' },
          { key: 'serialNumber', label: 'Serial' },
          { key: 'status', label: 'Status' },
          { key: 'agreementStatus', label: 'Agreement status' },
          { key: 'custody', label: 'Custody' },
          { key: 'when', label: 'Date' },
        ],
        rows: filtered.slice(0, limit).map((r) => ({
          id: r._id,
          name: r.deviceNameSnapshot || r.name || '-',
          serialNumber: r.serialNumber || '-',
          status: r.status || '-',
          agreementStatus: r.agreementStatus || '-',
          custody: r.custody || '-',
          when: fmtDate(getDateValue(r, ['createdAt', 'purchaseDate'])),
        })),
        total: filtered.length,
      };
    }
    case 'agreements': {
      const all = activeOnly(await Agreement.find({ isDeleted: false }).limit(20000));
      const filtered = all.filter((r) => inRange(getDateValue(r, ['createdAt', 'sentAt']), fromDate, toDate));
      return {
        dateFieldLabel: 'Created / sent',
        summary: { total: filtered.length, byStatus: countBy(filtered, 'status') },
        columns: [
          { key: 'agreementNumber', label: 'Agreement #' },
          { key: 'title', label: 'Title' },
          { key: 'partyName', label: 'Party' },
          { key: 'status', label: 'Status' },
          { key: 'when', label: 'Date' },
        ],
        rows: filtered.slice(0, limit).map((r) => ({
          id: r._id,
          agreementNumber: r.agreementNumber || '-',
          title: r.title || '-',
          partyName: r.partyName || '-',
          status: r.status || '-',
          when: fmtDate(getDateValue(r, ['createdAt', 'sentAt'])),
        })),
        total: filtered.length,
      };
    }
    case 'contacts': {
      const all = activeOnly(await Contact.find({ isDeleted: false }).limit(20000));
      const filtered = all.filter((r) => inRange(r.createdAt, fromDate, toDate));
      return {
        dateFieldLabel: 'Created',
        summary: {
          total: filtered.length,
          byResourceType: countBy(filtered, 'resourceType'),
        },
        columns: [
          { key: 'name', label: 'Name' },
          { key: 'email', label: 'Email' },
          { key: 'contact', label: 'Contact' },
          { key: 'city', label: 'City' },
          { key: 'state', label: 'State' },
          { key: 'when', label: 'Date' },
        ],
        rows: filtered.slice(0, limit).map((r) => ({
          id: r._id,
          name: r.name || '-',
          email: r.email || '-',
          contact: r.contact || r.mobile || '-',
          city: r.city || '-',
          state: r.state || '-',
          when: fmtDate(r.createdAt),
        })),
        total: filtered.length,
      };
    }
    case 'verifications': {
      const all = activeOnly(await VerificationRecord.find({ isDeleted: false }).limit(20000));
      const filtered = all.filter((r) =>
        inRange(getDateValue(r, ['updatedAt', 'createdAt']), fromDate, toDate)
      );
      return {
        dateFieldLabel: 'Updated / created',
        summary: { total: filtered.length, byStatus: countBy(filtered, 'status') },
        columns: [
          { key: 'periodKey', label: 'Period' },
          { key: 'serialNumber', label: 'Serial' },
          { key: 'brandModelTest', label: 'Asset' },
          { key: 'status', label: 'Status' },
          { key: 'when', label: 'Date' },
        ],
        rows: filtered.slice(0, limit).map((r) => ({
          id: r._id,
          periodKey: r.periodKey || '-',
          serialNumber: r.serialNumber || '-',
          brandModelTest: r.brandModelTest || '-',
          status: r.status || '-',
          when: fmtDate(getDateValue(r, ['updatedAt', 'createdAt'])),
        })),
        total: filtered.length,
      };
    }
    case 'camps': {
      const all = activeOnly(await CampRequest.find({ isDeleted: false }).limit(20000));
      const filtered = all.filter((r) =>
        inRange(getDateValue(r, ['requestedAt', 'campDate', 'createdAt']), fromDate, toDate)
      );
      return {
        dateFieldLabel: 'Requested / camp date',
        summary: { total: filtered.length, byStatus: countBy(filtered, 'status') },
        columns: [
          { key: 'campDate', label: 'Camp date' },
          { key: 'method', label: 'Method' },
          { key: 'process', label: 'Process' },
          { key: 'city', label: 'City' },
          { key: 'status', label: 'Status' },
          { key: 'when', label: 'Requested' },
        ],
        rows: filtered.slice(0, limit).map((r) => ({
          id: r._id,
          campDate: r.campDate || '-',
          method: r.method || '-',
          process: r.process || '-',
          city: r.city || '-',
          status: r.status || '-',
          when: fmtDate(getDateValue(r, ['requestedAt', 'createdAt'])),
        })),
        total: filtered.length,
      };
    }
    case 'asset-requests': {
      const all = activeOnly(await AssetRequest.find({ isDeleted: false }).limit(20000));
      const filtered = all.filter((r) => inRange(r.createdAt, fromDate, toDate));
      const byType = {};
      for (const r of filtered) {
        const label = REQUEST_TYPE_LABELS[r.requestType] || r.requestType || 'Unknown';
        byType[label] = (byType[label] || 0) + 1;
      }
      return {
        dateFieldLabel: 'Created',
        summary: {
          total: filtered.length,
          byStatus: countBy(filtered, 'status'),
          byType,
        },
        columns: [
          { key: 'requestNumber', label: 'Request #' },
          { key: 'requestType', label: 'Type' },
          { key: 'status', label: 'Status' },
          { key: 'assetName', label: 'Subject' },
          { key: 'reason', label: 'Reason' },
          { key: 'when', label: 'Date' },
        ],
        rows: filtered.slice(0, limit).map((r) => ({
          id: r._id,
          requestNumber: r.requestNumber || '-',
          requestType: REQUEST_TYPE_LABELS[r.requestType] || r.requestType || '-',
          status: r.status || '-',
          assetName: r.assetName || r.trainingTopic || r.hiringName || '-',
          reason: r.reason || '-',
          when: fmtDate(r.createdAt),
        })),
        total: filtered.length,
      };
    }
    case 'logistics': {
      const all = activeOnly(await LogisticsInOutEntry.find({ isDeleted: false }).limit(20000));
      const filtered = all.filter((r) =>
        inRange(
          getDateValue(r, ['transactionDateTime', 'transactionDate', 'createdAt']),
          fromDate,
          toDate
        )
      );
      return {
        dateFieldLabel: 'Transaction date',
        summary: {
          total: filtered.length,
          byStatus: countBy(filtered, 'status'),
          byEntryType: countBy(filtered, 'entryType'),
        },
        columns: [
          { key: 'uniqueKey', label: 'Txn ID' },
          { key: 'entryType', label: 'Entry type' },
          { key: 'productName', label: 'Product' },
          { key: 'status', label: 'Status' },
          { key: 'city', label: 'City' },
          { key: 'when', label: 'Date' },
        ],
        rows: filtered.slice(0, limit).map((r) => ({
          id: r._id,
          uniqueKey: r.uniqueKey || '-',
          entryType: r.entryType || '-',
          productName: r.productName || r.name || '-',
          status: r.status || '-',
          city: r.city || '-',
          when: fmtDate(getDateValue(r, ['transactionDateTime', 'transactionDate', 'createdAt'])),
        })),
        total: filtered.length,
      };
    }
    case 'finance': {
      const [expenses, invoices] = await Promise.all([
        activeOnly(await FinanceExpense.find({ isDeleted: false }).limit(20000)),
        activeOnly(await FinanceInvoice.find({ isDeleted: false }).limit(20000)),
      ]);
      const expenseFiltered = expenses.filter((r) =>
        inRange(getDateValue(r, ['expenseDate', 'createdAt']), fromDate, toDate)
      );
      const invoiceFiltered = invoices.filter((r) =>
        inRange(getDateValue(r, ['invoiceDate', 'createdAt']), fromDate, toDate)
      );
      const combined = [
        ...expenseFiltered.map((r) => ({
          id: r._id,
          kind: 'Expense',
          ref: r.expenseKey || '-',
          party: r.payeeName || r.title || '-',
          amount: r.amount,
          status: r.status || '-',
          when: fmtDate(getDateValue(r, ['expenseDate', 'createdAt'])),
        })),
        ...invoiceFiltered.map((r) => ({
          id: r._id,
          kind: 'Invoice',
          ref: r.invoiceNumber || r.invoiceKey || '-',
          party: r.vendorName || '-',
          amount: r.totalAmount,
          status: r.status || '-',
          when: fmtDate(getDateValue(r, ['invoiceDate', 'createdAt'])),
        })),
      ];
      return {
        dateFieldLabel: 'Expense / invoice date',
        summary: {
          total: combined.length,
          expenses: expenseFiltered.length,
          invoices: invoiceFiltered.length,
          byStatus: countBy(combined, 'status'),
        },
        columns: [
          { key: 'kind', label: 'Type' },
          { key: 'ref', label: 'Reference' },
          { key: 'party', label: 'Party' },
          { key: 'amount', label: 'Amount' },
          { key: 'status', label: 'Status' },
          { key: 'when', label: 'Date' },
        ],
        rows: combined.slice(0, limit),
        total: combined.length,
      };
    }
    case 'movements': {
      const all = activeOnly(await Movement.find({ isDeleted: false }).limit(20000));
      const filtered = all.filter((r) => inRange(r.createdAt, fromDate, toDate));
      return {
        dateFieldLabel: 'Created',
        summary: { total: filtered.length, byStatus: countBy(filtered, 'status') },
        columns: [
          { key: 'movementNumber', label: 'Number' },
          { key: 'status', label: 'Status' },
          { key: 'reason', label: 'Reason' },
          { key: 'when', label: 'Date' },
        ],
        rows: filtered.slice(0, limit).map((r) => ({
          id: r._id,
          movementNumber: r.movementNumber || '-',
          status: r.status || '-',
          reason: r.reason || '-',
          when: fmtDate(r.createdAt),
        })),
        total: filtered.length,
      };
    }
    case 'imports': {
      const all = await ImportJob.find({}).limit(5000);
      const filtered = all.filter((r) =>
        inRange(getDateValue(r, ['startedAt', 'createdAt']), fromDate, toDate)
      );
      return {
        dateFieldLabel: 'Started',
        summary: { total: filtered.length, byStatus: countBy(filtered, 'status') },
        columns: [
          { key: 'type', label: 'Type' },
          { key: 'status', label: 'Status' },
          { key: 'totalRows', label: 'Rows' },
          { key: 'successRows', label: 'Success' },
          { key: 'errorRows', label: 'Errors' },
          { key: 'when', label: 'Date' },
        ],
        rows: filtered.slice(0, limit).map((r) => ({
          id: r._id,
          type: r.type || r.importType || '-',
          status: r.status || '-',
          totalRows: r.totalRows ?? 0,
          successRows: r.successRows ?? 0,
          errorRows: r.errorRows ?? 0,
          when: fmtDate(getDateValue(r, ['startedAt', 'createdAt'])),
        })),
        total: filtered.length,
      };
    }
    case 'notifications': {
      const filter = { cancelledAt: null };
      if (!hasPermission(req, PERMISSIONS.ALL) && !hasPermission(req, PERMISSIONS.AUDIT_READ)) {
        filter.userId = req.user._id;
      }
      const all = await Notification.find(filter).limit(5000);
      const filtered = all.filter((r) => inRange(r.createdAt, fromDate, toDate));
      const unread = filtered.filter((r) => !r.readAt).length;
      return {
        dateFieldLabel: 'Created',
        summary: {
          total: filtered.length,
          byType: countBy(filtered, 'type'),
          unread,
          read: filtered.length - unread,
        },
        columns: [
          { key: 'title', label: 'Title' },
          { key: 'type', label: 'Type' },
          { key: 'read', label: 'Read' },
          { key: 'when', label: 'Date' },
        ],
        rows: filtered.slice(0, limit).map((r) => ({
          id: r._id,
          title: r.title || '-',
          type: r.type || '-',
          read: r.readAt ? 'Yes' : 'No',
          when: fmtDate(r.createdAt),
        })),
        total: filtered.length,
      };
    }
    case 'audit': {
      const all = await AuditLog.find({}).limit(20000);
      const filtered = all.filter((r) => inRange(getDateValue(r, ['at', 'createdAt']), fromDate, toDate));
      return {
        dateFieldLabel: 'At',
        summary: {
          total: filtered.length,
          byAction: countBy(filtered, 'action'),
          byResult: countBy(filtered, 'result'),
        },
        columns: [
          { key: 'action', label: 'Action' },
          { key: 'entityType', label: 'Entity' },
          { key: 'actorEmail', label: 'Actor' },
          { key: 'result', label: 'Result' },
          { key: 'when', label: 'Date' },
        ],
        rows: filtered.slice(0, limit).map((r) => ({
          id: r._id,
          action: r.action || '-',
          entityType: r.entityType || '-',
          actorEmail: r.actorEmail || '-',
          result: r.result || '-',
          when: fmtDate(getDateValue(r, ['at', 'createdAt'])),
        })),
        total: filtered.length,
      };
    }
    case 'users': {
      const all = activeOnly(await User.find({ isDeleted: false }).limit(5000));
      const filtered = all.filter((r) => inRange(r.createdAt, fromDate, toDate));
      return {
        dateFieldLabel: 'Created',
        summary: {
          total: filtered.length,
          active: filtered.filter((r) => r.isActive !== false).length,
          inactive: filtered.filter((r) => r.isActive === false).length,
        },
        columns: [
          { key: 'fullName', label: 'Name' },
          { key: 'email', label: 'Email' },
          { key: 'username', label: 'Username' },
          { key: 'active', label: 'Active' },
          { key: 'when', label: 'Date' },
        ],
        rows: filtered.slice(0, limit).map((r) => ({
          id: r._id,
          fullName: r.fullName || '-',
          email: r.email || '-',
          username: r.username || '-',
          active: r.isActive === false ? 'No' : 'Yes',
          when: fmtDate(r.createdAt),
        })),
        total: filtered.length,
      };
    }
    default:
      throw new AppError('Unknown module', 400, 'VALIDATION_ERROR');
  }
}

export async function runModuleReview(req) {
  const moduleId = String(req.query.module || '').trim();
  if (!moduleId) throw new AppError('module is required', 400, 'VALIDATION_ERROR');

  const mod = REVIEW_MODULES.find((m) => m.id === moduleId);
  if (!mod) throw new AppError('Unknown module', 400, 'VALIDATION_ERROR');
  if (!canAccessModule(req, mod)) {
    throw new AppError('You do not have access to review this module', 403, 'FORBIDDEN');
  }

  const { fromRaw, toRaw, fromDate, toDate } = parseReviewRange(req.query);
  const result = await loadModuleRows(moduleId, req, fromDate, toDate);

  return {
    module: moduleId,
    moduleLabel: mod.label,
    linkTo: mod.linkTo,
    from: fromRaw || null,
    to: toRaw || null,
    dateFieldLabel: result.dateFieldLabel,
    summary: result.summary,
    columns: result.columns,
    rows: result.rows,
    total: result.total,
    truncated: result.total > result.rows.length,
  };
}

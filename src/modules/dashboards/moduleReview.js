import { hasPermission } from '../../middleware/auth.js';
import { AppError } from '../../utils/helpers.js';
import { PERMISSIONS } from '../../config/constants.js';
import { Asset } from '../assets/asset.model.js';
import { Agreement } from '../agreements/agreement.model.js';
import { Contact } from '../contacts/contact.model.js';
import { VerificationRecord } from '../verifications/verification.model.js';
import { CampOpsCamp } from '../campOps/campOps.model.js';
import { AssetRequest, REQUEST_TYPE_LABELS } from '../assetRequests/assetRequest.model.js';
import { LogisticsInOutEntry } from '../logistics/logistics.model.js';
import { FinanceExpense, FinanceInvoice } from '../finance/finance.model.js';
import { Movement } from '../movements/movement.model.js';
import { ImportJob } from '../imports/importJob.model.js';
import { Notification } from '../notifications/notification.model.js';
import { AuditLog } from '../audit/audit.model.js';
import { User } from '../users/user.model.js';
import {
  reviewLimit,
  reviewFacetPipeline,
  facetTotal,
  facetCounts,
  fmtReviewDate,
  reviewDateExpression,
  dateRangeMatch,
} from './moduleReview.aggregations.js';

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
    label: 'Contact Directory',
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
    label: 'Goods Issuance Requests',
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

async function runFacet(Model, opts) {
  const pipeline = reviewFacetPipeline(opts);
  const out = await Model.aggregate(pipeline);
  return Array.isArray(out) && out[0] ? out[0] : { total: [], rows: [], byField: [] };
}

async function loadModuleRows(moduleId, req, fromDate, toDate) {
  const limit = reviewLimit(req.query);

  switch (moduleId) {
    case 'assets': {
      const bucket = await runFacet(Asset, {
        baseMatch: { isDeleted: false },
        dateFields: ['createdAt', 'purchaseDate'],
        fromDate,
        toDate,
        limit,
        groupField: 'agreementStatus',
        rowProject: {
          _id: 1,
          deviceNameSnapshot: 1,
          name: 1,
          serialNumber: 1,
          status: 1,
          agreementStatus: 1,
          custody: 1,
          _reviewDate: 1,
        },
      });
      const byAgreement = facetCounts(bucket);
      const statusBucket = await runFacet(Asset, {
        baseMatch: { isDeleted: false },
        dateFields: ['createdAt', 'purchaseDate'],
        fromDate,
        toDate,
        limit: 1,
        groupField: 'status',
        rowProject: { _id: 1 },
      });
      return {
        dateFieldLabel: 'Created / onboarded',
        summary: {
          total: facetTotal(bucket),
          byStatus: facetCounts(statusBucket),
          byAgreementStatus: byAgreement,
        },
        columns: [
          { key: 'name', label: 'Asset' },
          { key: 'serialNumber', label: 'Serial' },
          { key: 'status', label: 'Status' },
          { key: 'agreementStatus', label: 'Agreement status' },
          { key: 'custody', label: 'Custody' },
          { key: 'when', label: 'Date' },
        ],
        rows: (bucket.rows || []).map((r) => ({
          id: r._id,
          name: r.deviceNameSnapshot || r.name || '-',
          serialNumber: r.serialNumber || '-',
          status: r.status || '-',
          agreementStatus: r.agreementStatus || '-',
          custody: r.custody || '-',
          when: fmtReviewDate(r._reviewDate),
        })),
        total: facetTotal(bucket),
      };
    }
    case 'agreements': {
      const bucket = await runFacet(Agreement, {
        baseMatch: { isDeleted: false },
        dateFields: ['createdAt', 'sentAt'],
        fromDate,
        toDate,
        limit,
        groupField: 'status',
        rowProject: {
          _id: 1,
          agreementNumber: 1,
          title: 1,
          partyName: 1,
          status: 1,
          _reviewDate: 1,
        },
      });
      return {
        dateFieldLabel: 'Created / sent',
        summary: { total: facetTotal(bucket), byStatus: facetCounts(bucket) },
        columns: [
          { key: 'agreementNumber', label: 'Agreement #' },
          { key: 'title', label: 'Title' },
          { key: 'partyName', label: 'Party' },
          { key: 'status', label: 'Status' },
          { key: 'when', label: 'Date' },
        ],
        rows: (bucket.rows || []).map((r) => ({
          id: r._id,
          agreementNumber: r.agreementNumber || '-',
          title: r.title || '-',
          partyName: r.partyName || '-',
          status: r.status || '-',
          when: fmtReviewDate(r._reviewDate),
        })),
        total: facetTotal(bucket),
      };
    }
    case 'contacts': {
      const bucket = await runFacet(Contact, {
        baseMatch: { isDeleted: false },
        dateFields: ['createdAt'],
        fromDate,
        toDate,
        limit,
        groupField: 'resourceType',
        rowProject: {
          _id: 1,
          name: 1,
          email: 1,
          contact: 1,
          mobile: 1,
          city: 1,
          state: 1,
          _reviewDate: 1,
        },
      });
      return {
        dateFieldLabel: 'Created',
        summary: {
          total: facetTotal(bucket),
          byResourceType: facetCounts(bucket),
        },
        columns: [
          { key: 'name', label: 'Name' },
          { key: 'email', label: 'Email' },
          { key: 'contact', label: 'Contact' },
          { key: 'city', label: 'City' },
          { key: 'state', label: 'State' },
          { key: 'when', label: 'Date' },
        ],
        rows: (bucket.rows || []).map((r) => ({
          id: r._id,
          name: r.name || '-',
          email: r.email || '-',
          contact: r.contact || r.mobile || '-',
          city: r.city || '-',
          state: r.state || '-',
          when: fmtReviewDate(r._reviewDate),
        })),
        total: facetTotal(bucket),
      };
    }
    case 'verifications': {
      const bucket = await runFacet(VerificationRecord, {
        baseMatch: { isDeleted: false },
        dateFields: ['updatedAt', 'createdAt'],
        fromDate,
        toDate,
        limit,
        groupField: 'status',
        rowProject: {
          _id: 1,
          periodKey: 1,
          serialNumber: 1,
          brandModelTest: 1,
          status: 1,
          _reviewDate: 1,
        },
      });
      return {
        dateFieldLabel: 'Updated / created',
        summary: { total: facetTotal(bucket), byStatus: facetCounts(bucket) },
        columns: [
          { key: 'periodKey', label: 'Period' },
          { key: 'serialNumber', label: 'Serial' },
          { key: 'brandModelTest', label: 'Asset' },
          { key: 'status', label: 'Status' },
          { key: 'when', label: 'Date' },
        ],
        rows: (bucket.rows || []).map((r) => ({
          id: r._id,
          periodKey: r.periodKey || '-',
          serialNumber: r.serialNumber || '-',
          brandModelTest: r.brandModelTest || '-',
          status: r.status || '-',
          when: fmtReviewDate(r._reviewDate),
        })),
        total: facetTotal(bucket),
      };
    }
    case 'camps': {
      const bucket = await runFacet(CampOpsCamp, {
        baseMatch: { isDeleted: false },
        dateFields: ['submittedAt', 'campDate', 'createdAt'],
        fromDate,
        toDate,
        limit,
        groupField: 'status',
        rowProject: {
          _id: 1,
          campId: 1,
          clientName: 1,
          campaignName: 1,
          campDate: 1,
          city: 1,
          status: 1,
          _reviewDate: 1,
        },
      });
      return {
        dateFieldLabel: 'Submitted / camp date',
        summary: { total: facetTotal(bucket), byStatus: facetCounts(bucket) },
        columns: [
          { key: 'campId', label: 'Camp ID' },
          { key: 'clientName', label: 'Client' },
          { key: 'campaignName', label: 'Method' },
          { key: 'campDate', label: 'Camp date' },
          { key: 'city', label: 'City' },
          { key: 'status', label: 'Status' },
          { key: 'when', label: 'Submitted' },
        ],
        rows: (bucket.rows || []).map((r) => ({
          id: r._id,
          campId: r.campId || '-',
          clientName: r.clientName || '-',
          campaignName: r.campaignName || '-',
          campDate: r.campDate || '-',
          city: r.city || '-',
          status: r.status || '-',
          when: fmtReviewDate(r._reviewDate),
        })),
        total: facetTotal(bucket),
      };
    }
    case 'asset-requests': {
      const bucket = await runFacet(AssetRequest, {
        baseMatch: { isDeleted: false },
        dateFields: ['createdAt'],
        fromDate,
        toDate,
        limit,
        groupField: 'status',
        rowProject: {
          _id: 1,
          requestNumber: 1,
          requestType: 1,
          status: 1,
          assetName: 1,
          trainingTopic: 1,
          hiringName: 1,
          reason: 1,
          _reviewDate: 1,
        },
      });
      const typeBucket = await runFacet(AssetRequest, {
        baseMatch: { isDeleted: false },
        dateFields: ['createdAt'],
        fromDate,
        toDate,
        limit: 1,
        groupField: 'requestType',
        rowProject: { _id: 1 },
      });
      const byType = {};
      for (const [k, v] of Object.entries(facetCounts(typeBucket))) {
        byType[REQUEST_TYPE_LABELS[k] || k || 'Unknown'] = v;
      }
      return {
        dateFieldLabel: 'Created',
        summary: {
          total: facetTotal(bucket),
          byStatus: facetCounts(bucket),
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
        rows: (bucket.rows || []).map((r) => ({
          id: r._id,
          requestNumber: r.requestNumber || '-',
          requestType: REQUEST_TYPE_LABELS[r.requestType] || r.requestType || '-',
          status: r.status || '-',
          assetName: r.assetName || r.trainingTopic || r.hiringName || '-',
          reason: r.reason || '-',
          when: fmtReviewDate(r._reviewDate),
        })),
        total: facetTotal(bucket),
      };
    }
    case 'logistics': {
      const bucket = await runFacet(LogisticsInOutEntry, {
        baseMatch: { isDeleted: false },
        dateFields: ['transactionDateTime', 'transactionDate', 'createdAt'],
        fromDate,
        toDate,
        limit,
        groupField: 'status',
        rowProject: {
          _id: 1,
          uniqueKey: 1,
          entryType: 1,
          productName: 1,
          name: 1,
          status: 1,
          city: 1,
          _reviewDate: 1,
        },
      });
      const entryBucket = await runFacet(LogisticsInOutEntry, {
        baseMatch: { isDeleted: false },
        dateFields: ['transactionDateTime', 'transactionDate', 'createdAt'],
        fromDate,
        toDate,
        limit: 1,
        groupField: 'entryType',
        rowProject: { _id: 1 },
      });
      return {
        dateFieldLabel: 'Transaction date',
        summary: {
          total: facetTotal(bucket),
          byStatus: facetCounts(bucket),
          byEntryType: facetCounts(entryBucket),
        },
        columns: [
          { key: 'uniqueKey', label: 'Txn ID' },
          { key: 'entryType', label: 'Entry type' },
          { key: 'productName', label: 'Product' },
          { key: 'status', label: 'Status' },
          { key: 'city', label: 'City' },
          { key: 'when', label: 'Date' },
        ],
        rows: (bucket.rows || []).map((r) => ({
          id: r._id,
          uniqueKey: r.uniqueKey || '-',
          entryType: r.entryType || '-',
          productName: r.productName || r.name || '-',
          status: r.status || '-',
          city: r.city || '-',
          when: fmtReviewDate(r._reviewDate),
        })),
        total: facetTotal(bucket),
      };
    }
    case 'finance': {
      // Two lean aggregations — never hydrate 2k+2k docs into Node.
      const expensePipe = [
        { $match: { isDeleted: false } },
        { $addFields: { _reviewDate: reviewDateExpression(['expenseDate', 'createdAt']) } },
        ...(dateRangeMatch(fromDate, toDate) ? [{ $match: dateRangeMatch(fromDate, toDate) }] : []),
        {
          $facet: {
            total: [{ $count: 'n' }],
            byStatus: [{ $group: { _id: { $ifNull: ['$status', 'Unknown'] }, count: { $sum: 1 } } }],
            rows: [
              { $sort: { _reviewDate: -1 } },
              { $limit: limit },
              {
                $project: {
                  kind: { $literal: 'Expense' },
                  ref: { $ifNull: ['$expenseKey', '-'] },
                  party: { $ifNull: ['$payeeName', { $ifNull: ['$title', '-'] }] },
                  amount: 1,
                  status: 1,
                  _reviewDate: 1,
                },
              },
            ],
          },
        },
      ];
      const invoicePipe = [
        { $match: { isDeleted: false } },
        { $addFields: { _reviewDate: reviewDateExpression(['invoiceDate', 'createdAt']) } },
        ...(dateRangeMatch(fromDate, toDate) ? [{ $match: dateRangeMatch(fromDate, toDate) }] : []),
        {
          $facet: {
            total: [{ $count: 'n' }],
            byStatus: [{ $group: { _id: { $ifNull: ['$status', 'Unknown'] }, count: { $sum: 1 } } }],
            rows: [
              { $sort: { _reviewDate: -1 } },
              { $limit: limit },
              {
                $project: {
                  kind: { $literal: 'Invoice' },
                  ref: { $ifNull: ['$invoiceNumber', { $ifNull: ['$invoiceKey', '-'] }] },
                  party: { $ifNull: ['$vendorName', '-'] },
                  amount: '$totalAmount',
                  status: 1,
                  _reviewDate: 1,
                },
              },
            ],
          },
        },
      ];
      const [expenseOut, invoiceOut] = await Promise.all([
        FinanceExpense.aggregate(expensePipe),
        FinanceInvoice.aggregate(invoicePipe),
      ]);
      const e = expenseOut[0] || {};
      const i = invoiceOut[0] || {};
      const expenseTotal = Number(e.total?.[0]?.n) || 0;
      const invoiceTotal = Number(i.total?.[0]?.n) || 0;
      const byStatus = {};
      for (const row of [...(e.byStatus || []), ...(i.byStatus || [])]) {
        const key = String(row._id ?? 'Unknown');
        byStatus[key] = (byStatus[key] || 0) + (Number(row.count) || 0);
      }
      const merged = [...(e.rows || []), ...(i.rows || [])]
        .sort((a, b) => new Date(b._reviewDate || 0) - new Date(a._reviewDate || 0))
        .slice(0, limit)
        .map((r) => ({
          id: r._id,
          kind: r.kind,
          ref: r.ref || '-',
          party: r.party || '-',
          amount: r.amount,
          status: r.status || '-',
          when: fmtReviewDate(r._reviewDate),
        }));
      return {
        dateFieldLabel: 'Expense / invoice date',
        summary: {
          total: expenseTotal + invoiceTotal,
          expenses: expenseTotal,
          invoices: invoiceTotal,
          byStatus,
        },
        columns: [
          { key: 'kind', label: 'Type' },
          { key: 'ref', label: 'Reference' },
          { key: 'party', label: 'Party' },
          { key: 'amount', label: 'Amount' },
          { key: 'status', label: 'Status' },
          { key: 'when', label: 'Date' },
        ],
        rows: merged,
        total: expenseTotal + invoiceTotal,
      };
    }
    case 'movements': {
      const bucket = await runFacet(Movement, {
        baseMatch: { isDeleted: false },
        dateFields: ['createdAt'],
        fromDate,
        toDate,
        limit,
        groupField: 'status',
        rowProject: {
          _id: 1,
          movementNumber: 1,
          status: 1,
          reason: 1,
          _reviewDate: 1,
        },
      });
      return {
        dateFieldLabel: 'Created',
        summary: { total: facetTotal(bucket), byStatus: facetCounts(bucket) },
        columns: [
          { key: 'movementNumber', label: 'Number' },
          { key: 'status', label: 'Status' },
          { key: 'reason', label: 'Reason' },
          { key: 'when', label: 'Date' },
        ],
        rows: (bucket.rows || []).map((r) => ({
          id: r._id,
          movementNumber: r.movementNumber || '-',
          status: r.status || '-',
          reason: r.reason || '-',
          when: fmtReviewDate(r._reviewDate),
        })),
        total: facetTotal(bucket),
      };
    }
    case 'imports': {
      const bucket = await runFacet(ImportJob, {
        baseMatch: {},
        dateFields: ['startedAt', 'createdAt'],
        fromDate,
        toDate,
        limit,
        groupField: 'status',
        rowProject: {
          _id: 1,
          type: 1,
          importType: 1,
          status: 1,
          totalRows: 1,
          successRows: 1,
          errorRows: 1,
          _reviewDate: 1,
        },
      });
      return {
        dateFieldLabel: 'Started',
        summary: { total: facetTotal(bucket), byStatus: facetCounts(bucket) },
        columns: [
          { key: 'type', label: 'Type' },
          { key: 'status', label: 'Status' },
          { key: 'totalRows', label: 'Rows' },
          { key: 'successRows', label: 'Success' },
          { key: 'errorRows', label: 'Errors' },
          { key: 'when', label: 'Date' },
        ],
        rows: (bucket.rows || []).map((r) => ({
          id: r._id,
          type: r.type || r.importType || '-',
          status: r.status || '-',
          totalRows: r.totalRows ?? 0,
          successRows: r.successRows ?? 0,
          errorRows: r.errorRows ?? 0,
          when: fmtReviewDate(r._reviewDate),
        })),
        total: facetTotal(bucket),
      };
    }
    case 'notifications': {
      const filter = { cancelledAt: null };
      if (!hasPermission(req, PERMISSIONS.ALL) && !hasPermission(req, PERMISSIONS.AUDIT_READ)) {
        filter.userId = req.user._id;
      }
      const stages = [
        { $match: filter },
        { $addFields: { _reviewDate: reviewDateExpression(['createdAt']) } },
        ...(dateRangeMatch(fromDate, toDate) ? [{ $match: dateRangeMatch(fromDate, toDate) }] : []),
        {
          $facet: {
            total: [{ $count: 'n' }],
            byType: [{ $group: { _id: { $ifNull: ['$type', 'Unknown'] }, count: { $sum: 1 } } }],
            unread: [{ $match: { readAt: null } }, { $count: 'n' }],
            rows: [
              { $sort: { _reviewDate: -1 } },
              { $limit: limit },
              { $project: { _id: 1, title: 1, type: 1, readAt: 1, _reviewDate: 1 } },
            ],
          },
        },
      ];
      const out = await Notification.aggregate(stages);
      const bucket = out[0] || {};
      const total = Number(bucket.total?.[0]?.n) || 0;
      const unread = Number(bucket.unread?.[0]?.n) || 0;
      const byType = {};
      for (const row of bucket.byType || []) {
        byType[String(row._id ?? 'Unknown')] = Number(row.count) || 0;
      }
      return {
        dateFieldLabel: 'Created',
        summary: { total, byType, unread, read: total - unread },
        columns: [
          { key: 'title', label: 'Title' },
          { key: 'type', label: 'Type' },
          { key: 'read', label: 'Read' },
          { key: 'when', label: 'Date' },
        ],
        rows: (bucket.rows || []).map((r) => ({
          id: r._id,
          title: r.title || '-',
          type: r.type || '-',
          read: r.readAt ? 'Yes' : 'No',
          when: fmtReviewDate(r._reviewDate),
        })),
        total,
      };
    }
    case 'audit': {
      const bucket = await runFacet(AuditLog, {
        baseMatch: {},
        dateFields: ['at', 'createdAt'],
        fromDate,
        toDate,
        limit,
        groupField: 'action',
        rowProject: {
          _id: 1,
          action: 1,
          entityType: 1,
          actorEmail: 1,
          result: 1,
          _reviewDate: 1,
        },
      });
      const resultBucket = await runFacet(AuditLog, {
        baseMatch: {},
        dateFields: ['at', 'createdAt'],
        fromDate,
        toDate,
        limit: 1,
        groupField: 'result',
        rowProject: { _id: 1 },
      });
      return {
        dateFieldLabel: 'At',
        summary: {
          total: facetTotal(bucket),
          byAction: facetCounts(bucket),
          byResult: facetCounts(resultBucket),
        },
        columns: [
          { key: 'action', label: 'Action' },
          { key: 'entityType', label: 'Entity' },
          { key: 'actorEmail', label: 'Actor' },
          { key: 'result', label: 'Result' },
          { key: 'when', label: 'Date' },
        ],
        rows: (bucket.rows || []).map((r) => ({
          id: r._id,
          action: r.action || '-',
          entityType: r.entityType || '-',
          actorEmail: r.actorEmail || '-',
          result: r.result || '-',
          when: fmtReviewDate(r._reviewDate),
        })),
        total: facetTotal(bucket),
      };
    }
    case 'users': {
      const stages = [
        { $match: { isDeleted: false } },
        { $addFields: { _reviewDate: reviewDateExpression(['createdAt']) } },
        ...(dateRangeMatch(fromDate, toDate) ? [{ $match: dateRangeMatch(fromDate, toDate) }] : []),
        {
          $facet: {
            total: [{ $count: 'n' }],
            active: [{ $match: { isActive: { $ne: false } } }, { $count: 'n' }],
            inactive: [{ $match: { isActive: false } }, { $count: 'n' }],
            rows: [
              { $sort: { _reviewDate: -1 } },
              { $limit: limit },
              {
                $project: {
                  _id: 1,
                  fullName: 1,
                  email: 1,
                  username: 1,
                  isActive: 1,
                  _reviewDate: 1,
                },
              },
            ],
          },
        },
      ];
      const out = await User.aggregate(stages);
      const bucket = out[0] || {};
      const total = Number(bucket.total?.[0]?.n) || 0;
      return {
        dateFieldLabel: 'Created',
        summary: {
          total,
          active: Number(bucket.active?.[0]?.n) || 0,
          inactive: Number(bucket.inactive?.[0]?.n) || 0,
        },
        columns: [
          { key: 'fullName', label: 'Name' },
          { key: 'email', label: 'Email' },
          { key: 'username', label: 'Username' },
          { key: 'active', label: 'Active' },
          { key: 'when', label: 'Date' },
        ],
        rows: (bucket.rows || []).map((r) => ({
          id: r._id,
          fullName: r.fullName || '-',
          email: r.email || '-',
          username: r.username || '-',
          active: r.isActive === false ? 'No' : 'Yes',
          when: fmtReviewDate(r._reviewDate),
        })),
        total,
      };
    }
    case 'master-data':
      return {
        dateFieldLabel: 'N/A',
        summary: { total: 0, note: 'Open Master One for entity-level lists' },
        columns: [{ key: 'note', label: 'Note' }],
        rows: [{ id: 'master', note: 'Use Master One screens for products, expense types, and geography.' }],
        total: 0,
      };
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

/**
 * Business-facing Activity Log — maps stored audit rows without changing them.
 * Tracking still writes action codes; this layer is read-only presentation + filters.
 */

import { escapeRegex } from '../../utils/escapeRegex.js';

export const ACTIVITY_MODULES = [
  { id: 'camp-one', label: 'Camp One' },
  { id: 'finance-one', label: 'Finance One' },
  { id: 'asset-one', label: 'Asset One' },
  { id: 'document-one', label: 'Document Centre' },
  { id: 'verification-one', label: 'Verification One' },
  { id: 'request-one', label: 'Request One' },
  { id: 'movement-one', label: 'Movement One' },
  { id: 'master-one', label: 'Master One' },
  { id: 'access', label: 'User & Permissions' },
  { id: 'automations', label: 'Automations' },
  { id: 'sign-in', label: 'Sign-in' },
  { id: 'imports', label: 'Imports' },
  { id: 'other', label: 'Other' },
];

export const ACTIVITY_SOURCES = [
  { id: 'UI', label: 'UI' },
  { id: 'API', label: 'API' },
  { id: 'Import', label: 'Import' },
  { id: 'Automation', label: 'Automation' },
];

export const ACTIVITY_SEVERITIES = [
  { id: 'critical', label: 'Critical' },
  { id: 'important', label: 'Important' },
  { id: 'informational', label: 'Informational' },
];

export const ACTIVITY_TYPES = [
  { id: 'create', label: 'Creation' },
  { id: 'update', label: 'Modification' },
  { id: 'status', label: 'Status change' },
  { id: 'assignment', label: 'Assignment' },
  { id: 'approval', label: 'Approval' },
  { id: 'cancellation', label: 'Cancellation' },
  { id: 'finance', label: 'Financial' },
  { id: 'stock', label: 'Stock movement' },
  { id: 'document', label: 'Document' },
  { id: 'import_export', label: 'Import / export' },
  { id: 'system', label: 'System' },
];

const MODULE_MATCHERS = {
  'camp-one': { action: /^(camp_ops\.|CampRequest\.|CAMP\.)/i, entity: /camp/i },
  'finance-one': { action: /^(FINANCE\.|finance)/i, entity: /finance|invoice|expense|payout|vendor/i },
  'asset-one': { action: /^(ASSET\.|ASSET_MASTER\.)/i, entity: /asset(?!_request)|device/i },
  'document-one': { action: /^(AGREEMENT\.|DOCUMENT\.|DOCUMENT_TEMPLATE\.|SIGNATURE\.)/i, entity: /agreement|document_template|signature/i },
  'verification-one': { action: /^VERIFICATION\./i, entity: /verification/i },
  'request-one': { action: /^(ASSET_REQUEST\.|REPAIR\.|CampRequest\.)/i, entity: /asset_request|repair/i },
  'movement-one': { action: /^Logistics/i, entity: /logistics/i },
  'master-one': {
    action: /^(CONTACT\.|GEO|SIGNATURE_MASTER\.|DOCUMENT_TEMPLATE\.|PICKLIST\.|HCW\.)/i,
    entity: /contact|geo|signature|template|picklist|hcw/i,
  },
  'access': { action: /^(USER\.(CREATE|UPDATE|DELETE|DEACTIV)|ROLE\.|SYSTEM\.)/i, entity: /user|role/i },
  'automations': { action: /^(JOB\.|SWEEP\.|RETENTION\.|RM\.|NOTIFY\.|purge)/i, entity: /job|sweep|retention/i },
  'sign-in': { action: /^USER\.(LOGIN|LOGOUT|TOKEN|PASSWORD|REFRESH)/i, entity: /session|auth/i },
  'imports': { action: /import/i, entity: /import/i },
};

/** Actions that must carry a business reason when written going forward. */
export const SENSITIVE_ACTIONS = new Set([
  'ROLE.CREATE',
  'ROLE.UPDATE',
  'ROLE.DELETE',
  'USER.DELETE',
  'USER.DEACTIVATE',
  'camp_ops.reject',
  'camp_ops.close',
  'camp_ops.camp_delete',
  'camp_ops.confirm_payment',
  'camp_ops.payment_hold',
  'camp_ops.release_hold',
  'FINANCE.CLIENT_INVOICE.ISSUE',
  'FINANCE.CLIENT_INVOICE.VOID',
  'FINANCE.VENDOR_BILL.PAY',
  'FINANCE.VENDOR_BILL.VOID',
  'FINANCE.EXPENSE.DELETE',
  'AGREEMENT.VOID',
  'AGREEMENT.CANCEL',
  'LogisticsInOutEntry.REVERSE',
  'LogisticsInOutEntry.DISPATCH',
  'IMPORT.COMMIT',
  'camp_ops.import_confirm',
]);

const CRITICAL_ACTION_RE = /(?:DELETE|VOID|REVERSE|DISPATCH|confirm_payment|payment_hold|ROLE\.|USER\.DELETE|USER\.DEACTIV|IMPORT\.COMMIT|import_confirm|camp_delete)/i;
const IMPORTANT_ACTION_RE = /(?:APPROVE|REJECT|CANCEL|CLOSE|ISSUE|PAY|SEND|ACTIVATE|TRANSITION|HOLD|FULFILL|COMPLETE|execute|submit_to_finance)/i;

const ROUTINE_ACTION_RE = /^USER\.(LOGIN|LOGOUT|TOKEN|REFRESH)/i;

const ACTION_TITLES = {
  'camp_ops.create': 'Created a camp',
  'camp_ops.update': 'Updated a camp',
  'camp_ops.camp_delete': 'Deleted a camp',
  'camp_ops.approve': 'Approved a camp',
  'camp_ops.reject': 'Refused a camp',
  'camp_ops.execute': 'Marked a camp as executed',
  'camp_ops.submit_to_finance': 'Submitted a camp to Finance One',
  'camp_ops.confirm_payment': 'Confirmed camp payment',
  'camp_ops.payment_hold': 'Put camp payment on hold',
  'camp_ops.release_hold': 'Released a camp payment hold',
  'camp_ops.request_information': 'Asked for more camp details',
  'camp_ops.close': 'Closed a camp',
  'camp_ops.import_confirm': 'Imported camps',
  'camp_ops.program_form_create': 'Submitted a camp from the request form',
  'camp_ops.program_form_import': 'Uploaded camps from the request form',
  'camp_ops.client_create': 'Added a camp client',
  'camp_ops.client_update': 'Updated a camp client',
  'camp_ops.client_delete': 'Removed a camp client',
  'camp_ops.client_master_create': 'Added a Client Master record',
  'camp_ops.client_master_update': 'Updated a Client Master record',
  'camp_ops.client_master_delete': 'Removed a Client Master record',
  'USER.LOGIN_SUCCESS': 'Signed in',
  'USER.LOGIN_FAILURE': 'Could not sign in',
  'USER.LOGOUT': 'Signed out',
  'USER.PASSWORD_CHANGE': 'Changed a password',
  'USER.PASSWORD_RESET': 'Reset a password',
  'USER.CREATE': 'Added a user',
  'USER.UPDATE': 'Updated a user',
  'USER.DELETE': 'Removed a user',
  'ROLE.CREATE': 'Created a role',
  'ROLE.UPDATE': 'Updated a role',
  'ROLE.DELETE': 'Deleted a role',
  'ASSET.CREATE': 'Registered an asset',
  'ASSET.TRANSITION': 'Changed an asset status',
  'AGREEMENT.CREATE': 'Created an agreement',
  'AGREEMENT.SEND': 'Sent an agreement',
  'AGREEMENT.ACTIVATE': 'Activated an agreement',
  'AGREEMENT.VOID': 'Voided an agreement',
  'AGREEMENT.CANCEL': 'Cancelled an agreement',
  'ASSET_REQUEST.CREATE': 'Created a request',
  'ASSET_REQUEST.APPROVE': 'Approved a request',
  'ASSET_REQUEST.REJECT': 'Refused a request',
  'ASSET_REQUEST.CANCEL': 'Cancelled a request',
  'FINANCE.EXPENSE.CREATE': 'Recorded an expense',
  'FINANCE.EXPENSE.UPDATE': 'Updated an expense',
  'FINANCE.CLIENT_INVOICE.ISSUE': 'Issued a client invoice',
  'FINANCE.VENDOR_BILL.CREATE': 'Recorded a vendor bill',
  'IMPORT.COMMIT': 'Committed an import',
  'LogisticsInOutEntry.CREATE': 'Recorded a stock movement',
  'LogisticsInOutEntry.UPDATE': 'Updated a stock movement',
  'LogisticsInOutEntry.DISPATCH': 'Dispatched inventory',
  'LogisticsInOutEntry.REVERSE': 'Reversed a stock movement',
};

const VERB_PAST = {
  create: 'Created',
  created: 'Created',
  update: 'Updated',
  updated: 'Updated',
  delete: 'Deleted',
  deleted: 'Deleted',
  approve: 'Approved',
  approved: 'Approved',
  reject: 'Refused',
  rejected: 'Refused',
  cancel: 'Cancelled',
  cancelled: 'Cancelled',
  send: 'Sent',
  execute: 'Marked as executed',
  import: 'Imported',
  upload: 'Uploaded',
  download: 'Downloaded',
  pay: 'Paid',
  hold: 'Put on hold',
  transition: 'Updated the status of',
  void: 'Voided',
  reverse: 'Reversed',
  dispatch: 'Dispatched',
};

export function resolveActivityModule(action = '', entityType = '', actorType = '') {
  const a = String(action || '');
  const e = String(entityType || '');
  const type = String(actorType || '').toUpperCase();
  if ((type === 'SYSTEM' || type === 'JOB') && !MODULE_MATCHERS['sign-in'].action.test(a)) {
    const auto = MODULE_MATCHERS.automations;
    if (auto.action.test(a) || auto.entity.test(e) || type === 'JOB') {
      const exact = ACTIVITY_MODULES.find((m) => m.id === 'automations');
      if (exact && (auto.action.test(a) || auto.entity.test(e) || /sweep|retention|notify|purge|job/i.test(a))) {
        return exact;
      }
    }
  }
  for (const mod of ACTIVITY_MODULES) {
    if (mod.id === 'other') continue;
    const match = MODULE_MATCHERS[mod.id];
    if (!match) continue;
    if ((a && match.action.test(a)) || (e && match.entity.test(e))) return mod;
  }
  return ACTIVITY_MODULES.find((m) => m.id === 'other');
}

export function resolveActivitySeverity(action = '', explicit = null) {
  const raw = String(explicit || '').trim().toLowerCase();
  if (raw === 'critical' || raw === 'important' || raw === 'informational') return raw;
  const a = String(action || '');
  if (SENSITIVE_ACTIONS.has(a) || CRITICAL_ACTION_RE.test(a)) return 'critical';
  if (IMPORTANT_ACTION_RE.test(a)) return 'important';
  return 'informational';
}

export function resolveActivityType(action = '', explicit = null) {
  const raw = String(explicit || '').trim().toLowerCase();
  if (ACTIVITY_TYPES.some((t) => t.id === raw)) return raw;
  const a = String(action || '');
  if (/import|export|IMPORT/i.test(a)) return 'import_export';
  if (/Logistics|stock|DISPATCH|REVERSE|InOut/i.test(a)) return 'stock';
  if (/FINANCE|invoice|expense|payout|payment|VENDOR_BILL|confirm_payment/i.test(a)) return 'finance';
  if (/AGREEMENT|DOCUMENT|SIGNATURE|execution_docs/i.test(a)) return 'document';
  if (/APPROVE|approve/i.test(a)) return 'approval';
  if (/REJECT|CANCEL|cancel|void|close|refuse/i.test(a)) return 'cancellation';
  if (/assign|ASSIGN|hcw|executor/i.test(a)) return 'assignment';
  if (/TRANSITION|status|execute|ACTIVATE|SEND/i.test(a)) return 'status';
  if (/CREATE|create|REGISTER/i.test(a)) return 'create';
  if (/UPDATE|update/i.test(a)) return 'update';
  if (/JOB|SWEEP|RETENTION|SYSTEM|LOGIN|TOKEN/i.test(a)) return 'system';
  return 'update';
}

export function resolveActivitySource({
  source = null,
  action = '',
  actorType = '',
} = {}) {
  const raw = String(source || '').trim();
  if (['UI', 'API', 'Import', 'Automation'].includes(raw)) return raw;
  const a = String(action || '');
  const type = String(actorType || '').toUpperCase();
  if (/import/i.test(a) || a === 'IMPORT.COMMIT') return 'Import';
  if (type === 'SYSTEM' || type === 'JOB' || /^(JOB\.|SWEEP\.|RETENTION\.|RM\.|NOTIFY\.)/i.test(a)) {
    return 'Automation';
  }
  return 'API';
}

export function isRoutineActivityAction(action = '') {
  return ROUTINE_ACTION_RE.test(String(action || ''));
}

export function isSensitiveActivityAction(action = '') {
  return SENSITIVE_ACTIONS.has(String(action || '').trim());
}

export function normalizeActivityResult(value) {
  const raw = String(value || '').trim().toLowerCase();
  if (!raw) return '';
  if (['success', 'ok', 'done', 'completed', 'complete'].includes(raw)) return 'SUCCESS';
  if (['fail', 'failed', 'failure', 'error'].includes(raw)) return 'FAILURE';
  return String(value).trim().toUpperCase();
}

export function activityResultLabel(result) {
  const norm = normalizeActivityResult(result) || String(result || '').toUpperCase();
  if (norm === 'SUCCESS') return 'Completed';
  if (norm === 'FAILURE') return 'Failed';
  if (!norm) return 'Recorded';
  return norm.charAt(0) + norm.slice(1).toLowerCase();
}

function titleFromAction(action) {
  const key = String(action || '').trim();
  if (ACTION_TITLES[key]) return ACTION_TITLES[key];
  const parts = key.split(/[._]+/).filter(Boolean);
  const last = (parts[parts.length - 1] || 'updated').toLowerCase();
  const verb = VERB_PAST[last] || last.replace(/^\w/, (c) => c.toUpperCase());
  const object = inferObject(key);
  return object ? `${verb} ${object}` : `${verb} a record`;
}

function inferObject(action) {
  const a = String(action || '').toLowerCase();
  if (a.includes('camp')) return 'a camp';
  if (a.includes('invoice')) return 'an invoice';
  if (a.includes('expense')) return 'an expense';
  if (a.includes('agreement')) return 'an agreement';
  if (a.includes('asset_request') || a.includes('request')) return 'a request';
  if (a.includes('asset')) return 'an asset';
  if (a.includes('user')) return 'a user';
  if (a.includes('role')) return 'a role';
  if (a.includes('contact')) return 'a contact';
  return '';
}

export function activityEmployee(row = {}) {
  const email = String(row.actorEmail || '').trim();
  if (email) return email;
  const type = String(row.actorType || '').trim().toUpperCase();
  if (type === 'SYSTEM' || type === 'JOB') return 'System';
  return 'Someone on the team';
}

function pickSubject(row = {}) {
  const src = row.after && typeof row.after === 'object'
    ? row.after
    : row.before && typeof row.before === 'object'
      ? row.before
      : {};
  return String(
    src.campId
    || src.clientName
    || src.fullName
    || src.name
    || src.documentNumber
    || src.invoiceNumber
    || src.title
    || src.assetName
    || src.email
    || '',
  ).trim();
}

export function describeActivity(row = {}) {
  const module = row.module
    ? (ACTIVITY_MODULES.find((m) => m.id === row.module) || resolveActivityModule(row.action, row.entityType, row.actorType))
    : resolveActivityModule(row.action, row.entityType, row.actorType);
  const title = titleFromAction(row.action);
  const employee = activityEmployee(row);
  const subject = pickSubject(row);
  const status = activityResultLabel(row.result);
  const failed = normalizeActivityResult(row.result) === 'FAILURE';
  const severity = resolveActivitySeverity(row.action, row.severity);
  const activityType = resolveActivityType(row.action, row.activityType);
  const source = resolveActivitySource({
    source: row.source,
    action: row.action,
    actorType: row.actorType,
  });
  const summary = failed
    ? `${employee} tried to ${title.charAt(0).toLowerCase()}${title.slice(1)}${subject ? ` (${subject})` : ''}, but it did not complete.`
    : `${employee} ${title.charAt(0).toLowerCase()}${title.slice(1)}${subject ? ` (${subject})` : ''}.`;
  return {
    moduleId: module.id,
    moduleLabel: module.label,
    title,
    summary,
    employee,
    subject,
    status,
    result: normalizeActivityResult(row.result) || 'SUCCESS',
    severity,
    activityType,
    source,
  };
}

export const ACTIVITY_DEFAULT_WINDOW_DAYS = 30;

const SUBJECT_KEYS = [
  'campId',
  'clientName',
  'fullName',
  'name',
  'documentNumber',
  'invoiceNumber',
  'title',
  'assetName',
  'email',
];

/** Keep list rows small — full before/after snapshots time out the Activity Log. */
export function slimActivityListRow(row) {
  if (!row || typeof row !== 'object') return row;
  const afterSrc = row.after && typeof row.after === 'object' ? row.after : {};
  const after = {};
  for (const key of SUBJECT_KEYS) {
    if (afterSrc[key] != null && afterSrc[key] !== '') after[key] = afterSrc[key];
  }
  const module = row.module
    || resolveActivityModule(row.action, row.entityType, row.actorType).id;
  return {
    _id: row._id,
    at: row.at,
    actorEmail: row.actorEmail,
    actorType: row.actorType,
    action: row.action,
    entityType: row.entityType,
    entityId: row.entityId,
    result: row.result,
    message: row.message,
    reason: row.reason || null,
    ip: row.ip,
    module,
    source: resolveActivitySource({
      source: row.source,
      action: row.action,
      actorType: row.actorType,
    }),
    severity: resolveActivitySeverity(row.action, row.severity),
    activityType: resolveActivityType(row.action, row.activityType),
    programmeId: row.programmeId || null,
    relatedEventId: row.relatedEventId || null,
    reversalOfEventId: row.reversalOfEventId || null,
    reversedByEventId: row.reversedByEventId || null,
    after: Object.keys(after).length ? after : null,
  };
}

/**
 * Audit `at` is often an ISO string (JSON clone on write) and sometimes a BSON Date.
 * Comparing only with Date objects matches neither string-stored rows in Mongo.
 */
export function buildActivityAtRangeClause(fromInput, toInput, now = new Date()) {
  let from = fromInput ? new Date(fromInput) : null;
  let to = toInput ? new Date(toInput) : null;
  if (from && Number.isNaN(from.getTime())) from = null;
  if (to && Number.isNaN(to.getTime())) to = null;

  if (!from && !to) {
    to = new Date(now);
    from = new Date(now);
    from.setUTCDate(from.getUTCDate() - (ACTIVITY_DEFAULT_WINDOW_DAYS - 1));
    from.setUTCHours(0, 0, 0, 0);
  }

  const dateRange = {};
  const stringRange = {};
  if (from) {
    dateRange.$gte = from;
    stringRange.$gte = from.toISOString();
  }
  if (to) {
    dateRange.$lte = to;
    stringRange.$lte = to.toISOString();
  }

  return {
    $or: [
      { at: dateRange },
      { at: stringRange },
    ],
  };
}

/** Bound reads to an explicit/default window that works for Date or ISO-string `at`. */
export function applyDefaultActivityWindow(filter, query = {}, now = new Date()) {
  if (filter.at) {
    const from = filter.at.$gte;
    const to = filter.at.$lte;
    delete filter.at;
    filter.$and = [...(filter.$and || []), buildActivityAtRangeClause(from, to, now)];
    return filter;
  }
  if (query.from || query.to) {
    filter.$and = [...(filter.$and || []), buildActivityAtRangeClause(query.from, query.to, now)];
    return filter;
  }
  filter.$and = [...(filter.$and || []), buildActivityAtRangeClause(null, null, now)];
  return filter;
}

/** Hide login/token noise from the business Activity Log unless includeRoutine=1. */
export function applyRoutineExclusion(filter, query = {}) {
  const include = String(query.includeRoutine || '').trim();
  if (include === '1' || include.toLowerCase() === 'true') return filter;
  const clause = { action: { $not: ROUTINE_ACTION_RE } };
  filter.$and = [...(filter.$and || []), clause];
  return filter;
}

export function applyActivityLogFilters(filter, query = {}) {
  const result = normalizeActivityResult(query.result || query.status);
  if (result) filter.result = result;

  const actor = String(query.actorEmail || query.employee || '').trim();
  if (actor) filter.actorEmail = new RegExp(escapeRegex(actor), 'i');

  const moduleId = String(query.module || '').trim();
  const match = MODULE_MATCHERS[moduleId];
  if (match) {
    const clause = {
      $or: [
        { module: moduleId },
        { action: match.action },
        { entityType: match.entity },
      ],
    };
    filter.$and = [...(filter.$and || []), clause];
  }

  const severity = String(query.severity || '').trim().toLowerCase();
  if (severity === 'critical' || severity === 'important' || severity === 'informational') {
    filter.severity = severity;
  }

  const source = String(query.source || '').trim();
  if (['UI', 'API', 'Import', 'Automation'].includes(source)) {
    filter.source = source;
  }

  const activityType = String(query.activityType || '').trim().toLowerCase();
  if (ACTIVITY_TYPES.some((t) => t.id === activityType)) {
    filter.activityType = activityType;
  }

  const programmeId = String(query.programmeId || '').trim();
  if (programmeId) filter.programmeId = programmeId;

  if (query.hasReason === '1' || query.hasReason === 'true') {
    filter.reason = { $exists: true, $nin: [null, ''] };
  }

  return filter;
}

/**
 * Programme-scoped readers see their programmes plus org-level / legacy rows
 * that never carried a programmeId. Unrestricted readers get no extra clause.
 */
export function applyProgrammeScopeFilter(filter, programmeIds) {
  if (!Array.isArray(programmeIds)) return filter;
  if (!programmeIds.length) {
    filter.programmeId = { $in: [] };
    return filter;
  }
  const clause = {
    $or: [
      { programmeId: { $in: programmeIds } },
      { programmeId: null },
      { programmeId: { $exists: false } },
      { programmeId: '' },
    ],
  };
  filter.$and = [...(filter.$and || []), clause];
  return filter;
}

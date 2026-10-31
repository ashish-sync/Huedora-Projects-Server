/**
 * Business-facing Activity Log — maps stored audit rows without changing them.
 * Tracking still writes action codes; this layer is read-only presentation + filters.
 */

import { escapeRegex } from '../../utils/escapeRegex.js';

export const ACTIVITY_MODULES = [
  { id: 'camp-one', label: 'Camp One' },
  { id: 'finance-one', label: 'Finance One' },
  { id: 'asset-one', label: 'Asset One' },
  { id: 'document-one', label: 'Document One' },
  { id: 'verification-one', label: 'Verification One' },
  { id: 'request-one', label: 'Request One' },
  { id: 'movement-one', label: 'Movement One' },
  { id: 'master-one', label: 'Master One' },
  { id: 'access', label: 'Access Control' },
  { id: 'sign-in', label: 'Sign-in' },
  { id: 'imports', label: 'Imports' },
  { id: 'other', label: 'Other' },
];

const MODULE_MATCHERS = {
  'camp-one': { action: /^(camp_ops\.|CampRequest\.|CAMP\.)/i, entity: /camp/i },
  'finance-one': { action: /^(FINANCE\.|finance)/i, entity: /finance|invoice|expense|payout|vendor/i },
  'asset-one': { action: /^(ASSET\.|ASSET_MASTER\.)/i, entity: /asset(?!_request)|device/i },
  'document-one': { action: /^(AGREEMENT\.|DOCUMENT\.|DOCUMENT_TEMPLATE\.)/i, entity: /agreement|document_template/i },
  'verification-one': { action: /^VERIFICATION\./i, entity: /verification/i },
  'request-one': { action: /^(ASSET_REQUEST\.|REPAIR\.|CampRequest\.)/i, entity: /asset_request|repair/i },
  'movement-one': { action: /^Logistics/i, entity: /logistics/i },
  'master-one': {
    action: /^(CONTACT\.|GEO|SIGNATURE_MASTER\.|DOCUMENT_TEMPLATE\.|PICKLIST\.|HCW\.)/i,
    entity: /contact|geo|signature|template|picklist|hcw/i,
  },
  'access': { action: /^(USER\.(CREATE|UPDATE|DELETE)|ROLE\.|SYSTEM\.)/i, entity: /user|role/i },
  'sign-in': { action: /^USER\.(LOGIN|LOGOUT|TOKEN|PASSWORD|REFRESH)/i, entity: /session|auth/i },
  'imports': { action: /import/i, entity: /import/i },
};

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
  'ROLE.DELETE': 'Removed a role',
  'ASSET.CREATE': 'Registered an asset',
  'ASSET.TRANSITION': 'Changed an asset status',
  'AGREEMENT.CREATE': 'Created an agreement',
  'AGREEMENT.SEND': 'Sent an agreement',
  'AGREEMENT.ACTIVATE': 'Activated an agreement',
  'ASSET_REQUEST.CREATE': 'Created a request',
  'ASSET_REQUEST.APPROVE': 'Approved a request',
  'ASSET_REQUEST.REJECT': 'Refused a request',
  'ASSET_REQUEST.CANCEL': 'Cancelled a request',
  'FINANCE.EXPENSE.CREATE': 'Recorded an expense',
  'FINANCE.EXPENSE.UPDATE': 'Updated an expense',
  'FINANCE.CLIENT_INVOICE.ISSUE': 'Issued a client invoice',
  'FINANCE.VENDOR_BILL.CREATE': 'Recorded a vendor bill',
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
};

export function resolveActivityModule(action = '', entityType = '') {
  const a = String(action || '');
  const e = String(entityType || '');
  for (const mod of ACTIVITY_MODULES) {
    if (mod.id === 'other') continue;
    const match = MODULE_MATCHERS[mod.id];
    if (!match) continue;
    if ((a && match.action.test(a)) || (e && match.entity.test(e))) return mod;
  }
  return ACTIVITY_MODULES.find((m) => m.id === 'other');
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
  const module = resolveActivityModule(row.action, row.entityType);
  const title = titleFromAction(row.action);
  const employee = activityEmployee(row);
  const subject = pickSubject(row);
  const status = activityResultLabel(row.result);
  const failed = normalizeActivityResult(row.result) === 'FAILURE';
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
  };
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
        { action: match.action },
        { entityType: match.entity },
      ],
    };
    filter.$and = [...(filter.$and || []), clause];
  }
  return filter;
}

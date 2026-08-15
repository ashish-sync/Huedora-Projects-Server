import { FinanceCommercialDocument } from './finance.model.js';
import { DOCUMENT_NUMBER_LABELS } from './documentNumbering.js';
import { notifyEvent } from '../notifications/notifyEvent.js';
import { writeAudit } from '../../utils/audit.js';

/** Soft-delete drafts idle this many days (no edit / update). */
export const DRAFT_IDLE_DELETE_DAYS = 30;
/** Warn once when idle reaches this many days (2 days before delete). */
export const DRAFT_IDLE_WARN_DAYS = 28;

export const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Idle clock for drafts. Prefer lastContentEditedAt so system writes
 * (stale warn / auto-delete metadata) do not reset the timer via updatedAt.
 */
export function lastEditedAt(doc, now = new Date()) {
  const raw = doc?.lastContentEditedAt || doc?.updatedAt || doc?.createdAt;
  if (!raw) return now;
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? now : d;
}

/** Freeze the content-edit timestamp before a system save bumps updatedAt. */
function preserveContentEditedAt(doc) {
  if (!doc.lastContentEditedAt) {
    doc.lastContentEditedAt = doc.updatedAt || doc.createdAt || new Date().toISOString();
  }
}

export function idleDays(doc, now = new Date()) {
  const edited = lastEditedAt(doc, now);
  return (now.getTime() - edited.getTime()) / DAY_MS;
}

/**
 * @returns {'ok' | 'warn' | 'delete'}
 */
export function classifyDraftIdle(doc, now = new Date()) {
  if (!doc || doc.isDeleted || doc.status !== 'Draft') return 'ok';
  const days = idleDays(doc, now);
  if (days >= DRAFT_IDLE_DELETE_DAYS) return 'delete';
  if (days >= DRAFT_IDLE_WARN_DAYS && !doc.draftStaleWarnedAt) return 'warn';
  return 'ok';
}

function docLabel(doc) {
  const type =
    DOCUMENT_NUMBER_LABELS[doc.documentType] || doc.documentType || 'Document';
  const num = String(doc.documentNumber || doc.docKey || '').trim();
  const name = String(doc.recipientName || doc.projectName || '').trim();
  const parts = [type];
  if (num) parts.push(num);
  if (name) parts.push(name);
  return parts.join(' · ');
}

function recipientIds(doc) {
  const ids = new Set();
  for (const id of [doc.createdById, doc.updatedById]) {
    if (id != null && String(id).trim()) ids.add(String(id));
  }
  return [...ids];
}

async function notifyDraftStakeholders(doc, { type, title, body }) {
  const users = recipientIds(doc);
  await notifyEvent({
    type,
    title,
    body,
    entityType: 'FinanceCommercialDocument',
    entityId: doc._id,
    recipients: users,
    includeWatchers: true,
    module: 'finance',
  });
}

async function softDeleteDraft(doc, nowIso) {
  doc.isDeleted = true;
  doc.deletedAt = nowIso;
  doc.deletedBy = null;
  doc.autoDeletedAt = nowIso;
  doc.autoDeleteReason = 'stale_draft_idle_30d';
  await doc.save();
}

/**
 * Warn (≈28d idle) then soft-delete (30d idle) Billing Center drafts.
 * Safe to run repeatedly; warn fires at most once per draft until edited again.
 */
export async function purgeStaleCommercialDrafts({ now = new Date(), dryRun = false } = {}) {
  const drafts = await FinanceCommercialDocument.find({
    isDeleted: false,
    status: 'Draft',
  });

  let warned = 0;
  let deleted = 0;
  const nowIso = now.toISOString();

  for (const row of drafts) {
    const action = classifyDraftIdle(row, now);
    if (action === 'ok') continue;

    const label = docLabel(row);
    const days = Math.floor(idleDays(row, now));

    if (action === 'warn') {
      if (!dryRun) {
        preserveContentEditedAt(row);
        row.draftStaleWarnedAt = nowIso;
        await row.save();
        await notifyDraftStakeholders(row, {
          type: 'FINANCE_DRAFT_STALE_WARN',
          title: `Draft will be deleted soon: ${label}`,
          body: `This Billing Center draft has not been edited for ${days} days. It will be auto-deleted after ${DRAFT_IDLE_DELETE_DAYS} days without edits. Open Finance One → Billing Center to update or submit it.`,
        });
        await writeAudit({
          actorId: null,
          actorType: 'SYSTEM',
          actorEmail: 'system@tylo.one',
          action: 'FINANCE.COMMERCIAL.DRAFT_STALE_WARN',
          entityType: 'FinanceCommercialDocument',
          entityId: row._id,
          after: { draftStaleWarnedAt: nowIso, idleDays: days },
          message: `Warned stale draft (${days}d idle)`,
        });
      }
      warned += 1;
      continue;
    }

    if (action === 'delete') {
      if (!dryRun) {
        const before = row.toObject ? row.toObject() : { ...row };
        await notifyDraftStakeholders(row, {
          type: 'FINANCE_DRAFT_AUTO_DELETED',
          title: `Draft auto-deleted: ${label}`,
          body: `This Billing Center draft was automatically deleted after ${DRAFT_IDLE_DELETE_DAYS} days without edits.`,
        });
        preserveContentEditedAt(row);
        await softDeleteDraft(row, nowIso);
        await writeAudit({
          actorId: null,
          actorType: 'SYSTEM',
          actorEmail: 'system@tylo.one',
          action: 'FINANCE.COMMERCIAL.DRAFT_AUTO_DELETE',
          entityType: 'FinanceCommercialDocument',
          entityId: row._id,
          before,
          after: {
            isDeleted: true,
            deletedAt: nowIso,
            autoDeleteReason: 'stale_draft_idle_30d',
            idleDays: days,
          },
          message: `Auto-deleted stale draft (${days}d idle)`,
        });
      }
      deleted += 1;
    }
  }

  return { scanned: drafts.length, warned, deleted };
}

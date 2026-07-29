import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { parseLocalDateInput } from '../utils/campHelpers.js';
import { getAllowedEmailDomains } from '../utils/emailParser.js';
import { getAppState, setAppState } from '../../../common/appState.model.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LEGACY_STATE_FILE = path.join(__dirname, '../../.email-ingest-since.json');
const STATE_KEY = 'email_ingest';
const HANDLED_ID_LIMIT = 2000;

let state = {};
let hydrated = false;
let cachedSince = null;

function readLegacyFileState() {
  try {
    if (!fs.existsSync(LEGACY_STATE_FILE)) return null;
    return JSON.parse(fs.readFileSync(LEGACY_STATE_FILE, 'utf8'));
  } catch {
    return null;
  }
}

function stripMeta(doc) {
  const { toObject, save, populate, createdAt, updatedAt, _id, ...rest } = doc || {};
  return rest;
}

/** Load email ingest cursor from MongoDB (call once after connectDb). */
export async function hydrateEmailIngestState() {
  const stored = await getAppState(STATE_KEY, {});
  const legacy = readLegacyFileState();
  const hasStored = Object.keys(stripMeta(stored)).length > 0;

  if (!hasStored && legacy) {
    state = { ...legacy };
    await persistState();
    try {
      fs.unlinkSync(LEGACY_STATE_FILE);
      console.log('[email] Migrated legacy .email-ingest-since.json to MongoDB app_state');
    } catch {
      // non-fatal
    }
  } else {
    state = hasStored ? stripMeta(stored) : {};
  }

  hydrated = true;
  cachedSince = null;
}

function ensureHydrated() {
  if (!hydrated) {
    throw new Error('[email] Email ingest state not hydrated — call hydrateEmailIngestState() after connectDb');
  }
}

async function persistState() {
  ensureHydrated();
  await setAppState(STATE_KEY, state);
}

function parseProcessFromEnv(value) {
  const text = String(value || '').trim();
  if (!text || text.toLowerCase() === 'now') return null;

  const parsed = parseLocalDateInput(text);
  if (parsed) return parsed;

  const date = new Date(text);
  if (!Number.isNaN(date.getTime())) return date;

  throw new Error(`Invalid EMAIL_IMAP_PROCESS_FROM value: ${text}`);
}

function readPersistedSince() {
  if (!state.since) return null;
  const date = new Date(state.since);
  return Number.isNaN(date.getTime()) ? null : date;
}

async function persistSince(date) {
  state.since = date.toISOString();
  state.savedAt = new Date().toISOString();
  await persistState();
}

export function getEmailProcessSinceDate() {
  ensureHydrated();
  if (cachedSince) return cachedSince;

  const envValue = process.env.EMAIL_IMAP_PROCESS_FROM || 'now';
  const explicit = parseProcessFromEnv(envValue);

  if (explicit) {
    cachedSince = explicit;
    return cachedSince;
  }

  const persisted = readPersistedSince();
  if (persisted) {
    cachedSince = persisted;
    return cachedSince;
  }

  cachedSince = new Date();
  persistSince(cachedSince).catch((err) => {
    console.error('[email] Failed to persist activation timestamp:', err.message);
  });
  return cachedSince;
}

export function getEmailFetchSinceDate() {
  ensureHydrated();
  const activation = getEmailProcessSinceDate();

  if (state.lastProcessedAt) {
    const cursor = new Date(state.lastProcessedAt);
    if (!Number.isNaN(cursor.getTime())) {
      return new Date(Math.max(activation.getTime(), cursor.getTime()));
    }
  }

  return activation;
}

export function getEmailIngestCursor() {
  ensureHydrated();
  return {
    activationSince: getEmailProcessSinceDate(),
    fetchSince: getEmailFetchSinceDate(),
    lastProcessedAt: state.lastProcessedAt ? new Date(state.lastProcessedAt) : null,
    lastMessageId: state.lastMessageId || null,
    lastUid: state.lastUid ?? null,
    handledCount: Array.isArray(state.handledMessageIds) ? state.handledMessageIds.length : 0,
  };
}

export function wasEmailMessageHandled(messageId) {
  ensureHydrated();
  const id = String(messageId || '').trim();
  if (!id) return false;
  const handled = Array.isArray(state.handledMessageIds) ? state.handledMessageIds : [];
  return handled.includes(id);
}

export async function markEmailMessageHandled({ messageId, receivedAt, uid }) {
  ensureHydrated();
  const id = String(messageId || '').trim();
  if (!id) return;

  const at = receivedAt ? new Date(receivedAt) : new Date();
  const handled = Array.isArray(state.handledMessageIds) ? [...state.handledMessageIds] : [];

  if (!handled.includes(id)) {
    handled.push(id);
  }

  state.handledMessageIds = handled.slice(-HANDLED_ID_LIMIT);
  state.lastMessageId = id;
  state.lastUid = uid ?? state.lastUid ?? null;

  const previous = state.lastProcessedAt ? new Date(state.lastProcessedAt) : null;
  if (!previous || at >= previous) {
    state.lastProcessedAt = at.toISOString();
  }

  state.updatedAt = new Date().toISOString();
  await persistState();
}

export function logEmailProcessSince() {
  ensureHydrated();
  const cursor = getEmailIngestCursor();
  const source = (() => {
    const envValue = String(process.env.EMAIL_IMAP_PROCESS_FROM || 'now').trim().toLowerCase();
    if (envValue && envValue !== 'now') return `EMAIL_IMAP_PROCESS_FROM=${process.env.EMAIL_IMAP_PROCESS_FROM}`;
    if (readPersistedSince()) return 'persisted activation timestamp';
    return 'server activation (now)';
  })();

  console.log(`[email] IMAP fetch filter (${source}): ${describeImapFetchQuery()}`);

  if (cursor.lastProcessedAt) {
    console.log(
      `[email] IMAP cursor: last processed ${cursor.lastProcessedAt.toISOString()} | messageId=${cursor.lastMessageId || '-'} | uid=${cursor.lastUid ?? '-'} | tracked=${cursor.handledCount}`
    );
  }
}

export function buildImapFetchQuery() {
  const since = getEmailFetchSinceDate();
  const domains = getAllowedEmailDomains();
  const base = { since };

  if (!domains.length) return base;

  if (domains.length === 1) {
    return { ...base, from: domains[0] };
  }

  return {
    ...base,
    or: domains.map((domain) => ({ from: domain })),
  };
}

export function describeImapFetchQuery() {
  const since = getEmailFetchSinceDate();
  const domains = getAllowedEmailDomains();
  const parts = [`all mail since ${since.toISOString()} (read + unread)`];
  if (domains.length) {
    parts.push(`from domains: ${domains.join(', ')}`);
  }
  return parts.join(' | ');
}

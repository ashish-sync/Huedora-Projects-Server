import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { parseLocalDateInput } from '../utils/campHelpers.js';
import { getAllowedEmailDomains } from '../utils/emailParser.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const STATE_FILE = path.join(__dirname, '../../.email-ingest-since.json');
const HANDLED_ID_LIMIT = 2000;

let cachedSince = null;

function readFullState() {
  try {
    if (!fs.existsSync(STATE_FILE)) return {};
    return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
  } catch {
    return {};
  }
}

function writeFullState(state) {
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

function readPersistedSince() {
  const data = readFullState();
  if (!data.since) return null;
  const date = new Date(data.since);
  return Number.isNaN(date.getTime()) ? null : date;
}

function persistSince(date) {
  const state = readFullState();
  state.since = date.toISOString();
  state.savedAt = new Date().toISOString();
  writeFullState(state);
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

export function getEmailProcessSinceDate() {
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
  persistSince(cachedSince);
  return cachedSince;
}

export function getEmailFetchSinceDate() {
  const activation = getEmailProcessSinceDate();
  const state = readFullState();

  if (state.lastProcessedAt) {
    const cursor = new Date(state.lastProcessedAt);
    if (!Number.isNaN(cursor.getTime())) {
      return new Date(Math.max(activation.getTime(), cursor.getTime()));
    }
  }

  return activation;
}

export function getEmailIngestCursor() {
  const state = readFullState();
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
  const id = String(messageId || '').trim();
  if (!id) return false;

  const state = readFullState();
  const handled = Array.isArray(state.handledMessageIds) ? state.handledMessageIds : [];
  return handled.includes(id);
}

export function markEmailMessageHandled({ messageId, receivedAt, uid }) {
  const id = String(messageId || '').trim();
  if (!id) return;

  const state = readFullState();
  const at = receivedAt ? new Date(receivedAt) : new Date();
  const handled = Array.isArray(state.handledMessageIds) ? state.handledMessageIds : [];

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
  writeFullState(state);
}

export function logEmailProcessSince() {
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

import { isImapConfigured, logEmailIngestStartup, verifyImapConnection, formatImapError } from './emailClient.js';
import { pollImapInbox } from './emailIngestService.js';

let pollTimer = null;
let pollInProgress = false;

function getPollIntervalMs() {
  if (process.env.EMAIL_IMAP_POLL_INTERVAL_MS) {
    return Number(process.env.EMAIL_IMAP_POLL_INTERVAL_MS);
  }

  const minutes = Number(process.env.EMAIL_IMAP_POLL_INTERVAL_MINUTES || 5);
  return minutes * 60 * 1000;
}

function formatPollInterval(intervalMs) {
  if (process.env.EMAIL_IMAP_POLL_INTERVAL_MS) {
    return `${intervalMs}ms`;
  }

  const minutes = Number(process.env.EMAIL_IMAP_POLL_INTERVAL_MINUTES || 5);
  return `${minutes} minute${minutes === 1 ? '' : 's'}`;
}

export async function startEmailPoller() {
  logEmailIngestStartup();

  if (process.env.EMAIL_IMAP_ENABLED !== 'true') {
    return;
  }

  if (!isImapConfigured()) {
    console.warn('[email] IMAP poller not started — missing EMAIL_IMAP_* settings');
    return;
  }

  try {
    await verifyImapConnection();
  } catch (error) {
    console.error('[email] IMAP connection failed — poller not started:', formatImapError(error));
    return;
  }

  const intervalMs = getPollIntervalMs();

  const runPoll = async () => {
    if (pollInProgress) return;
    pollInProgress = true;
    try {
      const result = await pollImapInbox();
      if (result.processed > 0) {
        console.log(`[email] IMAP poll processed ${result.processed} message(s)`);
      }
    } catch (error) {
      console.error('[email] IMAP poll failed:', formatImapError(error));
    } finally {
      pollInProgress = false;
    }
  };

  runPoll();
  pollTimer = setInterval(runPoll, intervalMs);
  console.log(`[email] IMAP poller started — checking every ${formatPollInterval(intervalMs)}`);
}

export function stopEmailPoller() {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
}

/**
 * Platform outbound From address for TYLO One system mail:
 * notifications, daily reports, alerts, camp auto-replies, agreements, etc.
 *
 * Finance commercial letterhead stays on the org profile email
 * (default growth@tylocare.com) — do not reuse this for invoice/PO From.
 */
export const TYLO_SYSTEM_FROM_EMAIL = 'support@tylo.systems';

export function getSystemFromEmail() {
  const fromEnv = String(process.env.EMAIL_SMTP_FROM || '').trim();
  return fromEnv || TYLO_SYSTEM_FROM_EMAIL;
}

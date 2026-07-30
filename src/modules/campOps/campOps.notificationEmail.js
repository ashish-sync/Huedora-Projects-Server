import {
  isEmailReplyConfigured,
  isEmailReplyEnabled,
  sendTransactionalEmail,
} from './communications/services/emailClient.js';

export function isCampStakeholderEmailEnabled() {
  if (process.env.CAMP_STAKEHOLDER_EMAIL_ENABLED === 'false') return false;
  if (process.env.CAMP_STAKEHOLDER_EMAIL_ENABLED === 'true') {
    return isEmailReplyEnabled() && isEmailReplyConfigured();
  }
  return isEmailReplyEnabled() && isEmailReplyConfigured();
}

export function buildCampStakeholderEmail({
  title,
  body,
  camp = {},
  recipientName = '',
  audience = 'coordinator',
}) {
  const campLabel = camp.campId || 'Camp';
  const subjectPrefix = audience === 'manager' ? '[Manager copy] ' : '';
  const subject = `${subjectPrefix}${title}`;
  const greeting = recipientName ? `Hello ${recipientName},` : 'Hello,';
  const audienceNote = audience === 'manager'
    ? 'You are receiving this email because you are the reporting manager for an assigned camp coordinator on this client.'
    : 'You are receiving this email because you are assigned as a coordinator for this client in Client Master.';

  const lines = [
    greeting,
    '',
    title,
    '',
    body,
    '',
    `Camp: ${campLabel}`,
    camp.clientName ? `Client: ${camp.clientName}` : '',
    camp.campaignName ? `Method: ${camp.campaignName}` : '',
    camp.campDate ? `Camp date: ${camp.campDate}` : '',
    '',
    audienceNote,
    '',
    '— TYLO One / Camp One',
  ].filter(Boolean);

  return {
    subject,
    text: lines.join('\n'),
  };
}

export async function sendCampStakeholderEmail({
  user,
  camp,
  title,
  body,
  audience = 'coordinator',
}) {
  if (!isCampStakeholderEmailEnabled()) {
    return { sent: false, skipped: true, reason: 'disabled' };
  }

  const email = String(user?.email || '').trim();
  if (!email) {
    return { sent: false, skipped: true, reason: 'missing_email' };
  }

  const { subject, text } = buildCampStakeholderEmail({
    title,
    body,
    camp,
    recipientName: user.fullName || user.name || '',
    audience,
  });

  try {
    await sendTransactionalEmail({ to: email, subject, text });
    return { sent: true, email };
  } catch (error) {
    console.error(`[camp-email] Failed to send ${audience} alert to ${email}:`, error?.message || error);
    return { sent: false, email, error: error?.message || 'send_failed' };
  }
}

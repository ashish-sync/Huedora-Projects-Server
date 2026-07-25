import crypto from 'crypto';

const GRAPH_API = 'https://graph.facebook.com/v21.0';

export function isWhatsAppConfigured() {
  return Boolean(
    process.env.WHATSAPP_ACCESS_TOKEN
    && process.env.WHATSAPP_PHONE_NUMBER_ID
  );
}

export function verifyWebhookSignature(rawBody, signatureHeader) {
  const appSecret = process.env.WHATSAPP_APP_SECRET;
  if (!appSecret) return true;

  if (!signatureHeader || !signatureHeader.startsWith('sha256=')) {
    return false;
  }

  const expected = crypto
    .createHmac('sha256', appSecret)
    .update(rawBody)
    .digest('hex');

  const received = signatureHeader.slice('sha256='.length);

  try {
    return crypto.timingSafeEqual(
      Buffer.from(expected, 'hex'),
      Buffer.from(received, 'hex')
    );
  } catch {
    return false;
  }
}

export async function sendWhatsAppText(to, text) {
  if (!isWhatsAppConfigured()) {
    console.warn('[whatsapp] Reply skipped — WHATSAPP_ACCESS_TOKEN or WHATSAPP_PHONE_NUMBER_ID not set');
    return null;
  }

  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  const response = await fetch(`${GRAPH_API}/${phoneNumberId}/messages`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.WHATSAPP_ACCESS_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      to,
      type: 'text',
      text: { body: text },
    }),
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`WhatsApp send failed (${response.status}): ${errorBody}`);
  }

  return response.json();
}

export function extractIncomingMessages(payload) {
  const messages = [];

  const entries = payload?.entry || [];
  entries.forEach((entry) => {
    (entry.changes || []).forEach((change) => {
      const value = change.value;
      (value?.messages || []).forEach((message) => {
        if (message.type === 'text' && message.text?.body) {
          messages.push({
            id: message.id,
            from: message.from,
            timestamp: message.timestamp,
            text: message.text.body,
          });
        }
      });
    });
  });

  return messages;
}

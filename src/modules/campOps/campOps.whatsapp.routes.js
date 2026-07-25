import { Router } from 'express';
import express from 'express';
import { asyncHandler } from '../../utils/helpers.js';
import {
  extractIncomingMessages,
  sendWhatsAppText,
  verifyWebhookSignature,
} from './communications/services/whatsappClient.js';
import { processWhatsAppMessage } from './communications/services/whatsappIngestService.js';
import { WHATSAPP_FORMAT_EXAMPLE } from './communications/utils/whatsappParser.js';

const router = Router();

function captureRawBody(req, res, buf) {
  req.rawBody = buf;
}

router.get('/webhook', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];
  const verifyToken = process.env.WHATSAPP_VERIFY_TOKEN;

  if (mode === 'subscribe' && token && token === verifyToken) {
    return res.status(200).send(challenge);
  }

  return res.status(403).json({ message: 'Webhook verification failed' });
});

router.post(
  '/webhook',
  express.json({ verify: captureRawBody, limit: '1mb' }),
  asyncHandler(async (req, res) => {
    const signature = req.get('X-Hub-Signature-256');
    const rawBody = req.rawBody || Buffer.from(JSON.stringify(req.body || {}));

    if (!verifyWebhookSignature(rawBody, signature)) {
      return res.status(401).json({ message: 'Invalid webhook signature' });
    }

    const payload = req.body?.object ? req.body : JSON.parse(rawBody.toString('utf8'));

    if (payload.object !== 'whatsapp_business_account') {
      return res.sendStatus(200);
    }

    const messages = extractIncomingMessages(payload);
    res.sendStatus(200);

    for (const message of messages) {
      try {
        await processWhatsAppMessage(message);
      } catch (error) {
        console.error('[whatsapp] Failed to process message:', error);
        try {
          await sendWhatsAppText(
            message.from,
            'Something went wrong while saving your camp. Please try again or contact support.',
          );
        } catch (replyError) {
          console.error('[whatsapp] Failed to send error reply:', replyError);
        }
      }
    }
  }),
);

router.get('/format', (_req, res) => {
  res.json({
    data: {
      format: 'key-value lines',
      example: WHATSAPP_FORMAT_EXAMPLE,
      requiredFields: ['Client', 'Date'],
      dateFormat: 'dd/mm/yyyy',
      helpKeyword: 'HELP',
      webhookPath: '/api/v1/ingest/whatsapp/webhook',
    },
  });
});

export default router;

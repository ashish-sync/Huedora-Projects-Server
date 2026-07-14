import { randomBytes } from 'crypto';
import { Agreement } from './agreement.model.js';

export function generateShortCode() {
  return randomBytes(6).toString('base64url').slice(0, 8);
}

export async function ensureRecipientShortCode(agreement) {
  if (!agreement?.recipientAccessToken || agreement.recipientShortCode) {
    return agreement;
  }

  for (let attempt = 0; attempt < 8; attempt += 1) {
    const code = generateShortCode();
    const clash = await Agreement.findOne({ recipientShortCode: code, isDeleted: false });
    if (!clash || String(clash._id) === String(agreement._id)) {
      agreement.recipientShortCode = code;
      await agreement.save();
      return agreement;
    }
  }

  throw new Error('Unable to generate a unique signing link code');
}

export async function findAgreementByAccessKey(key) {
  const accessKey = String(key || '').trim();
  if (!accessKey) return null;

  const byShort = await Agreement.find({ isDeleted: false, recipientShortCode: accessKey });
  if (byShort[0]) return byShort[0];

  const byToken = await Agreement.find({ isDeleted: false, recipientAccessToken: accessKey });
  return byToken[0] || null;
}

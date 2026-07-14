import { randomBytes } from 'crypto';
import { VerificationInvite } from './verification.model.js';

export function generateShortCode() {
  return randomBytes(6).toString('base64url').slice(0, 8);
}

export async function findInviteByAccessKey(key) {
  const accessKey = String(key || '').trim();
  if (!accessKey) return null;

  const byShort = await VerificationInvite.find({
    isDeleted: false,
    shortCode: accessKey,
    status: 'PENDING',
  });
  if (byShort[0]) return byShort[0];

  const byToken = await VerificationInvite.find({
    isDeleted: false,
    accessToken: accessKey,
    status: 'PENDING',
  });
  return byToken[0] || null;
}

export async function createUniqueInviteCodes() {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const accessToken = randomBytes(24).toString('hex');
    const shortCode = generateShortCode();
    const clash = await VerificationInvite.findOne({
      isDeleted: false,
      $or: [{ accessToken }, { shortCode }],
    });
    if (!clash) return { accessToken, shortCode };
  }
  throw new Error('Unable to generate verification link codes');
}

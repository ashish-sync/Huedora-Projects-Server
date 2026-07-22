import { defineCollection } from '../../store/filedb.js';
import { softDelete } from '../common/counter.model.js';

export const VerificationCampaign = defineCollection('verification_campaigns', {
  ...softDelete,
  status: 'OPEN',
  requireRound2: true,
});

export const VerificationRecord = defineCollection('verification_records', {
  ...softDelete,
  quantity: 1,
  status: 'DRAFT',
  round1: {},
  round2: {},
});

/** Secure self-verification link sent to asset holder. */
export const VerificationInvite = defineCollection('verification_invites', {
  ...softDelete,
  recordId: null,
  assetId: null,
  campaignId: null,
  periodKey: '',
  round: 1,
  accessToken: null,
  shortCode: null,
  status: 'PENDING', // PENDING | COMPLETED | EXPIRED | CANCELLED
  holderContactId: null,
  holderName: '',
  holderEmail: '',
  holderPhone: '',
  sentAt: null,
  sentBy: null,
  completedAt: null,
  expiresAt: null,
});

/** Append-only verification audit trail. */
export const VerificationActivity = defineCollection('verification_activities', {
  recordId: null,
  assetId: null,
  campaignId: null,
  periodKey: '',
  round: null,
  action: '', // MANUAL_VERIFY | LINK_SENT | SELF_VERIFY | LINK_CANCELLED | CALL_ATTEMPT
  at: null,
  actorId: null,
  actorEmail: null,
  actorName: null,
  message: '',
  meta: null,
});

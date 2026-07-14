import { defineCollection } from '../../store/filedb.js';
import { softDelete } from '../common/counter.model.js';

/**
 * Asset Agreement = contract envelope + business agreement metadata.
 * Workflow: DRAFT → SENT → PARTIALLY_SIGNED → COMPLETED → ACTIVE → TERMINATED
 */
export const Agreement = defineCollection('agreements', {
  ...softDelete,
  status: 'DRAFT',
  type: 'LEASE',
  title: '',
  partyName: '',
  partyEmail: '',
  partyMobile: '',
  partyContact: '',
  partyState: '',
  partyCity: '',
  contactId: null,
  templateId: null,
  defaultSenderSignatureId: null,
  documentSource: 'TEMPLATE', // TEMPLATE | UPLOAD
  signingType: 'SIGNING', // SIGNING | NON_SIGNING
  deliveryChannels: { email: true, sms: false },
  deliveryStatus: { email: 'SKIPPED', sms: 'SKIPPED' },
  startDate: null,
  endDate: null,
  termsSummary: '',
  bodyHtml: '',
  commercialNotes: '',
  reminderSent: { d30: false, d15: false, d7: false },
  signers: [],
  sentAt: null,
  completedAt: null,
  activatedAt: null,
  declinedAt: null,
  declineReason: null,
  envelopeMessage: '',
  recipientAccessToken: null,
  recipientShortCode: null,
});

export const AgreementAsset = defineCollection('agreement_assets', {
  isActive: true,
  linkedAt: undefined,
  unlinkedAt: null,
});

export const AgreementDocument = defineCollection('agreement_documents', {
  ...softDelete,
  agreementId: null,
  name: '',
  docKind: 'CONTRACT', // CONTRACT | LETTER | FORM | ATTACHMENT
  contentType: 'text/plain',
  sizeBytes: 0,
  storageKey: null,
  textContent: '',
  version: 1,
  isPrimary: false,
});

export const AgreementActivity = defineCollection('agreement_activities', {
  agreementId: null,
  at: null,
  actorId: null,
  actorName: null,
  actorEmail: null,
  action: '',
  message: '',
  meta: null,
});

import { v4 as uuid } from 'uuid';
import { User } from '../users/user.model.js';
import { Contact } from '../contacts/contact.model.js';
import { DocumentTemplate } from '../templates/template.model.js';
import { nextSequence } from '../../utils/counters.js';
import {
  Agreement,
  AgreementActivity,
  AgreementDocument,
} from './agreement.model.js';

export const DOCUMENT_ONE_DEMO = {
  title: 'Demo Document — TYLO One Test Lease',
  partyEmail: 'priya.sharma@citycare.example',
  partyName: 'Priya Sharma',
  partyMobile: '+91 98765 43210',
  contactEmail: 'priya.sharma@citycare.example',
  marker: 'document-one-demo-v1',
};

const DEMO_BODY = `ASSET LEASE AGREEMENT (DEMO)

This is a test / demo document for Document One.

Counterparty: Priya Sharma (City Care Pune)
Purpose: Local QA and Super Admin delete / workflow checks.

1. EQUIPMENT
Demo medical device(s) described for evaluation only.

2. TERM
Demo start and end dates are placeholders and may be edited.

3. CARE & USE
Use only for intended medical evaluation purposes.

4. RETURN
Return equipment when the demo placement ends.

Signed electronically by the parties when sent for signature.`;

/**
 * Dev-only Document One sample agreement (idempotent).
 * Creates contact + DRAFT agreement with a primary text document.
 */
export async function ensureDocumentOneDemo() {
  let contact = await Contact.findOne({
    email: DOCUMENT_ONE_DEMO.contactEmail,
    isDeleted: false,
  });
  if (!contact) {
    contact = await Contact.create({
      name: DOCUMENT_ONE_DEMO.partyName,
      email: DOCUMENT_ONE_DEMO.contactEmail,
      resourceType: 'Full Timer',
      profession: 'Camp Coordinator',
      contact: DOCUMENT_ONE_DEMO.partyMobile,
      mobile: DOCUMENT_ONE_DEMO.partyMobile,
      state: 'Maharashtra',
      city: 'Pune',
    });
  }

  const existing = await Agreement.findOne({
    title: DOCUMENT_ONE_DEMO.title,
    isDeleted: false,
  });
  if (existing) {
    return { created: false, agreementId: existing._id, contactId: contact._id };
  }

  const actor =
    (await User.findOne({ email: 'admin@tylo.local', isDeleted: false })) ||
    (await User.findOne({ systemRole: 'Super Admin', isDeleted: false, isActive: true })) ||
    (await User.findOne({ isDeleted: false, isActive: true }));

  const template =
    (await DocumentTemplate.findOne({
      name: 'Standard Device Lease',
      isDeleted: false,
    })) ||
    (await DocumentTemplate.findOne({
      category: 'AGREEMENT',
      isDeleted: false,
      isActive: true,
    }));

  const actorName = actor?.fullName || actor?.email || 'System Seed';
  const actorEmail = actor?.email || '';
  const actorId = actor?._id || null;

  const agreement = await Agreement.create({
    agreementNumber: await nextSequence('agreementNumber', 'AGR'),
    type: 'LEASE',
    title: DOCUMENT_ONE_DEMO.title,
    partyName: DOCUMENT_ONE_DEMO.partyName,
    partyEmail: DOCUMENT_ONE_DEMO.partyEmail,
    partyMobile: DOCUMENT_ONE_DEMO.partyMobile,
    partyContact: DOCUMENT_ONE_DEMO.partyMobile,
    partyState: contact.state || 'Maharashtra',
    partyCity: contact.city || 'Pune',
    contactId: contact._id,
    templateId: template?._id || null,
    documentSource: template ? 'TEMPLATE' : 'UPLOAD',
    signingType: 'SIGNING',
    deliveryChannels: { email: false, sms: false },
    deliveryStatus: { email: 'SKIPPED', sms: 'SKIPPED' },
    startDate: new Date().toISOString().slice(0, 10),
    endDate: null,
    bodyHtml: DEMO_BODY,
    termsSummary: 'Demo / test Document One lease for local QA.',
    commercialNotes: DOCUMENT_ONE_DEMO.marker,
    envelopeMessage: 'Please review and sign this demo agreement.',
    signers: [
      {
        id: uuid(),
        name: actorName,
        email: actorEmail,
        mobile: actor?.phone || '',
        role: 'SENDER',
        partySide: 'SENDER',
        order: 1,
        status: 'PENDING',
        signedAt: null,
        acknowledgedAt: null,
        signatureType: null,
        signatureData: null,
        ip: null,
      },
      {
        id: uuid(),
        name: DOCUMENT_ONE_DEMO.partyName,
        email: DOCUMENT_ONE_DEMO.partyEmail,
        mobile: DOCUMENT_ONE_DEMO.partyMobile,
        role: 'RECEIVER',
        partySide: 'RECEIVER',
        order: 2,
        status: 'PENDING',
        signedAt: null,
        acknowledgedAt: null,
        signatureType: null,
        signatureData: null,
        ip: null,
      },
    ],
    status: 'DRAFT',
    createdBy: actorId,
    updatedBy: actorId,
  });

  await AgreementDocument.create({
    agreementId: agreement._id,
    name: 'Demo_Document_TYLO_One_Test_Lease.txt',
    docKind: 'CONTRACT',
    contentType: 'text/plain',
    sizeBytes: Buffer.byteLength(DEMO_BODY, 'utf8'),
    storageKey: null,
    textContent: DEMO_BODY,
    version: 1,
    isPrimary: true,
  });

  await AgreementActivity.create({
    agreementId: agreement._id,
    at: new Date().toISOString(),
    actorId,
    actorName,
    actorEmail,
    action: 'CREATED',
    message: `Seeded demo document ${agreement.agreementNumber}`,
    meta: { demoSeed: DOCUMENT_ONE_DEMO.marker },
  });

  return { created: true, agreementId: agreement._id, contactId: contact._id };
}

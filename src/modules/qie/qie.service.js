import { Contact } from '../contacts/contact.model.js';
import { Document } from '../documents/document.model.js';
import { writeAudit } from '../../utils/audit.js';
import { AppError } from '../../utils/helpers.js';
import { QieVerification } from './qieVerification.model.js';
import { runQieAnalysisPhases } from './qiePipeline.js';
import {
  EDUCATIONAL_QIE_DOC_TYPES,
  QIE_HR_ACTIONS,
  QIE_INDICATORS,
  QIE_STATUSES,
  deriveQieIndicator,
  emptyQieSummary,
  pushQieHistory,
  qieSummaryFromRecord,
} from './qieStatus.js';

const queue = [];
let pumping = false;

async function syncContactQieSummary(record) {
  const contactId = String(record.contactId || record.hcwId || '').trim();
  if (!contactId) return;
  const contact = await Contact.findOne({ _id: contactId, isDeleted: false });
  if (!contact) return;

  const summary = qieSummaryFromRecord(record);
  const employeeId = String(record.employeeId || '').trim();

  if (employeeId) {
    const employees = Array.isArray(contact.providerEmployees)
      ? contact.providerEmployees.map((row) => ({ ...row }))
      : [];
    const idx = employees.findIndex((row) => String(row.id || '') === employeeId);
    if (idx >= 0) {
      employees[idx] = {
        ...employees[idx],
        educationalQie: summary,
      };
      contact.providerEmployees = employees;
    }
  } else {
    contact.educationalQie = summary;
  }

  contact.updatedBy = record.updatedBy || contact.updatedBy;
  await contact.save();
}

async function ensureDocumentOneRecord({
  contactId,
  employeeId,
  storedPath,
  objectKey,
  originalName,
  contentType,
  uploadedBy,
}) {
  const existing = await Document.findOne({
    isDeleted: false,
    entityType: 'Contact',
    entityId: String(contactId),
    docType: 'EDUCATIONAL_CERTIFICATE',
    storageKey: objectKey || storedPath,
  });
  if (existing) return existing;

  return Document.create({
    entityType: 'Contact',
    entityId: String(contactId),
    docType: 'EDUCATIONAL_CERTIFICATE',
    originalName: originalName || 'educational-certificate',
    contentType: contentType || 'application/octet-stream',
    sizeBytes: 0,
    storageKey: objectKey || String(storedPath || '').replace(/^\/uploads\//, ''),
    storageProvider: 'LOCAL',
    uploadedBy: uploadedBy || null,
    meta: {
      employeeId: employeeId || '',
      qie: true,
      sourcePath: storedPath || '',
    },
  });
}

async function resolveExpectedHolderName(record) {
  const contact = await Contact.findOne({
    _id: record.contactId || record.hcwId,
    isDeleted: false,
  });
  if (!contact) return '';
  const employeeId = String(record.employeeId || '').trim();
  if (employeeId) {
    const emp = (contact.providerEmployees || []).find((row) => String(row.id || '') === employeeId);
    return String(emp?.name || contact.name || '').trim();
  }
  return String(contact.name || '').trim();
}

async function processVerification(verificationId) {
  const record = await QieVerification.findOne({ _id: verificationId, isDeleted: false });
  if (!record) return;

  const from = record.status;
  record.status = QIE_STATUSES.PROCESSING;
  record.phase = 'processing';
  record.indicator = QIE_INDICATORS.AMBER;
  record.analysisAttempts = Number(record.analysisAttempts || 0) + 1;
  record.lastError = '';
  pushQieHistory(record, {
    action: 'QIE.PROCESSING',
    from,
    to: QIE_STATUSES.PROCESSING,
  });
  await record.save();
  await syncContactQieSummary(record);

  try {
    const expectedHolderName = await resolveExpectedHolderName(record);
    await runQieAnalysisPhases(record, { expectedHolderName });
    record.updatedBy = record.updatedBy || null;
    await record.save();
    await syncContactQieSummary(record);

    await writeAudit({
      actorId: null,
      actorEmail: 'system',
      action: 'QIE.ANALYSIS_COMPLETE',
      entityType: 'QieVerification',
      entityId: record._id,
      after: {
        status: record.status,
        indicator: record.indicator,
        credentialPassed: record.credentialVerification?.passed,
        riskScore: record.risk?.score,
      },
    });
  } catch (err) {
    record.status = QIE_STATUSES.FAILED;
    record.phase = 'failed';
    record.lastError = err?.message || 'QIE analysis failed';
    record.indicator = deriveQieIndicator(record);
    pushQieHistory(record, {
      action: 'QIE.ANALYSIS_FAILED',
      from: QIE_STATUSES.PROCESSING,
      to: QIE_STATUSES.FAILED,
      meta: { error: record.lastError },
    });
    await record.save();
    await syncContactQieSummary(record);
  }
}

async function pumpQueue() {
  if (pumping) return;
  pumping = true;
  try {
    while (queue.length) {
      const job = queue.shift();
      try {
        await processVerification(job.verificationId);
      } catch (err) {
        console.error('[qie] job failed', job.verificationId, err?.message || err);
      }
    }
  } finally {
    pumping = false;
  }
}

export function enqueueQieVerification(verificationId) {
  queue.push({ verificationId: String(verificationId) });
  void pumpQueue();
}

/**
 * Fire-and-forget after successful KYC storage. Never throw to callers.
 */
export async function triggerEducationalQieAfterUpload(payload = {}) {
  try {
    const docType = String(payload.docType || '').trim();
    if (!EDUCATIONAL_QIE_DOC_TYPES.has(docType)) return null;

    const contactId = String(payload.contactId || '').trim();
    const storedPath = String(payload.storedPath || '').trim();
    if (!contactId || !storedPath) return null;

    const employeeId = String(payload.employeeId || '').trim();
    const objectKey = String(payload.objectKey || '').trim();
    const hcwId = employeeId || contactId;

    const document = await ensureDocumentOneRecord({
      contactId,
      employeeId,
      storedPath,
      objectKey,
      originalName: payload.originalName,
      contentType: payload.contentType,
      uploadedBy: payload.actorId,
    });

    // Supersede prior open jobs for the same slot.
    const prior = await QieVerification.find({
      isDeleted: false,
      contactId,
      employeeId: employeeId || '',
      docType,
    });
    for (const row of prior) {
      if (['verified', 'rejected'].includes(row.status)) continue;
      const priorStatus = row.status;
      row.status = QIE_STATUSES.FAILED;
      row.lastError = 'Superseded by newer upload';
      row.indicator = QIE_INDICATORS.AMBER;
      pushQieHistory(row, {
        action: 'QIE.SUPERSEDED',
        from: priorStatus,
        to: QIE_STATUSES.FAILED,
      });
      await row.save();
    }

    const record = await QieVerification.create({
      hcwId,
      contactId,
      employeeId,
      documentId: String(document._id),
      docType,
      storedPath,
      objectKey,
      originalName: payload.originalName || '',
      contentType: payload.contentType || '',
      status: QIE_STATUSES.QUEUED,
      indicator: QIE_INDICATORS.AMBER,
      phase: 'queued',
      extracted: {},
      forensic: {},
      credentialVerification: { passed: false, cleanScanInsufficient: true },
      risk: {},
      hrDecision: {},
      history: [],
      analysisAttempts: 0,
      createdBy: payload.actorId || null,
      updatedBy: payload.actorId || null,
    });

    pushQieHistory(record, {
      action: 'QIE.QUEUED',
      from: '',
      to: QIE_STATUSES.QUEUED,
      actorId: payload.actorId,
      actorEmail: payload.actorEmail,
      meta: { documentId: record.documentId, hcwId },
    });
    await record.save();
    await syncContactQieSummary(record);
    enqueueQieVerification(record._id);

    await writeAudit({
      actorId: payload.actorId || null,
      actorEmail: payload.actorEmail || 'system',
      action: 'QIE.TRIGGERED',
      entityType: 'QieVerification',
      entityId: record._id,
      after: { contactId, employeeId, documentId: record.documentId, docType },
      requestId: payload.requestId,
    });

    return record;
  } catch (err) {
    console.error('[qie] triggerEducationalQieAfterUpload failed (upload unaffected):', err?.message || err);
    return null;
  }
}

export async function getQieVerification(id) {
  const record = await QieVerification.findOne({ _id: id, isDeleted: false });
  if (!record) throw new AppError('QIE verification not found', 404, 'NOT_FOUND');
  record.indicator = deriveQieIndicator(record);
  return record;
}

export async function listQieForContact(contactId) {
  const id = String(contactId || '').trim();
  if (!id) return [];
  const rows = await QieVerification.find({ isDeleted: false, contactId: id }).sort({ updatedAt: -1 });
  return rows.map((row) => {
    row.indicator = deriveQieIndicator(row);
    return row;
  });
}

export async function reanalyzeQieVerification(id, actor = {}) {
  const record = await getQieVerification(id);
  const from = record.status;
  record.status = QIE_STATUSES.QUEUED;
  record.phase = 'queued';
  record.indicator = QIE_INDICATORS.AMBER;
  record.hrDecision = {};
  record.lastError = '';
  record.updatedBy = actor.actorId || null;
  pushQieHistory(record, {
    action: 'QIE.REANALYZE',
    from,
    to: QIE_STATUSES.QUEUED,
    actorId: actor.actorId,
    actorEmail: actor.actorEmail,
  });
  await record.save();
  await syncContactQieSummary(record);
  enqueueQieVerification(record._id);

  await writeAudit({
    actorId: actor.actorId || null,
    actorEmail: actor.actorEmail || '',
    action: 'QIE.REANALYZE',
    entityType: 'QieVerification',
    entityId: record._id,
  });

  return record;
}

export async function applyQieHrDecision(id, { action, notes = '' } = {}, actor = {}) {
  const normalized = String(action || '').trim().toLowerCase();
  if (!Object.values(QIE_HR_ACTIONS).includes(normalized)) {
    throw new AppError(
      `HR action must be one of: ${Object.values(QIE_HR_ACTIONS).join(', ')}`,
      400,
      'VALIDATION_ERROR',
    );
  }

  const record = await getQieVerification(id);
  const credentialPassed = Boolean(record.credentialVerification?.passed);

  if (normalized === QIE_HR_ACTIONS.APPROVE && !credentialPassed) {
    throw new AppError(
      'Cannot approve: credential verification has not passed. A clean AI scan alone is not enough.',
      400,
      'QIE_CREDENTIAL_REQUIRED',
    );
  }

  const from = record.status;
  record.hrDecision = {
    action: normalized,
    notes: String(notes || '').trim(),
    by: actor.actorId || null,
    byEmail: actor.actorEmail || '',
    at: new Date().toISOString(),
  };

  if (normalized === QIE_HR_ACTIONS.APPROVE) {
    record.status = QIE_STATUSES.VERIFIED;
  } else if (normalized === QIE_HR_ACTIONS.REJECT) {
    record.status = QIE_STATUSES.REJECTED;
  } else if (normalized === QIE_HR_ACTIONS.HOLD) {
    record.status = QIE_STATUSES.HELD;
  } else if (normalized === QIE_HR_ACTIONS.ESCALATE) {
    record.status = QIE_STATUSES.ESCALATED;
  }

  record.phase = 'final_decision';
  record.indicator = deriveQieIndicator(record);
  record.updatedBy = actor.actorId || null;
  pushQieHistory(record, {
    action: `QIE.HR_${normalized.toUpperCase()}`,
    from,
    to: record.status,
    actorId: actor.actorId,
    actorEmail: actor.actorEmail,
    meta: { notes: record.hrDecision.notes },
  });
  await record.save();
  await syncContactQieSummary(record);

  await writeAudit({
    actorId: actor.actorId || null,
    actorEmail: actor.actorEmail || '',
    action: `QIE.HR_${normalized.toUpperCase()}`,
    entityType: 'QieVerification',
    entityId: record._id,
    after: { status: record.status, indicator: record.indicator },
  });

  return record;
}

export function contactQieIndicator(contact) {
  if (!contact) return QIE_INDICATORS.GREY;
  if (contact.educationalQie?.indicator) return contact.educationalQie.indicator;
  if (!contact.educationalQualificationUrl) return QIE_INDICATORS.GREY;
  return QIE_INDICATORS.AMBER;
}

export { emptyQieSummary, qieSummaryFromRecord, EDUCATIONAL_QIE_DOC_TYPES };

import { defineCollection } from '../../store/filedb.js';
import { softDelete } from '../common/counter.model.js';

/**
 * QIE – Post-Upload Verification records for Educational Certificates.
 * Append-only history lives on each record; originals stay in R2/local uploads.
 */
export const QieVerification = defineCollection('qie_verifications', {
  ...softDelete,
  /** Healthcare Worker / contact id (Document One entity link uses the same id). */
  hcwId: '',
  contactId: '',
  employeeId: '',
  /** Document One Document._id for the preserved certificate object. */
  documentId: '',
  docType: 'educational_qualification',
  storedPath: '',
  objectKey: '',
  originalName: '',
  contentType: '',
  /** queued | processing | hr_review | verified | rejected | discrepancy | held | escalated | failed */
  status: 'queued',
  /** grey | amber | green | red — UI indicator */
  indicator: 'amber',
  phase: 'queued',
  extracted: {},
  forensic: {},
  credentialVerification: {},
  risk: {},
  hrDecision: {},
  history: [],
  analysisAttempts: 0,
  lastError: '',
  createdBy: null,
  updatedBy: null,
});

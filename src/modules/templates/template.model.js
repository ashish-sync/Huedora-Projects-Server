import { defineCollection } from '../../store/filedb.js';
import { softDelete } from '../common/counter.model.js';

export const DocumentTemplate = defineCollection('document_templates', {
  ...softDelete,
  name: '',
  category: 'AGREEMENT',
  agreementType: 'LEASE',
  documentType: 'LEASE', // LEASE | TEMPORARY_OWNERSHIP | LETTER | OTHER
  signingType: 'SIGNING', // SIGNING | NON_SIGNING
  /** Signature Master id used as default owner/sender mark for this template */
  defaultSenderSignatureId: null,
  /** Snapshot of default sender signature for previews */
  defaultSenderSignature: null, // { name, roleLabel, signatureType, signatureData }
  description: '',
  bodyHtml: '',
  sourceType: 'TEXT', // TEXT | DOCX
  originalFileName: '',
  storageKey: null,
  contentType: 'text/plain',
  placeholders: [], // [{ key, label, type, token, occurrence, inner }]
  isActive: true,
});

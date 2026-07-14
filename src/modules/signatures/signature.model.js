import { defineCollection } from '../../store/filedb.js';
import { softDelete } from '../common/counter.model.js';
import { matchSignatureRole } from './signature.constants.js';

/** Reusable digital signatures for org roles (HR, Finance, etc.) */
export const SignatureMaster = defineCollection('signature_masters', {
  ...softDelete,
  name: '',
  roleLabel: '',
  email: '',
  department: '',
  signatureType: 'DRAWN', // DRAWN | UPLOADED | TYPED
  signatureData: '',
  isActive: true,
  notes: '',
  createdBy: null,
  updatedBy: null,
});

export function normalizeSignaturePayload(body = {}) {
  const raw = String(body.signatureType || 'DRAWN').toUpperCase();
  const signatureType = ['DRAWN', 'UPLOADED', 'TYPED'].includes(raw) ? raw : 'DRAWN';
  const signatureData =
    signatureType === 'TYPED'
      ? String(body.typedName || body.signatureData || body.name || '').trim()
      : String(body.signatureData || '').trim();

  return {
    name: String(body.name || '').trim(),
    roleLabel: matchSignatureRole(body.roleLabel || body.role || body.title || ''),
    email: body.email ? String(body.email).toLowerCase().trim() : '',
    department: String(body.department || '').trim(),
    signatureType,
    signatureData,
    isActive: body.isActive === false || body.isActive === 'false' ? false : true,
    notes: String(body.notes || '').trim(),
  };
}

export function isImageSignature(type, data = '') {
  return (
    type === 'DRAWN' ||
    type === 'UPLOADED' ||
    (typeof data === 'string' && data.startsWith('data:image'))
  );
}

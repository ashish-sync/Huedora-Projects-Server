/**
 * Contact Directory attachments: PAN Card Copy, Bank Account Proof,
 * and Educational Qualification certificates (same file rules).
 */

import {
  toSignedUploadUrl,
  relativeUploadPathFromUrl,
  durableUploadRelativePath,
} from '../files/file.routes.js';

export const CONTACT_KYC_ACCEPT_EXTENSIONS = [
  '.pdf',
  '.jpg',
  '.jpeg',
  '.png',
  '.webp',
  '.gif',
  '.bmp',
  '.tif',
  '.tiff',
];

export const CONTACT_KYC_ACCEPT_ATTR = [
  'application/pdf',
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/webp',
  'image/gif',
  'image/bmp',
  'image/tiff',
  '.pdf',
  '.jpg',
  '.jpeg',
  '.png',
  '.webp',
  '.gif',
  '.bmp',
  '.tif',
  '.tiff',
].join(',');

export const CONTACT_KYC_MAX_BYTES = 10 * 1024 * 1024;

export const CONTACT_KYC_ALLOWED_MIME = new Set([
  'application/pdf',
  'image/jpeg',
  'image/jpg',
  'image/pjpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'image/bmp',
  'image/x-ms-bmp',
  'image/tiff',
  'image/tif',
]);

export function isAllowedContactKycFile({ mimetype = '', originalname = '' } = {}) {
  const mime = String(mimetype || '').toLowerCase().trim();
  if (CONTACT_KYC_ALLOWED_MIME.has(mime) || mime.startsWith('image/')) return true;
  const name = String(originalname || '').toLowerCase();
  return CONTACT_KYC_ACCEPT_EXTENSIONS.some((ext) => name.endsWith(ext));
}

export const CONTACT_KYC_REJECT_MESSAGE =
  'Contact documents must be a PDF or common image (JPG, JPEG, PNG, WEBP, GIF, BMP, TIFF).';

/** Production blocks direct /uploads — return a short-lived signed file URL for View links. */
export function signContactKycUrl(url = '') {
  return toSignedUploadUrl(url);
}

/**
 * Persist only durable `/uploads/...` paths. Ignore signed links / blanks from the SPA
 * so a View/save cycle cannot wipe or replace the stored file key.
 */
export function storageContactKycUrl(clientValue, existingValue = '') {
  const raw = String(clientValue ?? '').trim();
  if (!raw) return existingValue || '';
  // Prefer durable path recovered from a (possibly expired) signed View URL.
  const fromSigned = durableUploadRelativePath(raw);
  if (raw.includes('/files/signed')) {
    if (fromSigned) return `/uploads/${fromSigned}`;
    return existingValue || '';
  }
  const relative = relativeUploadPathFromUrl(raw);
  if (relative) return `/uploads/${relative}`;
  if (raw.startsWith('/uploads/')) return raw;
  return existingValue || '';
}

export function withSignedContactKyc(contact) {
  if (!contact) return contact;
  const obj = contact.toObject ? contact.toObject() : { ...contact };
  const providerEmployees = Array.isArray(obj.providerEmployees)
    ? obj.providerEmployees.map((emp) => ({
        ...emp,
        educationalQualificationUrl: signContactKycUrl(emp?.educationalQualificationUrl),
      }))
    : obj.providerEmployees;
  return {
    ...obj,
    panCardCopyUrl: signContactKycUrl(obj.panCardCopyUrl),
    passbookCopyUrl: signContactKycUrl(obj.passbookCopyUrl),
    aadhaarFrontUrl: signContactKycUrl(obj.aadhaarFrontUrl),
    aadhaarBackUrl: signContactKycUrl(obj.aadhaarBackUrl),
    educationalQualificationUrl: signContactKycUrl(obj.educationalQualificationUrl),
    resumeUrl: signContactKycUrl(obj.resumeUrl),
    providerEmployees,
  };
}

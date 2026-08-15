/**
 * Contact Directory KYC attachments: PAN Card Copy + Bank Account Proof.
 * Accept PDF and common image formats (field keys stay passbookCopyUrl / panCardCopyUrl).
 */

import { toSignedUploadUrl } from '../files/file.routes.js';

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
  'Bank Account Proof and PAN Card Copy must be a PDF or common image (JPG, JPEG, PNG, WEBP, GIF, BMP, TIFF).';

/** Production blocks direct /uploads — return a short-lived signed file URL for View links. */
export function signContactKycUrl(url = '') {
  return toSignedUploadUrl(url);
}

export function withSignedContactKyc(contact) {
  if (!contact) return contact;
  const obj = contact.toObject ? contact.toObject() : { ...contact };
  return {
    ...obj,
    panCardCopyUrl: signContactKycUrl(obj.panCardCopyUrl),
    passbookCopyUrl: signContactKycUrl(obj.passbookCopyUrl),
  };
}

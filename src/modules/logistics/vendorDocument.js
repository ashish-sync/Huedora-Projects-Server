/** Vendor Master PDF attachment helpers. */

export function isPdfUpload(file) {
  if (!file) return false;
  const name = String(file.originalname || file.name || '').toLowerCase();
  const mime = String(file.mimetype || file.type || '').toLowerCase();
  return name.endsWith('.pdf') || mime === 'application/pdf';
}

export function vendorPdfFileRef(file) {
  if (!file) return null;
  return {
    filename: file.filename,
    name: file.originalname,
    url: `/uploads/logistics/vendors/${file.filename}`,
    mimeType: file.mimetype || 'application/pdf',
  };
}

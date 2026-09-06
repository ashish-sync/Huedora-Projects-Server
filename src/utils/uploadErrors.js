/**
 * Upload / Multer user-facing messages (non-import).
 * Keep spreadsheet-specific copy in importErrors.js only.
 */

export function friendlyUploadMessage(errOrMessage, { maxBytes } = {}) {
  const raw =
    typeof errOrMessage === 'string'
      ? errOrMessage
      : errOrMessage?.message || errOrMessage?.code || '';
  const text = String(raw || '').trim();
  const code = String(errOrMessage?.code || '').toUpperCase();
  const mb =
    Number(maxBytes) > 0
      ? Math.round(Number(maxBytes) / (1024 * 1024))
      : Number(process.env.UPLOAD_MAX_BYTES) > 0
        ? Math.round(Number(process.env.UPLOAD_MAX_BYTES) / (1024 * 1024))
        : 10;

  if (code === 'LIMIT_FILE_SIZE' || /LIMIT_FILE_SIZE|file too large|too large/i.test(text)) {
    return `This file is larger than ${mb} MB. Choose a smaller file and try again.`;
  }
  if (code === 'LIMIT_UNEXPECTED_FILE' || /unexpected field|unexpected file/i.test(text)) {
    return 'The upload field was not recognized. Refresh the page and try again.';
  }
  if (code === 'LIMIT_FILE_COUNT' || /too many files/i.test(text)) {
    return 'Too many files in one upload. Remove some files and try again.';
  }
  if (/file type not allowed|not allowed|unsupported/i.test(text)) {
    return text.length > 8 ? text : 'This file type is not allowed for this upload.';
  }
  if (text && text.length >= 8 && !/^multer/i.test(text)) return text;
  return 'The file could not be uploaded. Check the type and size, then try again.';
}

export function isTabularImportPath(req) {
  const pathHint = String(req?.originalUrl || req?.path || '');
  return /\/import\b|\/imports\b|pin-codes\/import|excel\/import|master.*import|tabular|spreadsheet/i.test(
    pathHint,
  );
}

/** Business labels for Operations Dashboard module-review rows (export + API). */

export function personStatusLabel(isActive) {
  return isActive === false ? 'Not signing in' : 'Active';
}

export function importKindLabel(job = {}) {
  const type = String(job.type || job.importType || '').toUpperCase();
  const mode = String(job.mode || '').toUpperCase();
  const checked = mode === 'DRY_RUN' || /DRY/.test(type);
  if (type.includes('VERIFICATION')) {
    return checked ? 'Checked a verification file' : 'Saved verification rows';
  }
  if (type.includes('INVENTORY') || type.includes('ASSET')) {
    return checked ? 'Checked an asset register file' : 'Saved asset register rows';
  }
  return checked ? 'Checked a spreadsheet' : 'Saved spreadsheet rows';
}

export function importStatusLabel(status) {
  const raw = String(status || '').toUpperCase();
  if (raw === 'SUCCEEDED' || raw === 'SUCCESS' || raw === 'COMPLETED') return 'Completed';
  if (raw === 'FAILED' || raw === 'FAIL' || raw === 'ERROR') return 'Needs attention';
  if (raw === 'RUNNING') return 'In progress';
  if (raw === 'QUEUED') return 'Waiting';
  return raw ? raw.charAt(0) + raw.slice(1).toLowerCase() : 'Recorded';
}

export function notificationReadLabel(readAt) {
  return readAt ? 'Seen' : 'Waiting';
}

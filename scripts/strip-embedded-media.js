/**
 * One-shot backfill: strip embedded media from commercial builderForm and sanitize audit snapshots.
 * Usage: node scripts/strip-embedded-media.js [--dry-run]
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { sanitizeAuditSnapshot, stripBuilderFormMedia } from '../src/utils/stripEmbeddedMedia.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.resolve(__dirname, '../data');
const dryRun = process.argv.includes('--dry-run');

function readJson(name) {
  const p = path.join(dataDir, `${name}.json`);
  if (!fs.existsSync(p)) return { path: p, rows: [] };
  const raw = fs.readFileSync(p, 'utf8');
  return { path: p, rows: JSON.parse(raw), bytesBefore: raw.length };
}

function writeJson(filePath, rows, { compact = true } = {}) {
  const json = compact ? JSON.stringify(rows) : JSON.stringify(rows, null, 2);
  const tmp = `${filePath}.tmp.${process.pid}`;
  fs.writeFileSync(tmp, json);
  fs.renameSync(tmp, filePath);
  return json.length;
}

function fmtMb(n) {
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function stripCommercial() {
  const { path: filePath, rows, bytesBefore = 0 } = readJson('finance_commercial_documents');
  let touched = 0;
  for (const row of rows) {
    if (!row?.builderForm || typeof row.builderForm !== 'object') continue;
    const next = stripBuilderFormMedia(row.builderForm);
    const before = JSON.stringify(row.builderForm).length;
    const after = JSON.stringify(next).length;
    if (after < before) {
      row.builderForm = next;
      touched += 1;
    }
  }
  console.log(`[commercial] ${rows.length} docs, ${touched} builderForm(s) stripped`);
  if (!dryRun && touched) {
    const bytesAfter = writeJson(filePath, rows, { compact: true });
    console.log(`[commercial] ${fmtMb(bytesBefore)} → ${fmtMb(bytesAfter)}`);
  } else if (dryRun) {
    console.log(`[commercial] dry-run (was ${fmtMb(bytesBefore)})`);
  }
}

function sanitizeAudits() {
  const { path: filePath, rows, bytesBefore = 0 } = readJson('audit_logs');
  let touched = 0;
  for (const row of rows) {
    const beforeLen = JSON.stringify(row).length;
    if (row.before != null) row.before = sanitizeAuditSnapshot(row.before);
    if (row.after != null) row.after = sanitizeAuditSnapshot(row.after);
    const afterLen = JSON.stringify(row).length;
    if (afterLen < beforeLen) touched += 1;
  }
  console.log(`[audit_logs] ${rows.length} rows, ${touched} snapshot(s) reduced`);
  if (!dryRun && rows.length) {
    const bytesAfter = writeJson(filePath, rows, { compact: true });
    console.log(`[audit_logs] ${fmtMb(bytesBefore)} → ${fmtMb(bytesAfter)}`);
  } else if (dryRun) {
    console.log(`[audit_logs] dry-run (was ${fmtMb(bytesBefore)})`);
  }
}

console.log(`[strip-embedded-media] dataDir=${dataDir} dryRun=${dryRun}`);
stripCommercial();
sanitizeAudits();
console.log('[strip-embedded-media] done');

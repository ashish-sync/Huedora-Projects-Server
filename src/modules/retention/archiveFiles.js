import fs from 'fs';
import path from 'path';
import { createGzip, createGunzip } from 'zlib';
import { pipeline } from 'stream/promises';
import { createReadStream, createWriteStream } from 'fs';
import { uploadsRoot, uploadDir } from '../../config/paths.js';
import { ARCHIVE_MIN_FILE_BYTES } from './archivePolicy.js';

function safeRel(p) {
  const s = String(p || '').replace(/\\/g, '/').replace(/^\/+/, '');
  if (!s || s.includes('..')) return '';
  return s;
}

/** Resolve a stored path/URL to an absolute file under uploadsRoot when possible. */
export function resolveUploadAbs(stored) {
  const raw = String(stored || '').trim();
  if (!raw) return null;
  if (path.isAbsolute(raw) && raw.startsWith(uploadsRoot)) return raw;
  const cleaned = raw.replace(/^\/?uploads\//i, '');
  const rel = safeRel(cleaned);
  if (!rel) return null;
  return path.join(uploadsRoot, rel);
}

function toUploadsRel(absPath) {
  const rel = path.relative(uploadsRoot, absPath).replace(/\\/g, '/');
  if (!rel || rel.startsWith('..')) return '';
  return rel;
}

async function gzipFile(srcAbs, destAbs) {
  await fs.promises.mkdir(path.dirname(destAbs), { recursive: true });
  await pipeline(createReadStream(srcAbs), createGzip(), createWriteStream(destAbs));
}

async function gunzipFile(srcAbs, destAbs) {
  await fs.promises.mkdir(path.dirname(destAbs), { recursive: true });
  await pipeline(createReadStream(srcAbs), createGunzip(), createWriteStream(destAbs));
}

/**
 * Collect candidate absolute paths from common attachment shapes on a document.
 */
export function collectAttachmentCandidates(row = {}) {
  const out = [];
  const push = (v) => {
    if (!v) return;
    if (typeof v === 'string') {
      out.push(v);
      return;
    }
    if (typeof v === 'object') {
      for (const k of ['storageKey', 'storedName', 'path', 'url', 'attachmentUrl', 'filePath']) {
        if (v[k]) out.push(v[k]);
      }
    }
  };

  push(row.storageKey);
  push(row.attachmentUrl);
  push(row.attachmentStoredName);
  if (Array.isArray(row.attachments)) row.attachments.forEach(push);
  if (Array.isArray(row.executionDocuments)) row.executionDocuments.forEach(push);
  push(row.productImage);
  push(row.billAttachment);
  push(row.requestAttachment);
  push(row.jdAttachment);

  return [...new Set(out.map(String).filter(Boolean))];
}

/**
 * Move+gzip large attachments into uploads/archive/{yyyy}/{entityType}/{id}/.
 * Returns updated metadata; does not mutate legal/finance paths when skipCompress is true.
 */
export async function compressAttachmentsForArchive(row, { entityType, skipCompress = false } = {}) {
  if (skipCompress) {
    return { archiveBundleKey: '', archivedAttachmentPaths: [], moved: 0 };
  }

  const id = String(row._id || 'unknown');
  const year = new Date().getUTCFullYear();
  const bundleRel = path.join('archive', String(year), entityType, id).replace(/\\/g, '/');
  const bundleAbs = uploadDir('archive', String(year), entityType, id);
  await fs.promises.mkdir(bundleAbs, { recursive: true });

  const archivedAttachmentPaths = [];
  let moved = 0;

  for (const candidate of collectAttachmentCandidates(row)) {
    const srcAbs = resolveUploadAbs(candidate);
    if (!srcAbs || !fs.existsSync(srcAbs)) continue;
    let stat;
    try {
      stat = await fs.promises.stat(srcAbs);
    } catch {
      continue;
    }
    if (!stat.isFile() || stat.size < ARCHIVE_MIN_FILE_BYTES) continue;

    const base = path.basename(srcAbs);
    const destAbs = path.join(bundleAbs, `${base}.gz`);
    try {
      await gzipFile(srcAbs, destAbs);
      await fs.promises.unlink(srcAbs);
      archivedAttachmentPaths.push({
        originalRel: toUploadsRel(srcAbs) || safeRel(candidate.replace(/^\/?uploads\//i, '')),
        archivedRel: toUploadsRel(destAbs),
        originalRef: candidate,
      });
      moved += 1;
    } catch (err) {
      console.error('[retention] compress failed:', srcAbs, err.message);
    }
  }

  return {
    archiveBundleKey: moved ? bundleRel : '',
    archivedAttachmentPaths,
    moved,
  };
}

/** Restore gzipped attachments from archiveBundleKey mapping. */
export async function restoreArchivedAttachments(row) {
  const entries = Array.isArray(row.archivedAttachmentPaths) ? row.archivedAttachmentPaths : [];
  let restored = 0;
  for (const entry of entries) {
    const srcAbs = resolveUploadAbs(entry.archivedRel);
    const destAbs = resolveUploadAbs(entry.originalRel);
    if (!srcAbs || !destAbs || !fs.existsSync(srcAbs)) continue;
    try {
      await gunzipFile(srcAbs, destAbs);
      await fs.promises.unlink(srcAbs);
      restored += 1;
    } catch (err) {
      console.error('[retention] restore failed:', entry.archivedRel, err.message);
    }
  }
  row.archiveBundleKey = '';
  row.archivedAttachmentPaths = [];
  return { restored };
}

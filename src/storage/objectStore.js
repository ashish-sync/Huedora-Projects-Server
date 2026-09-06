import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  HeadBucketCommand,
  DeleteObjectCommand,
  CopyObjectCommand,
} from '@aws-sdk/client-s3';
import fs from 'fs';
import { getR2Env, describeR2Config } from './r2Env.js';

/** Cloudflare R2 Infrequent Access (verified: docs support STANDARD + STANDARD_IA). */
export const R2_STORAGE_STANDARD = 'STANDARD';
export const R2_STORAGE_IA = 'STANDARD_IA';

function normalizeStorageClass(storageClass) {
  const raw = String(storageClass || '').trim().toUpperCase();
  if (raw === R2_STORAGE_IA || raw === 'INTELLIGENT_TIERING') return R2_STORAGE_IA;
  return R2_STORAGE_STANDARD;
}

let client = null;
let clientKey = '';
let lastProbe = null;

function buildClient(cfg = getR2Env()) {
  if (!cfg.enabled) return null;
  const key = `${cfg.endpoint}|${cfg.accessKeyId}|${cfg.region}|${cfg.bucket}`;
  if (client && clientKey === key) return client;
  // AWS SDK JS ≥3.729 defaults to CRC32 checksums that Cloudflare R2 rejects on PutObject.
  // HeadBucket still succeeds, so /ready can look healthy while uploads fail to land.
  // See: https://developers.cloudflare.com/r2/examples/aws/aws-sdk-js-v3/
  client = new S3Client({
    region: cfg.region || 'auto',
    endpoint: cfg.endpoint,
    credentials: {
      accessKeyId: cfg.accessKeyId,
      secretAccessKey: cfg.secretAccessKey,
    },
    forcePathStyle: true,
    requestChecksumCalculation: 'WHEN_REQUIRED',
    responseChecksumValidation: 'WHEN_REQUIRED',
  });
  clientKey = key;
  return client;
}

export function isObjectStoreEnabled() {
  return getR2Env().enabled;
}

export function resetObjectStoreClientForTests() {
  client = null;
  clientKey = '';
  lastProbe = null;
}

/**
 * Upload a local file to R2 under objectKey (forward-slash relative path).
 * @param {string} absPath
 * @param {string} objectKey
 * @param {{ contentType?: string }} [opts]
 */
export async function putLocalFile(absPath, objectKey, opts = {}) {
  const cfg = getR2Env();
  if (!cfg.enabled) return { skipped: true };
  const s3 = buildClient(cfg);
  const stat = fs.statSync(absPath);
  // Prefer a buffer for typical masters (execution docs / photos) so PutObject
  // cannot race a concurrent rename/unlink against a streaming Body.
  const body =
    stat.size <= 25 * 1024 * 1024 ? fs.readFileSync(absPath) : fs.createReadStream(absPath);
  const storageClass = normalizeStorageClass(opts.storageClass);
  await s3.send(
    new PutObjectCommand({
      Bucket: cfg.bucket,
      Key: objectKey,
      Body: body,
      ContentLength: stat.size,
      ContentType: opts.contentType || undefined,
      StorageClass: storageClass,
    }),
  );
  return { ok: true, key: objectKey, bucket: cfg.bucket, storageClass };
}

/**
 * Upload a buffer to R2.
 * @param {Buffer} buffer
 * @param {string} objectKey
 * @param {{ contentType?: string }} [opts]
 */
export async function putBuffer(buffer, objectKey, opts = {}) {
  const cfg = getR2Env();
  if (!cfg.enabled) return { skipped: true };
  const s3 = buildClient(cfg);
  const storageClass = normalizeStorageClass(opts.storageClass);
  await s3.send(
    new PutObjectCommand({
      Bucket: cfg.bucket,
      Key: objectKey,
      Body: buffer,
      ContentType: opts.contentType || undefined,
      ContentLength: buffer.length,
      StorageClass: storageClass,
    }),
  );
  return { ok: true, key: objectKey, bucket: cfg.bucket, storageClass };
}

/**
 * Change storage class in-place (same key) via CopyObject.
 * R2 docs: CopyObject + x-amz-storage-class STANDARD | STANDARD_IA.
 * @param {string} objectKey
 * @param {'STANDARD'|'STANDARD_IA'} storageClass
 * @param {{ contentType?: string }} [opts]
 */
export async function copyObjectStorageClass(objectKey, storageClass, opts = {}) {
  const cfg = getR2Env();
  if (!cfg.enabled) return { skipped: true };
  const key = String(objectKey || '').replace(/^\/+/, '');
  if (!key) throw new Error('Invalid object key');
  const targetClass = normalizeStorageClass(storageClass);
  const s3 = buildClient(cfg);
  const params = {
    Bucket: cfg.bucket,
    Key: key,
    CopySource: `/${cfg.bucket}/${key}`,
    StorageClass: targetClass,
    MetadataDirective: 'COPY',
  };
  if (opts.contentType) {
    params.ContentType = opts.contentType;
    params.MetadataDirective = 'REPLACE';
  }
  await s3.send(new CopyObjectCommand(params));
  const head = await headObject(key);
  const reported = normalizeStorageClass(head?.StorageClass || targetClass);
  return {
    ok: true,
    key,
    storageClass: reported,
    verified: reported === targetClass || !head?.StorageClass,
    contentLength: head?.ContentLength ?? null,
  };
}

export async function getObject(objectKey) {
  const cfg = getR2Env();
  if (!cfg.enabled) return null;
  const s3 = buildClient(cfg);
  return s3.send(
    new GetObjectCommand({
      Bucket: cfg.bucket,
      Key: objectKey,
    }),
  );
}

export async function headObject(objectKey) {
  const cfg = getR2Env();
  if (!cfg.enabled) return null;
  const s3 = buildClient(cfg);
  try {
    return await s3.send(
      new HeadObjectCommand({
        Bucket: cfg.bucket,
        Key: objectKey,
      }),
    );
  } catch (err) {
    const status = err?.$metadata?.httpStatusCode || err?.statusCode;
    if (status === 404 || err?.name === 'NotFound' || err?.Code === 'NotFound') {
      return null;
    }
    throw err;
  }
}

export async function deleteObject(objectKey) {
  const cfg = getR2Env();
  if (!cfg.enabled) return { skipped: true };
  const s3 = buildClient(cfg);
  await s3.send(
    new DeleteObjectCommand({
      Bucket: cfg.bucket,
      Key: objectKey,
    }),
  );
  return { ok: true };
}

/**
 * Connectivity probe — HeadBucket only. Never returns secrets.
 * Caches result briefly for readiness checks.
 */
export async function probeObjectStore({ force = false } = {}) {
  const cfg = getR2Env();
  const summary = describeR2Config(cfg);
  if (!cfg.enabled) {
    lastProbe = {
      ok: false,
      enabled: false,
      reason: cfg.credentialProblem
        || (cfg.missing.length
          ? `R2 not configured (missing: ${cfg.missing.join(', ')})`
          : 'R2 disabled'),
      ...summary,
      checkedAt: new Date().toISOString(),
    };
    return lastProbe;
  }

  if (
    !force &&
    lastProbe &&
    lastProbe.enabled &&
    lastProbe.checkedAt &&
    Date.now() - Date.parse(lastProbe.checkedAt) < 30_000
  ) {
    return lastProbe;
  }

  try {
    const s3 = buildClient(cfg);
    await s3.send(new HeadBucketCommand({ Bucket: cfg.bucket }));
    lastProbe = {
      ok: true,
      enabled: true,
      reason: null,
      ...summary,
      checkedAt: new Date().toISOString(),
    };
  } catch (err) {
    const code = err?.name || err?.Code || err?.code || 'R2_ERROR';
    const status = err?.$metadata?.httpStatusCode || err?.statusCode || null;
    lastProbe = {
      ok: false,
      enabled: true,
      reason: `${code}${status ? ` (${status})` : ''}: ${err?.message || 'HeadBucket failed'}`,
      ...summary,
      checkedAt: new Date().toISOString(),
    };
  }
  return lastProbe;
}

/**
 * Write probe: PutObject + HeadObject + DeleteObject of a tiny marker.
 * Catches R2 write failures that HeadBucket misses (checksum / ACL / permission).
 * Never returns object body or secrets.
 */
export async function probeObjectStoreWrite({ force = false } = {}) {
  const cfg = getR2Env();
  const summary = describeR2Config(cfg);
  if (!cfg.enabled) {
    return {
      ok: false,
      enabled: false,
      reason: cfg.credentialProblem || 'R2 disabled',
      ...summary,
      checkedAt: new Date().toISOString(),
    };
  }

  const objectKey = `_tylo-health/write-probe.txt`;
  const body = Buffer.from(`tylo-r2-write-probe ${new Date().toISOString()}\n`, 'utf8');
  try {
    const s3 = buildClient(cfg);
    await s3.send(
      new PutObjectCommand({
        Bucket: cfg.bucket,
        Key: objectKey,
        Body: body,
        ContentLength: body.length,
        ContentType: 'text/plain',
      }),
    );
    const head = await s3.send(
      new HeadObjectCommand({
        Bucket: cfg.bucket,
        Key: objectKey,
      }),
    );
    await s3.send(
      new DeleteObjectCommand({
        Bucket: cfg.bucket,
        Key: objectKey,
      }),
    );
    return {
      ok: true,
      enabled: true,
      reason: null,
      probeKey: objectKey,
      bytes: Number(head?.ContentLength) || body.length,
      ...summary,
      checkedAt: new Date().toISOString(),
    };
  } catch (err) {
    const code = err?.name || err?.Code || err?.code || 'R2_ERROR';
    const status = err?.$metadata?.httpStatusCode || err?.statusCode || null;
    return {
      ok: false,
      enabled: true,
      reason: `${code}${status ? ` (${status})` : ''}: ${err?.message || 'PutObject write probe failed'}`,
      probeKey: objectKey,
      ...summary,
      checkedAt: new Date().toISOString(),
    };
  }
}

export function getLastObjectStoreProbe() {
  return lastProbe;
}

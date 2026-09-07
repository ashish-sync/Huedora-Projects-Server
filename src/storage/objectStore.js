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
import path from 'path';
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
  // Always stream from disk — never hold a second full-file Buffer for PutObject.
  const body = fs.createReadStream(absPath);
  const storageClass = normalizeStorageClass(opts.storageClass);
  try {
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
  } finally {
    if (typeof body.destroy === 'function') body.destroy();
  }
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

/**
 * Server-side copy between keys (no body through Node heap).
 * Used to promote a direct-upload temp WebP to its semantic final key.
 */
export async function copyObjectToKey(fromKey, toKey, opts = {}) {
  const cfg = getR2Env();
  if (!cfg.enabled) return { skipped: true };
  const from = String(fromKey || '').replace(/^\/+/, '');
  const to = String(toKey || '').replace(/^\/+/, '');
  if (!from || !to) throw new Error('Invalid object key for copy');
  const s3 = buildClient(cfg);
  const storageClass = normalizeStorageClass(opts.storageClass);
  const params = {
    Bucket: cfg.bucket,
    Key: to,
    CopySource: `/${cfg.bucket}/${from}`,
    StorageClass: storageClass,
    MetadataDirective: 'COPY',
  };
  if (opts.contentType) {
    params.ContentType = opts.contentType;
    params.MetadataDirective = 'REPLACE';
  }
  await s3.send(new CopyObjectCommand(params));
  const head = await headObject(to);
  if (!head) throw new Error(`R2 HeadObject missing after CopyObject for ${to}`);
  return {
    ok: true,
    from,
    to,
    contentLength: Number(head.ContentLength) || null,
    contentType: head.ContentType || opts.contentType || null,
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

/**
 * Stream an R2 object to a local file without buffering the whole body in RAM.
 * @param {string} objectKey
 * @param {string} absPath
 */
export async function getObjectToFile(objectKey, absPath) {
  const cfg = getR2Env();
  if (!cfg.enabled) throw new Error('Object store is not enabled');
  const s3 = buildClient(cfg);
  const res = await s3.send(
    new GetObjectCommand({
      Bucket: cfg.bucket,
      Key: objectKey,
    }),
  );
  fs.mkdirSync(path.dirname(absPath), { recursive: true });
  await new Promise((resolve, reject) => {
    const out = fs.createWriteStream(absPath);
    const body = res.Body;
    if (!body || typeof body.pipe !== 'function') {
      reject(new Error('R2 GetObject returned a non-stream body'));
      return;
    }
    body.pipe(out);
    out.on('finish', resolve);
    out.on('error', reject);
    body.on?.('error', reject);
  });
  return {
    ok: true,
    key: objectKey,
    contentType: res.ContentType || null,
    sizeBytes: fs.statSync(absPath).size,
  };
}

/**
 * Browser → R2 direct PUT via S3-compatible presigned URL.
 * Requires R2 bucket CORS to allow PUT from the app origin.
 * @param {string} objectKey
 * @param {{ contentType?: string, expiresIn?: number }} [opts]
 */
export async function createPresignedPutUrl(objectKey, opts = {}) {
  const cfg = getR2Env();
  if (!cfg.enabled) {
    const err = new Error('Direct cloud upload is not configured');
    err.code = 'DIRECT_UPLOAD_UNAVAILABLE';
    throw err;
  }
  const key = String(objectKey || '').replace(/^\/+/, '');
  if (!key) throw new Error('Invalid object key');
  const s3 = buildClient(cfg);
  const { getSignedUrl } = await import('@aws-sdk/s3-request-presigner');
  const contentType = opts.contentType || 'application/octet-stream';
  const expiresIn = Math.min(900, Math.max(60, Number(opts.expiresIn) || 600));
  const command = new PutObjectCommand({
    Bucket: cfg.bucket,
    Key: key,
    ContentType: contentType,
    StorageClass: normalizeStorageClass(opts.storageClass),
  });
  const uploadUrl = await getSignedUrl(s3, command, { expiresIn });
  return {
    uploadUrl,
    objectKey: key,
    bucket: cfg.bucket,
    expiresIn,
    headers: {
      'Content-Type': contentType,
    },
  };
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

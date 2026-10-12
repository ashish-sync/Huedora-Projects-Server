/**
 * Cloudflare R2 (S3-compatible) config from Render / process env.
 * Secrets are never logged — only presence / bucket / endpoint host / key lengths.
 */

function trim(v) {
  return String(v || '').trim();
}

/** Strip wrapping quotes / accidental Bearer prefix from dashboard paste. */
function cleanSecret(v) {
  let s = trim(v);
  if (
    (s.startsWith('"') && s.endsWith('"')) ||
    (s.startsWith("'") && s.endsWith("'"))
  ) {
    s = s.slice(1, -1).trim();
  }
  if (/^bearer\s+/i.test(s)) s = s.replace(/^bearer\s+/i, '').trim();
  return s;
}

function flagTrue(v) {
  return ['1', 'true', 'yes', 'on'].includes(String(v || '').trim().toLowerCase());
}

function flagFalse(v) {
  return ['0', 'false', 'no', 'off'].includes(String(v || '').trim().toLowerCase());
}

/** R2 S3 Access Key ID is 32 chars; Cloudflare API tokens are longer (e.g. 40–53). */
export const R2_ACCESS_KEY_ID_EXPECTED_LENGTH = 32;

/**
 * Environment object-key prefix so QA and Prod can share one bucket without colliding.
 * - Set R2_KEY_PREFIX explicitly (e.g. env/qa/) to override.
 * - Set R2_KEY_PREFIX= (empty) to disable prefixing.
 * - Otherwise auto: qa → env/qa/, production → env/prod/, else none.
 */
export function resolveR2KeyPrefix(nodeEnv = process.env.NODE_ENV) {
  if (Object.prototype.hasOwnProperty.call(process.env, 'R2_KEY_PREFIX')) {
    const raw = String(process.env.R2_KEY_PREFIX ?? '')
      .trim()
      .replace(/\\/g, '/')
      .replace(/^\/+|\/+$/g, '');
    return raw ? `${raw}/` : '';
  }
  const envName = String(nodeEnv || '')
    .trim()
    .toLowerCase();
  if (envName === 'qa') return 'env/qa/';
  if (envName === 'production' || envName === 'prod') return 'env/prod/';
  return '';
}

/**
 * Apply the env prefix for new writes. Idempotent if key already starts with the prefix.
 * @param {string} objectKey
 * @param {string} [prefix]
 */
export function applyR2KeyPrefix(objectKey, prefix = resolveR2KeyPrefix()) {
  const key = String(objectKey || '')
    .replace(/\\/g, '/')
    .replace(/^\/+/, '');
  if (!key) return '';
  const p = String(prefix || '');
  if (!p) return key;
  if (key.startsWith(p)) return key;
  return `${p}${key}`;
}

/**
 * Read candidates: prefixed key first, then legacy unprefixed (prod migration safety).
 * @param {string} objectKey
 * @param {string} [prefix]
 */
export function r2KeyReadCandidates(objectKey, prefix = resolveR2KeyPrefix()) {
  const key = String(objectKey || '')
    .replace(/\\/g, '/')
    .replace(/^\/+/, '');
  if (!key) return [];
  const p = String(prefix || '');
  if (!p) return [key];
  if (key.startsWith(p)) return [key];
  return [`${p}${key}`, key];
}

/**
 * @returns {{
 *   enabled: boolean,
 *   required: boolean,
 *   accountId: string,
 *   accessKeyId: string,
 *   secretAccessKey: string,
 *   bucket: string,
 *   endpoint: string,
 *   region: string,
 *   publicBaseUrl: string,
 *   keyPrefix: string,
 *   missing: string[],
 *   credentialProblem: string | null,
 * }}
 */
export function getR2Env() {
  const accountId = cleanSecret(process.env.R2_ACCOUNT_ID || process.env.CLOUDFLARE_ACCOUNT_ID);
  const accessKeyId = cleanSecret(process.env.R2_ACCESS_KEY_ID || process.env.AWS_ACCESS_KEY_ID);
  const secretAccessKey = cleanSecret(
    process.env.R2_SECRET_ACCESS_KEY || process.env.AWS_SECRET_ACCESS_KEY,
  );
  const bucket =
    cleanSecret(process.env.R2_BUCKET || process.env.R2_BUCKET_NAME || process.env.AWS_S3_BUCKET) ||
    'tylo-one-files';
  const endpointExplicit = cleanSecret(process.env.R2_ENDPOINT || process.env.AWS_ENDPOINT_URL);
  const endpoint =
    endpointExplicit ||
    (accountId ? `https://${accountId}.r2.cloudflarestorage.com` : '');
  const region = cleanSecret(process.env.R2_REGION || process.env.AWS_REGION) || 'auto';
  const publicBaseUrl = cleanSecret(process.env.R2_PUBLIC_BASE_URL).replace(/\/+$/, '');
  const required = flagTrue(process.env.R2_REQUIRED);
  const keyPrefix = resolveR2KeyPrefix();

  const missing = [];
  if (!accountId && !endpointExplicit) missing.push('R2_ACCOUNT_ID (or R2_ENDPOINT)');
  if (!accessKeyId) missing.push('R2_ACCESS_KEY_ID');
  if (!secretAccessKey) missing.push('R2_SECRET_ACCESS_KEY');
  if (!bucket) missing.push('R2_BUCKET');
  if (!endpoint) missing.push('R2_ENDPOINT');

  let credentialProblem = null;
  if (accessKeyId && accessKeyId.length !== R2_ACCESS_KEY_ID_EXPECTED_LENGTH) {
    credentialProblem =
      `R2_ACCESS_KEY_ID length is ${accessKeyId.length} (expected ${R2_ACCESS_KEY_ID_EXPECTED_LENGTH}). ` +
      'This looks like a Cloudflare API token, not an R2 S3 Access Key ID. ' +
      'In Cloudflare go to R2 → Manage R2 API Tokens → Create API token, then paste the ' +
      '32-character Access Key ID into R2_ACCESS_KEY_ID and the Secret Access Key into R2_SECRET_ACCESS_KEY on Render.';
  }

  const hasCreds = Boolean(accessKeyId && secretAccessKey && endpoint && bucket);
  let enabled = hasCreds && !credentialProblem;
  if (flagFalse(process.env.R2_ENABLED)) enabled = false;
  else if (flagTrue(process.env.R2_ENABLED)) enabled = hasCreds && !credentialProblem;

  return {
    enabled,
    required,
    accountId,
    accessKeyId,
    secretAccessKey,
    bucket,
    endpoint,
    region,
    publicBaseUrl,
    keyPrefix,
    missing: hasCreds ? [] : missing,
    credentialProblem,
  };
}

/** Safe summary for logs / readiness (no secrets). */
export function describeR2Config(cfg = getR2Env()) {
  let endpointHost = '';
  try {
    endpointHost = cfg.endpoint ? new URL(cfg.endpoint).host : '';
  } catch {
    endpointHost = '(invalid endpoint)';
  }
  const keyPrefix = cfg.keyPrefix || '';
  return {
    enabled: cfg.enabled,
    required: cfg.required,
    bucket: cfg.bucket || null,
    endpointHost: endpointHost || null,
    keyPrefix: keyPrefix || null,
    isolationActive: Boolean(keyPrefix),
    hasAccountId: Boolean(cfg.accountId),
    hasAccessKeyId: Boolean(cfg.accessKeyId),
    hasSecretAccessKey: Boolean(cfg.secretAccessKey),
    /** Length only — never the key value. */
    accessKeyIdLength: cfg.accessKeyId ? cfg.accessKeyId.length : 0,
    secretAccessKeyLength: cfg.secretAccessKey ? cfg.secretAccessKey.length : 0,
    accessKeyIdExpectedLength: R2_ACCESS_KEY_ID_EXPECTED_LENGTH,
    credentialProblem: cfg.credentialProblem || null,
    missing: cfg.missing,
  };
}

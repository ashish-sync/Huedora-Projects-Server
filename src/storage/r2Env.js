/**
 * Cloudflare R2 (S3-compatible) config from Render / process env.
 * Secrets are never logged — only presence / bucket / endpoint host.
 */

function trim(v) {
  return String(v || '').trim();
}

function flagTrue(v) {
  return ['1', 'true', 'yes', 'on'].includes(String(v || '').trim().toLowerCase());
}

function flagFalse(v) {
  return ['0', 'false', 'no', 'off'].includes(String(v || '').trim().toLowerCase());
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
 *   missing: string[],
 * }}
 */
export function getR2Env() {
  const accountId = trim(process.env.R2_ACCOUNT_ID || process.env.CLOUDFLARE_ACCOUNT_ID);
  const accessKeyId = trim(process.env.R2_ACCESS_KEY_ID || process.env.AWS_ACCESS_KEY_ID);
  const secretAccessKey = trim(
    process.env.R2_SECRET_ACCESS_KEY || process.env.AWS_SECRET_ACCESS_KEY,
  );
  const bucket =
    trim(process.env.R2_BUCKET || process.env.R2_BUCKET_NAME || process.env.AWS_S3_BUCKET) ||
    'tylo-one-files';
  const endpointExplicit = trim(process.env.R2_ENDPOINT || process.env.AWS_ENDPOINT_URL);
  const endpoint =
    endpointExplicit ||
    (accountId ? `https://${accountId}.r2.cloudflarestorage.com` : '');
  const region = trim(process.env.R2_REGION || process.env.AWS_REGION) || 'auto';
  const publicBaseUrl = trim(process.env.R2_PUBLIC_BASE_URL).replace(/\/+$/, '');
  const required = flagTrue(process.env.R2_REQUIRED);

  const missing = [];
  if (!accountId && !endpointExplicit) missing.push('R2_ACCOUNT_ID (or R2_ENDPOINT)');
  if (!accessKeyId) missing.push('R2_ACCESS_KEY_ID');
  if (!secretAccessKey) missing.push('R2_SECRET_ACCESS_KEY');
  if (!bucket) missing.push('R2_BUCKET');
  if (!endpoint) missing.push('R2_ENDPOINT');

  const hasCreds = Boolean(accessKeyId && secretAccessKey && endpoint && bucket);
  let enabled = hasCreds;
  if (flagFalse(process.env.R2_ENABLED)) enabled = false;
  else if (flagTrue(process.env.R2_ENABLED)) enabled = hasCreds;

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
    missing: hasCreds ? [] : missing,
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
  return {
    enabled: cfg.enabled,
    required: cfg.required,
    bucket: cfg.bucket || null,
    endpointHost: endpointHost || null,
    hasAccountId: Boolean(cfg.accountId),
    hasAccessKeyId: Boolean(cfg.accessKeyId),
    hasSecretAccessKey: Boolean(cfg.secretAccessKey),
    missing: cfg.missing,
  };
}

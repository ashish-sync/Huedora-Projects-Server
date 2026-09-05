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
  return {
    enabled: cfg.enabled,
    required: cfg.required,
    bucket: cfg.bucket || null,
    endpointHost: endpointHost || null,
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

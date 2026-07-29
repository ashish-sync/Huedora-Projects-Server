/**
 * Parse and validate MongoDB connection strings for Atlas / local dev.
 * Never log credentials — only host and database name.
 */

const PLACEHOLDER_HOSTS = new Set(['1234', 'cluster', 'host', 'localhost']);
const DEFAULT_DATABASE = 'tylo-one';

function stripCredentials(uri) {
  return String(uri || '').replace(/\/\/[^@/]+@/i, '//***@');
}

/** Split authority at the last @ (password may contain unencoded @ before normalization). */
function splitAuthority(authority) {
  const lastAt = authority.lastIndexOf('@');
  if (lastAt < 0) return { creds: authority, host: '' };
  return {
    creds: authority.slice(0, lastAt),
    host: authority.slice(lastAt + 1),
  };
}

export function extractMongoHost(uri) {
  const text = String(uri || '').trim();
  if (!text) return '';
  const withoutScheme = text.replace(/^mongodb\+srv:\/\//i, '').replace(/^mongodb:\/\//i, '');
  const authority = withoutScheme.split('/')[0] || '';
  const { host: hostPort } = splitAuthority(authority);
  const host = (hostPort.split(',')[0] || '').split(':')[0] || '';
  return host.trim();
}

export function extractMongoDatabase(uri) {
  const text = String(uri || '').trim();
  const path = text.replace(/^[^/]+\/\//, '').split('?')[0];
  const slash = path.indexOf('/');
  if (slash < 0) return '';
  return path.slice(slash + 1).split('/')[0] || '';
}

/**
 * Fix common Atlas paste mistakes:
 * - URL-encode passwords that contain @ (e.g. Apple@1234)
 * - Add default database name when URI ends at host or host/
 */
export function normalizeMongoUri(uri) {
  let value = String(uri || '').trim();
  if (!value) return value;

  const schemeMatch = value.match(/^(mongodb(\+srv)?:\/\/)/i);
  if (!schemeMatch) return value;

  const scheme = schemeMatch[1];
  let rest = value.slice(scheme.length);

  let pathAndQuery = '';
  const slashIdx = rest.indexOf('/');
  if (slashIdx >= 0) {
    pathAndQuery = rest.slice(slashIdx);
    rest = rest.slice(0, slashIdx);
  }

  const atCount = (rest.match(/@/g) || []).length;
  if (atCount > 1) {
    const { creds, host } = splitAuthority(rest);
    const colonIdx = creds.indexOf(':');
    if (colonIdx >= 0) {
      const user = creds.slice(0, colonIdx);
      let password = creds.slice(colonIdx + 1);
      try {
        password = decodeURIComponent(password);
      } catch {
        // keep raw password
      }
      rest = `${user}:${encodeURIComponent(password)}@${host}`;
    }
  }

  let normalized = `${scheme}${rest}${pathAndQuery}`;

  const pathOnly = pathAndQuery.split('?')[0] || '';
  const query = pathAndQuery.includes('?') ? pathAndQuery.slice(pathAndQuery.indexOf('?')) : '';
  if (!pathOnly || pathOnly === '/') {
    const defaultQuery = query || '?retryWrites=true&w=majority';
    normalized = `${scheme}${rest}/${DEFAULT_DATABASE}${defaultQuery}`;
  }

  return normalized;
}

export function validateMongoUri(uri, { isProd = false } = {}) {
  const value = String(uri || '').trim();

  if (!value) {
    throw new Error(
      '[config] MONGODB_URI is empty. On Render, paste the full Atlas connection string from '
        + 'Database → Connect → Drivers (mongodb+srv://...).',
    );
  }

  if (!/^mongodb(\+srv)?:\/\//i.test(value)) {
    throw new Error(
      '[config] MONGODB_URI must start with mongodb:// or mongodb+srv://. '
        + `Got: ${stripCredentials(value).slice(0, 80)}`,
    );
  }

  const host = extractMongoHost(value);
  const isSrv = /^mongodb\+srv:\/\//i.test(value);

  if (!host) {
    throw new Error(
      '[config] MONGODB_URI is missing a hostname. Use the full Atlas string, e.g. '
        + 'mongodb+srv://USER:PASSWORD@cluster0.xxxxx.mongodb.net/tylo-one',
    );
  }

  if (PLACEHOLDER_HOSTS.has(host.toLowerCase()) || /^\d+$/.test(host) || /^(x+|test|example)$/i.test(host)) {
    throw new Error(
      `[config] MONGODB_URI hostname "${host}" is invalid. `
        + 'Use the full Atlas host (e.g. huedora.ibo3vfn.mongodb.net).',
    );
  }

  if (isProd && isSrv && !host.includes('.mongodb.net') && !host.includes('.')) {
    throw new Error(
      `[config] MONGODB_URI hostname "${host}" is not a valid Atlas cluster domain. `
        + 'Expected something like cluster0.xxxxx.mongodb.net',
    );
  }

  if (isSrv && /[<>]/.test(value)) {
    throw new Error(
      '[config] MONGODB_URI still contains < or > placeholders from the Atlas copy dialog. '
        + 'Replace <username> and <password> with real values.',
    );
  }

  return value;
}

export function resolveMongoUri(raw, { isProd = false, useMongoose = false } = {}) {
  const trimmed = String(raw || '').trim();
  const localDefault = 'mongodb://127.0.0.1:27017/tylo-one';

  if (!useMongoose) {
    return trimmed || localDefault;
  }

  if (isProd || trimmed) {
    const normalized = normalizeMongoUri(trimmed);
    if (normalized !== trimmed) {
      console.warn('[db] MONGODB_URI auto-normalized (password encoding and/or default database name)');
    }
    return validateMongoUri(normalized, { isProd });
  }

  return localDefault;
}

export function describeMongoTarget(uri) {
  const host = extractMongoHost(uri);
  const database = extractMongoDatabase(uri) || '(default)';
  const mode = /^mongodb\+srv:\/\//i.test(uri) ? 'srv' : 'standard';
  return { host, database, mode };
}

export function formatMongoConnectError(err, uri) {
  const host = extractMongoHost(uri);
  const code = err?.code || err?.cause?.code;
  const message = String(err?.message || err || '');

  if (code === 'ENOTFOUND' || message.includes('querySrv ENOTFOUND')) {
    return new Error(
      `[db] Cannot resolve MongoDB host "${host}". `
        + 'Check MONGODB_URI on Render — use your full Atlas connection string. '
        + `Original: ${message}`,
    );
  }

  if (message.includes('Authentication failed') || message.includes('bad auth')) {
    return new Error(
      '[db] MongoDB authentication failed. Verify Atlas database username and password in MONGODB_URI.',
    );
  }

  return err;
}

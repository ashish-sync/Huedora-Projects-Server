/**
 * Parse and validate MongoDB connection strings for Atlas / local dev.
 * Never log credentials — only host and database name.
 */

const PLACEHOLDER_HOSTS = new Set(['1234', 'cluster', 'host', 'localhost']);

function stripCredentials(uri) {
  return String(uri || '').replace(/\/\/[^@/]+@/i, '//***@');
}

export function extractMongoHost(uri) {
  const text = String(uri || '').trim();
  if (!text) return '';
  const withoutScheme = text.replace(/^mongodb\+srv:\/\//i, '').replace(/^mongodb:\/\//i, '');
  const authority = withoutScheme.split('/')[0] || '';
  const hostPort = authority.includes('@') ? authority.split('@').pop() : authority;
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

  if (PLACEHOLDER_HOSTS.has(host.toLowerCase()) || /^(x+|test|example)$/i.test(host)) {
    throw new Error(
      `[config] MONGODB_URI hostname "${host}" looks like a placeholder. `
        + 'Replace it with your Atlas cluster host (cluster0.xxxxx.mongodb.net).',
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
        + 'Replace <username> and <password> with real values (URL-encode special characters in the password).',
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
    return validateMongoUri(trimmed, { isProd });
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
        + 'Check MONGODB_URI on Render — it must be the full Atlas connection string '
        + '(mongodb+srv://USER:PASSWORD@cluster0.xxxxx.mongodb.net/tylo-one?retryWrites=true&w=majority). '
        + 'URL-encode @ : / ? # [ ] in the password. '
        + `Original: ${message}`,
    );
  }

  if (message.includes('Authentication failed') || message.includes('bad auth')) {
    return new Error(
      '[db] MongoDB authentication failed. Verify Atlas database username/password in MONGODB_URI '
        + '(URL-encode special characters in the password).',
    );
  }

  return err;
}

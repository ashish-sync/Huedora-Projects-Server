import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  getR2Env,
  describeR2Config,
  resolveR2KeyPrefix,
  applyR2KeyPrefix,
  r2KeyReadCandidates,
} from './r2Env.js';
import { toUploadObjectKey, publicUploadPath } from './uploadKeys.js';
import { resetObjectStoreClientForTests } from './objectStore.js';

describe('r2Env', () => {
  const keys = [
    'R2_ENABLED',
    'R2_ACCOUNT_ID',
    'R2_ACCESS_KEY_ID',
    'R2_SECRET_ACCESS_KEY',
    'R2_BUCKET',
    'R2_ENDPOINT',
    'R2_REQUIRED',
    'R2_KEY_PREFIX',
    'AWS_ACCESS_KEY_ID',
    'AWS_SECRET_ACCESS_KEY',
  ];
  const prev = {};
  let prevNodeEnv;

  beforeEach(() => {
    prevNodeEnv = process.env.NODE_ENV;
    for (const k of keys) {
      prev[k] = process.env[k];
      delete process.env[k];
    }
    // Disable auto prefix unless a test sets NODE_ENV / R2_KEY_PREFIX.
    process.env.R2_KEY_PREFIX = '';
    resetObjectStoreClientForTests();
  });

  afterEach(() => {
    for (const k of keys) {
      if (prev[k] === undefined) delete process.env[k];
      else process.env[k] = prev[k];
    }
    if (prevNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = prevNodeEnv;
    resetObjectStoreClientForTests();
  });

  it('is disabled when credentials are missing', () => {
    const cfg = getR2Env();
    assert.equal(cfg.enabled, false);
    assert.ok(cfg.missing.length > 0);
    const summary = describeR2Config(cfg);
    assert.equal(summary.enabled, false);
    assert.equal(summary.hasAccessKeyId, false);
  });

  it('enables when account + keys + bucket are set', () => {
    process.env.R2_ACCOUNT_ID = 'acct123';
    process.env.R2_ACCESS_KEY_ID = 'a'.repeat(32);
    process.env.R2_SECRET_ACCESS_KEY = 'secret_test';
    process.env.R2_BUCKET = 'tylo-one-files';
    const cfg = getR2Env();
    assert.equal(cfg.enabled, true);
    assert.equal(cfg.bucket, 'tylo-one-files');
    assert.match(cfg.endpoint, /acct123\.r2\.cloudflarestorage\.com/);
    const summary = describeR2Config(cfg);
    assert.equal(summary.hasSecretAccessKey, true);
    assert.equal(summary.accessKeyIdLength, 32);
    assert.ok(!JSON.stringify(summary).includes('secret_test'));
  });

  it('respects R2_ENABLED=false', () => {
    process.env.R2_ACCOUNT_ID = 'acct123';
    process.env.R2_ACCESS_KEY_ID = 'a'.repeat(32);
    process.env.R2_SECRET_ACCESS_KEY = 'secret_test';
    process.env.R2_BUCKET = 'tylo-one-files';
    process.env.R2_ENABLED = 'false';
    assert.equal(getR2Env().enabled, false);
  });

  it('rejects Cloudflare API token length as credentialProblem and disables R2', () => {
    process.env.R2_ACCOUNT_ID = 'acct123';
    process.env.R2_ACCESS_KEY_ID = 'x'.repeat(53);
    process.env.R2_SECRET_ACCESS_KEY = 'secret_test_value_long_enough';
    process.env.R2_BUCKET = 'tylo-one-files';
    const cfg = getR2Env();
    assert.equal(cfg.enabled, false);
    assert.equal(cfg.accessKeyId.length, 53);
    assert.match(cfg.credentialProblem || '', /length is 53/);
    const summary = describeR2Config(cfg);
    assert.equal(summary.accessKeyIdLength, 53);
    assert.equal(summary.accessKeyIdExpectedLength, 32);
  });

  it('strips wrapping quotes from access key', () => {
    process.env.R2_ACCOUNT_ID = 'acct123';
    process.env.R2_ACCESS_KEY_ID = `"${'a'.repeat(32)}"`;
    process.env.R2_SECRET_ACCESS_KEY = 'secret_test';
    process.env.R2_BUCKET = 'tylo-one-files';
    const cfg = getR2Env();
    assert.equal(cfg.enabled, true);
    assert.equal(cfg.accessKeyId.length, 32);
  });

  it('auto-prefixes QA and production object keys for bucket isolation', () => {
    delete process.env.R2_KEY_PREFIX;
    assert.equal(resolveR2KeyPrefix('qa'), 'env/qa/');
    assert.equal(resolveR2KeyPrefix('production'), 'env/prod/');
    assert.equal(resolveR2KeyPrefix('development'), '');
    assert.equal(applyR2KeyPrefix('contacts/a.pdf', 'env/qa/'), 'env/qa/contacts/a.pdf');
    assert.equal(applyR2KeyPrefix('env/qa/contacts/a.pdf', 'env/qa/'), 'env/qa/contacts/a.pdf');
    assert.deepEqual(r2KeyReadCandidates('contacts/a.pdf', 'env/qa/'), [
      'env/qa/contacts/a.pdf',
      'contacts/a.pdf',
    ]);
  });

  it('exposes isolationActive in describeR2Config when prefix is set', () => {
    process.env.R2_ACCOUNT_ID = 'acct123';
    process.env.R2_ACCESS_KEY_ID = 'a'.repeat(32);
    process.env.R2_SECRET_ACCESS_KEY = 'secret_test';
    process.env.R2_BUCKET = 'tylo-one-files';
    process.env.R2_KEY_PREFIX = 'env/qa';
    const summary = describeR2Config(getR2Env());
    assert.equal(summary.keyPrefix, 'env/qa/');
    assert.equal(summary.isolationActive, true);
  });
});

describe('uploadKeys', () => {
  it('normalizes /uploads URLs and absolute-style relative keys', () => {
    assert.equal(toUploadObjectKey('/uploads/camp-ops/a.pdf'), 'camp-ops/a.pdf');
    assert.equal(toUploadObjectKey('uploads/contacts/x.png'), 'contacts/x.png');
    assert.equal(toUploadObjectKey('finance/doc.pdf'), 'finance/doc.pdf');
    assert.equal(publicUploadPath('camp-ops/a.pdf'), '/uploads/camp-ops/a.pdf');
  });

  it('rejects traversal', () => {
    assert.equal(toUploadObjectKey('/uploads/foo/../../etc/passwd'), '');
    assert.equal(toUploadObjectKey('camp-ops/../../secret'), '');
  });
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  sanitizeAuditSnapshot,
  stripBuilderFormMedia,
  stripEmbeddedMedia,
} from './stripEmbeddedMedia.js';

test('stripEmbeddedMedia clears logo data URLs and media keys', () => {
  const input = {
    company: {
      legalName: 'Acme',
      logoDataUrl: 'data:image/png;base64,AAAA',
    },
    signature: { imageDataUrl: 'data:image/png;base64,BBBB', signatoryName: 'Pat' },
    note: 'ok',
  };
  const out = stripEmbeddedMedia(input);
  assert.equal(out.company.legalName, 'Acme');
  assert.equal(out.company.logoDataUrl, '');
  assert.equal(out.signature.imageDataUrl, '');
  assert.equal(out.signature.signatoryName, 'Pat');
  assert.equal(input.company.logoDataUrl.startsWith('data:'), true);
});

test('stripBuilderFormMedia returns null for empty', () => {
  assert.equal(stripBuilderFormMedia(null), null);
});

test('sanitizeAuditSnapshot omits builderForm and truncates', () => {
  const snap = sanitizeAuditSnapshot({
    status: 'Issued',
    builderForm: { company: { logoDataUrl: 'data:image/png;base64,XXXX' } },
    logoDataUrl: 'data:image/png;base64,YYYY',
    blob: 'x'.repeat(5000),
  });
  assert.equal(snap.status, 'Issued');
  assert.equal(snap.builderForm, '[omitted:builderForm]');
  assert.equal(snap.logoDataUrl, '[omitted:media]');
  assert.ok(String(snap.blob).includes('[truncated]'));
});

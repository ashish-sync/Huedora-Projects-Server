import test from 'node:test';
import assert from 'node:assert/strict';
import { isAllowedContactKycFile, signContactKycUrl, withSignedContactKyc } from './contactKycUpload.js';

test('allows PDF and common image MIME types for contact KYC uploads', () => {
  assert.equal(isAllowedContactKycFile({ mimetype: 'application/pdf', originalname: 'a.pdf' }), true);
  assert.equal(isAllowedContactKycFile({ mimetype: 'image/jpeg', originalname: 'a.jpg' }), true);
  assert.equal(isAllowedContactKycFile({ mimetype: 'image/png', originalname: 'a.png' }), true);
  assert.equal(isAllowedContactKycFile({ mimetype: 'image/webp', originalname: 'a.webp' }), true);
});

test('allows by extension when MIME is missing or generic', () => {
  assert.equal(isAllowedContactKycFile({ mimetype: '', originalname: 'proof.PDF' }), true);
  assert.equal(isAllowedContactKycFile({ mimetype: 'application/octet-stream', originalname: 'pan.jpeg' }), true);
  assert.equal(isAllowedContactKycFile({ mimetype: 'application/octet-stream', originalname: 'x.docx' }), false);
});

test('signContactKycUrl converts /uploads paths to signed file links', () => {
  const signed = signContactKycUrl('/uploads/contacts/demo-pan.pdf');
  assert.match(signed, /^\/api\/v1\/files\/signed\?token=/);
  const presented = withSignedContactKyc({
    name: 'Demo',
    panCardCopyUrl: '/uploads/contacts/demo-pan.pdf',
    passbookCopyUrl: '/uploads/contacts/demo-bank.pdf',
  });
  assert.match(presented.panCardCopyUrl, /files\/signed/);
  assert.match(presented.passbookCopyUrl, /files\/signed/);
});

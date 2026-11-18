import test from 'node:test';
import assert from 'node:assert/strict';
import {
  QIE_HR_ACTIONS,
  QIE_INDICATORS,
  QIE_STATUSES,
  deriveQieIndicator,
} from './qieStatus.js';
import { namesLikelyMatch } from './qiePipeline.js';

test('green requires credential pass and HR approve — clean scan alone is never enough', () => {
  assert.equal(
    deriveQieIndicator({
      storedPath: '/uploads/contacts/a.pdf',
      status: QIE_STATUSES.HR_REVIEW,
      forensic: { cleanScan: true },
      credentialVerification: { passed: true },
      hrDecision: {},
    }),
    QIE_INDICATORS.AMBER,
  );

  assert.equal(
    deriveQieIndicator({
      storedPath: '/uploads/contacts/a.pdf',
      status: QIE_STATUSES.VERIFIED,
      forensic: { cleanScan: true },
      credentialVerification: { passed: false },
      hrDecision: { action: QIE_HR_ACTIONS.APPROVE },
    }),
    QIE_INDICATORS.AMBER,
  );

  assert.equal(
    deriveQieIndicator({
      storedPath: '/uploads/contacts/a.pdf',
      status: QIE_STATUSES.VERIFIED,
      forensic: { cleanScan: true },
      credentialVerification: { passed: true },
      hrDecision: { action: QIE_HR_ACTIONS.APPROVE },
    }),
    QIE_INDICATORS.GREEN,
  );
});

test('discrepancy and reject map to red; missing file is grey', () => {
  assert.equal(deriveQieIndicator({}), QIE_INDICATORS.GREY);
  assert.equal(
    deriveQieIndicator({
      storedPath: '/uploads/x.pdf',
      status: QIE_STATUSES.DISCREPANCY,
      credentialVerification: { passed: false },
    }),
    QIE_INDICATORS.RED,
  );
  assert.equal(
    deriveQieIndicator({
      storedPath: '/uploads/x.pdf',
      status: QIE_STATUSES.HR_REVIEW,
      hrDecision: { action: QIE_HR_ACTIONS.REJECT },
      credentialVerification: { passed: true },
    }),
    QIE_INDICATORS.RED,
  );
});

test('namesLikelyMatch tolerates order and noise', () => {
  assert.equal(namesLikelyMatch('Dr Anita Sharma', 'Anita Sharma'), true);
  assert.equal(namesLikelyMatch('Anita Sharma', 'Ravi Kumar'), false);
});

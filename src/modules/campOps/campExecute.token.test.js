import test from 'node:test';
import assert from 'node:assert/strict';
import {
  canMintExecutionActivityLink,
  EXECUTION_INVITE_HOURS_AFTER_START,
  EXECUTION_INVITE_TOKEN_LENGTH,
  hashExecutionToken,
  isExecutionInviteExpiredForCamp,
  mintExecutionToken,
  resolveExecutionInviteExpiresAt,
} from './campExecute.service.js';

test('mintExecutionToken returns short unambiguous tokens', () => {
  const token = mintExecutionToken();
  assert.equal(token.length, EXECUTION_INVITE_TOKEN_LENGTH);
  assert.match(token, /^[A-HJ-NP-Za-km-z2-9]+$/);
  assert.ok(hashExecutionToken(token));
});

test('mintExecutionToken supports custom length', () => {
  assert.equal(mintExecutionToken(8).length, 8);
});

test('resolveExecutionInviteExpiresAt is 72 hours after camp start', () => {
  const camp = { campDate: '2026-10-22', startTime: '09:00' };
  const expiresAt = resolveExecutionInviteExpiresAt(camp);
  assert.ok(expiresAt);
  assert.equal(EXECUTION_INVITE_HOURS_AFTER_START, 72);
  const ms = expiresAt.getTime() - new Date(2026, 9, 22, 9, 0, 0, 0).getTime();
  assert.equal(ms, 72 * 60 * 60 * 1000);
});

test('isExecutionInviteExpiredForCamp uses camp start + 72h', () => {
  const camp = { campDate: '2026-10-22', startTime: '09:00' };
  const start = new Date(2026, 9, 22, 9, 0, 0, 0);
  assert.equal(
    isExecutionInviteExpiredForCamp(camp, new Date(start.getTime() + 71 * 60 * 60 * 1000)),
    false,
  );
  assert.equal(
    isExecutionInviteExpiredForCamp(camp, new Date(start.getTime() + 72 * 60 * 60 * 1000)),
    true,
  );
});

test('canMintExecutionActivityLink allows Assigned status without assignmentDecision', () => {
  assert.equal(
    canMintExecutionActivityLink({
      status: 'approved',
      assignmentStatus: 'Assigned',
      hcwName: 'Ravi Technician',
      campDate: '2026-10-22',
      startTime: '09:00',
    }),
    true,
  );
});

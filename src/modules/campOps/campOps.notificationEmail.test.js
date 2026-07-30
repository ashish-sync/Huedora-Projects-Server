import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCampStakeholderEmail } from './campOps.notificationEmail.js';

test('buildCampStakeholderEmail prefixes manager copies', () => {
  const email = buildCampStakeholderEmail({
    title: 'Camp review overdue: 26-08-0001',
    body: 'Demo · BMD · 15/08/2026',
    camp: { campId: '26-08-0001', clientName: 'Demo Pharma', campDate: '15/08/2026' },
    recipientName: 'Manager User',
    audience: 'manager',
  });

  assert.match(email.subject, /^\[Manager copy\]/);
  assert.match(email.text, /reporting manager/i);
  assert.match(email.text, /26-08-0001/);
});

test('buildCampStakeholderEmail labels coordinator audience', () => {
  const email = buildCampStakeholderEmail({
    title: 'Camp needs review',
    body: 'Summary',
    camp: { campId: '26-08-0002' },
    recipientName: 'Coordinator User',
    audience: 'coordinator',
  });

  assert.equal(email.subject, 'Camp needs review');
  assert.match(email.text, /assigned as a coordinator/i);
});

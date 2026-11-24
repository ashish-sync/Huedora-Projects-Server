import test from 'node:test';
import assert from 'node:assert/strict';
import { logAudit } from './audit.adapter.js';

test('logAudit accepts email/whatsapp creates without a user (no early return)', async () => {
  await assert.doesNotReject(() =>
    logAudit({
      user: null,
      ip: 'email',
      entityType: 'camp',
      entityId: 'camp-doc-1',
      action: 'create_email',
      afterValue: { campId: '26-11-0001' },
    }),
  );
  await assert.doesNotReject(() =>
    logAudit({
      user: { _id: 'u1', email: 'ops@tylo.test' },
      ip: 'whatsapp',
      entityType: 'camp',
      entityId: 'camp-doc-2',
      action: 'create_whatsapp',
      afterValue: { campId: '26-11-0002' },
    }),
  );
});

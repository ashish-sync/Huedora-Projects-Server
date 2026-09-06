import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  enrichCampList,
  compareCampListOrder,
  projectCampList,
} from './campOps.listDto.js';

describe('camp list DTO', () => {
  it('enrichCampList omits executionDocuments and does not invent signed urls', () => {
    const row = enrichCampList({
      _id: 'c1',
      clientName: 'Acme',
      doctorName: 'Dr Adi',
      campDate: '2099-01-15',
      startTime: '09:00',
      endTime: '12:00',
      durationHours: 3,
      status: 'pending_review',
      lifecycleStage: 'request',
      executionDocuments: [{ url: '/uploads/camp-ops/x.webp', docType: 'doctor_form' }],
      inTimeSelfieUrl: '/uploads/camp-ops/s.webp',
      contactPersons: [{ name: 'X' }],
    });
    assert.equal(row.clientName, 'Acme');
    assert.equal(row.executionDocuments, undefined);
    assert.equal(row.inTimeSelfieUrl, undefined);
    assert.equal(row.contactPersons, undefined);
    assert.ok(Array.isArray(row.approvalBlockers));
    assert.equal(typeof row.canApprove, 'boolean');
  });

  it('compareCampListOrder puts upcoming before past', () => {
    const today = '2026-09-07';
    const a = { campDate: '2026-09-10', startTime: '10:00', createdAt: 'a' };
    const b = { campDate: '2026-09-01', startTime: '10:00', createdAt: 'b' };
    assert.ok(compareCampListOrder(a, b, today) < 0);
    assert.ok(compareCampListOrder(b, a, today) > 0);
  });

  it('projectCampList keeps identity fields', () => {
    const p = projectCampList({
      _id: '1',
      campId: '26-09-0001',
      clientName: 'X',
      bogous: true,
    });
    assert.equal(p.campId, '26-09-0001');
    assert.equal(p.bogous, undefined);
  });
});

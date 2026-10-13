import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { prepareCampForFullExport } from './campFullExport.js';

describe('campFullExport date/time standards', () => {
  it('exports dates as DD-MM-YYYY and times as 24-hour HH:mm', () => {
    const row = prepareCampForFullExport({
      campDate: '2026-08-15',
      requestDate: '2026-08-10',
      startTime: '11:00 AM',
      endTime: '6:00 PM',
      inTime: '20:30',
      outTime: '15:30',
      source: 'excel',
      status: 'approved',
    });

    assert.equal(row.campDate, '15-08-2026');
    assert.equal(row.requestDate, '10-08-2026');
    assert.equal(row.startTime, '11:00');
    assert.equal(row.endTime, '18:00');
    assert.equal(row.inTime, '20:30');
    assert.equal(row.outTime, '15:30');
    assert.equal(row.timeFrameRange, '11:00 – 18:00');
  });
});

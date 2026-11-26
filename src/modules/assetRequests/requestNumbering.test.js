import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  formatRequestNumber,
  parseRequestNumber,
  requestNumberCounterName,
  requestNumberPeriod,
  requestTypeLetter,
} from './requestNumbering.js';

describe('requestNumbering', () => {
  it('maps request types to R/G/T/F/H/M/O', () => {
    assert.equal(requestTypeLetter('REPAIR'), 'R');
    assert.equal(requestTypeLetter('MAINTENANCE'), 'R');
    assert.equal(requestTypeLetter('SERVICE'), 'R');
    assert.equal(requestTypeLetter('LOGISTICS'), 'G');
    assert.equal(requestTypeLetter('MOVEMENT'), 'G');
    assert.equal(requestTypeLetter('TRAINING'), 'T');
    assert.equal(requestTypeLetter('REIMBURSEMENT'), 'F');
    assert.equal(requestTypeLetter('HIRING'), 'H');
    assert.equal(requestTypeLetter('MASTER_ADD'), 'M');
    assert.equal(requestTypeLetter('OTHER'), 'O');
    assert.equal(requestTypeLetter('unknown'), 'O');
  });

  it('formats Letter-MM-SEQ like R-11-001', () => {
    assert.equal(formatRequestNumber('R', '11', 1), 'R-11-001');
    assert.equal(formatRequestNumber('G', 11, 42), 'G-11-042');
    assert.equal(formatRequestNumber('h', '3', 7), 'H-03-007');
  });

  it('parses the new request number shape', () => {
    assert.deepEqual(parseRequestNumber('R-11-001'), {
      letter: 'R',
      mm: '11',
      sequence: 1,
    });
    assert.equal(parseRequestNumber('ARQ-000001'), null);
  });

  it('builds year-month counter keys per letter', () => {
    const period = requestNumberPeriod(new Date(2026, 10, 15)); // Nov 2026
    assert.equal(period.mm, '11');
    assert.equal(period.periodKey, '202611');
    assert.equal(requestNumberCounterName('R', period.periodKey), 'requestOne.R.202611');
  });
});

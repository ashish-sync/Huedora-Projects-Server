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

  it('formats LetterYY-MM-SEQ like R26-11-003', () => {
    assert.equal(formatRequestNumber('R', '26', '11', 3), 'R26-11-003');
    assert.equal(formatRequestNumber('G', 26, 11, 42), 'G26-11-042');
    assert.equal(formatRequestNumber('h', '27', '3', 7), 'H27-03-007');
  });

  it('parses the LetterYY-MM-SEQ shape', () => {
    assert.deepEqual(parseRequestNumber('R26-11-003'), {
      letter: 'R',
      yy: '26',
      mm: '11',
      sequence: 3,
    });
    assert.equal(parseRequestNumber('R-11-001'), null);
    assert.equal(parseRequestNumber('ARQ-000001'), null);
  });

  it('builds year-month counter keys and yy from calendar year', () => {
    const period = requestNumberPeriod(new Date(2026, 10, 15)); // Nov 2026
    assert.equal(period.yy, '26');
    assert.equal(period.mm, '11');
    assert.equal(period.periodKey, '202611');
    assert.equal(requestNumberCounterName('R', period.periodKey), 'requestOne.R.202611');

    const nextYear = requestNumberPeriod(new Date(2027, 0, 5)); // Jan 2027
    assert.equal(nextYear.yy, '27');
    assert.equal(nextYear.mm, '01');
  });
});

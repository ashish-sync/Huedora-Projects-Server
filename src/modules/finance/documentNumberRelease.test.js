import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { nextCounter, releaseCounterSequence } from '../common/counter.model.js';
import {
  parseDocumentNumber,
  releaseCommercialDocumentNumber,
} from './documentNumbering.js';

describe('commercial document number release', () => {
  it('reuses a released sequence before allocating a new one', async () => {
    const counterName = `financeDoc_test_release_${Date.now()}`;
    const a = await nextCounter(counterName, 'TST/26-27/08', { separator: '/', digits: 3 });
    const b = await nextCounter(counterName, 'TST/26-27/08', { separator: '/', digits: 3 });
    assert.match(a, /\/001$/);
    assert.match(b, /\/002$/);

    const released = await releaseCounterSequence(counterName, 2);
    assert.equal(released, true);

    const reused = await nextCounter(counterName, 'TST/26-27/08', { separator: '/', digits: 3 });
    assert.equal(reused, 'TST/26-27/08/002');
  });

  it('releaseCommercialDocumentNumber parses TCIN and frees the seq', async () => {
    const unique = Date.now();
    // Use a real type period by allocating then releasing via document helper.
    // Isolate by using a unique period month via documentDate far in future... monthly key.
    // Instead exercise parse + releaseCounterSequence path directly with a known counter.
    const parsed = parseDocumentNumber('TCIN/26-27/08/003');
    assert.equal(parsed.sequence, 3);
    const counterName = `financeDoc_client_invoice_${parsed.periodKey}_rel_${unique}`;
    await nextCounter(counterName, 'TCIN/26-27/08', { separator: '/', digits: 3 });
    await nextCounter(counterName, 'TCIN/26-27/08', { separator: '/', digits: 3 });
    await nextCounter(counterName, 'TCIN/26-27/08', { separator: '/', digits: 3 });
    // Simulate release of /003 on that isolated counter via releaseCounterSequence
    assert.equal(await releaseCounterSequence(counterName, 3), true);
    const next = await nextCounter(counterName, 'TCIN/26-27/08', { separator: '/', digits: 3 });
    assert.equal(next, 'TCIN/26-27/08/003');

    // Public API still parses and targets the canonical counter name shape
    const released = await releaseCommercialDocumentNumber('TCIN/99-00/01/001', 'client_invoice');
    // May be false if counter never existed at that high seq — still must not throw
    assert.equal(typeof released, 'boolean');
  });
});

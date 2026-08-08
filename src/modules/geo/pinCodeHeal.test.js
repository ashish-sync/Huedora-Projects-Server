import test from 'node:test';
import assert from 'node:assert/strict';
import { DELHI_PIN_DISTRICT_BY_CODE } from './pinCodeHeal.js';

test('Delhi PIN map covers 110001–110020 and broader Delhi range', () => {
  for (let n = 110001; n <= 110020; n += 1) {
    const pin = String(n);
    assert.ok(DELHI_PIN_DISTRICT_BY_CODE[pin], `missing map for ${pin}`);
    assert.match(String(DELHI_PIN_DISTRICT_BY_CODE[pin]), /Delhi|Shahdara/);
  }
  assert.ok(Object.keys(DELHI_PIN_DISTRICT_BY_CODE).length >= 20);
});

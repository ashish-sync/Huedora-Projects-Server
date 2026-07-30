import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEMO_USER_EMAILS,
  DEMO_CONTACT_EMAILS,
  DEMO_SUPPLIER_CODES,
} from './purgeDemoData.js';
import { CAMP_ONE_DEMO } from '../modules/campOps/campOps.seed.js';

test('purge demo markers include Camp One identities', () => {
  assert.equal(DEMO_USER_EMAILS.has(CAMP_ONE_DEMO.adminEmail), true);
  assert.equal(DEMO_CONTACT_EMAILS.has('ravi.tech@demo.tylo.local'), true);
  assert.equal(DEMO_SUPPLIER_CODES.has('DEMO-SUP'), true);
});

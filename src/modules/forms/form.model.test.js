import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { normalizeFormField, normalizeFormPayload } from './form.model.js';
import { PUBLIC_CAMP_REQUEST_TEMPLATE } from './form.constants.js';

describe('Form Master payload normalization', () => {
  it('normalizes fields and deduplicates keys', () => {
    const payload = normalizeFormPayload({
      name: 'Public Camp Request',
      category: 'public camp request',
      fields: [
        { label: 'Doctor Name', type: 'text', required: true },
        { key: 'doctorName', label: 'Doctor Alias', type: 'text' },
        { label: 'Notes', type: 'long_text' },
        { label: 'Specialty', type: 'dropdown', options: 'GP, Cardiology' },
      ],
    });

    assert.equal(payload.code, 'PUBLIC_CAMP_REQUEST');
    assert.equal(payload.category, 'PUBLIC_CAMP_REQUEST');
    assert.equal(payload.fields.length, 4);
    assert.equal(payload.fields[0].key, 'Doctor_Name');
    assert.equal(payload.fields[1].key, 'doctorName');
    assert.equal(payload.fields[2].type, 'textarea');
    assert.deepEqual(payload.fields[3].options, ['GP', 'Cardiology']);
  });

  it('accepts the built-in Public Camp Request template', () => {
    const payload = normalizeFormPayload(PUBLIC_CAMP_REQUEST_TEMPLATE);
    assert.equal(payload.name, 'Public Camp Request');
    assert.equal(payload.category, 'PUBLIC_CAMP_REQUEST');
    assert.ok(payload.fields.length >= 10);
    assert.equal(normalizeFormField({ label: 'Phone', type: 'phone' }).type, 'phone');
  });
});

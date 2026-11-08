import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { normalizeFormField, normalizeFormPayload } from './form.model.js';
import { HCW_ACTIVITY_TEMPLATE, PUBLIC_CAMP_REQUEST_TEMPLATE } from './form.constants.js';

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

  it('normalizes validation, layout, format and conditional logic', () => {
    const field = normalizeFormField({
      label: 'Expected Patients',
      type: 'number',
      required: true,
      section: 'Demand',
      width: 'full',
      min: 1,
      max: '500',
      minLength: '',
      maxLength: 10,
      pattern: '^[0-9]+$',
      format: 'digits',
      placeholder: 'e.g. 40',
      helpText: 'Patients expected at camp',
      defaultValue: '40',
      showWhen: { field: 'campType', operator: 'eq', value: 'HCW Only' },
    });

    assert.equal(field.type, 'number');
    assert.equal(field.section, 'Demand');
    assert.equal(field.width, 'full');
    assert.equal(field.min, 1);
    assert.equal(field.max, 500);
    assert.equal(field.maxLength, 10);
    assert.equal(field.pattern, '^[0-9]+$');
    assert.equal(field.format, 'digits');
    assert.deepEqual(field.showWhen, {
      field: 'campType',
      operator: 'eq',
      value: 'HCW Only',
    });
  });

  it('accepts the built-in Public Camp Request template', () => {
    const payload = normalizeFormPayload(PUBLIC_CAMP_REQUEST_TEMPLATE);
    assert.equal(payload.name, 'Public Camp Request');
    assert.equal(payload.category, 'PUBLIC_CAMP_REQUEST');
    assert.ok(payload.fields.length >= 10);
    assert.equal(normalizeFormField({ label: 'Phone', type: 'phone' }).type, 'phone');
    assert.equal(normalizeFormField({ label: 'Amount', type: 'currency' }).type, 'currency');
    assert.equal(normalizeFormField({ label: 'Site photo', type: 'image' }).type, 'image');
    assert.equal(normalizeFormField({ label: 'GPS capture', type: 'gps photo' }).type, 'gps_photo');
    assert.deepEqual(
      normalizeFormField({ label: 'Attachment', type: 'file', options: 'PDF, .XLSX, csv' }).options,
      ['pdf', 'xlsx', 'csv'],
    );
    assert.ok(payload.fields.some((field) => field.section === 'Doctor'));
  });

  it('accepts the built-in HCW Activity Form template', () => {
    const payload = normalizeFormPayload(HCW_ACTIVITY_TEMPLATE);
    assert.equal(payload.name, 'HCW Activity Form');
    assert.equal(payload.category, 'HCW_ACTIVITY');
    assert.ok(payload.fields.some((field) => field.type === 'gps_photo'));
    assert.ok(payload.fields.some((field) => field.key === 'patientsCovered'));
  });
});

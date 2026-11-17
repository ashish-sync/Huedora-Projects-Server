import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  applyFieldFormat,
  compilePattern,
  evaluateShowWhen,
  getFormMasterCampDateErrors,
  normalizeFormSettings,
  validateFieldValue,
  validateFormMasterValues,
} from './formFieldRuntime.js';

describe('formFieldRuntime', () => {
  it('applies format transforms', () => {
    assert.equal(applyFieldFormat('ab-12', 'uppercase'), 'AB-12');
    assert.equal(applyFieldFormat('Ab Cd', 'lowercase'), 'ab cd');
    assert.equal(applyFieldFormat('ashish zonal', 'titlecase'), 'Ashish Zonal');
    assert.equal(applyFieldFormat('A1B2C', 'digits'), '12');
    assert.equal(applyFieldFormat('98-765-43210', 'phone-in'), '9876543210');
    assert.equal(applyFieldFormat('  User@Mail.COM ', 'email'), 'user@mail.com');
    assert.equal(applyFieldFormat('9:5', 'time-24h'), '09:05');
  });

  it('compiles and rejects invalid regex', () => {
    assert.equal(compilePattern('^[A-Z]+$').ok, true);
    assert.equal(compilePattern('(').ok, false);
  });

  it('evaluates showWhen operators', () => {
    assert.equal(evaluateShowWhen({ field: 'a', operator: 'eq', value: '1' }, { a: '1' }), true);
    assert.equal(evaluateShowWhen({ field: 'a', operator: 'neq', value: '1' }, { a: '2' }), true);
    assert.equal(evaluateShowWhen({ field: 'a', operator: 'in', value: 'x, y' }, { a: 'y' }), true);
    assert.equal(evaluateShowWhen({ field: 'a', operator: 'contains', value: 'hi' }, { a: 'ship' }), true);
    assert.equal(evaluateShowWhen({ field: 'a', operator: 'empty', value: '' }, { a: '' }), true);
    assert.equal(evaluateShowWhen({ field: 'a', operator: 'notEmpty', value: '' }, { a: 'x' }), true);
  });

  it('validates pattern and required fields', () => {
    const field = {
      key: 'doctorCode',
      label: 'Doctor Code',
      required: true,
      pattern: '^[A-Z0-9]+$',
      format: 'uppercase',
    };
    assert.match(validateFieldValue(field, ''), /required/i);
    assert.match(validateFieldValue(field, 'ab-1'), /invalid/i);
    assert.equal(validateFieldValue(field, 'AB1'), '');
  });

  it('skips hidden fields for showWhen', () => {
    const field = {
      key: 'notes',
      label: 'Notes',
      required: true,
      showWhen: { field: 'flag', operator: 'eq', value: 'yes' },
    };
    assert.equal(validateFieldValue(field, '', { values: { flag: 'no' } }), '');
    assert.match(validateFieldValue(field, '', { values: { flag: 'yes' } }), /required/i);
  });

  it('normalizes form settings and always blocks past camp dates', () => {
    const settings = normalizeFormSettings(
      { allowExcelUpload: false },
      'PUBLIC_CAMP_REQUEST',
    );
    assert.equal(settings.allowExcelUpload, false);
    assert.equal(settings.enforceFieldRules, true);

    const past = '2000-01-01';
    assert.ok(getFormMasterCampDateErrors({ campDate: past }).length > 0);
  });

  it('validates a values map against Form Master fields', () => {
    const errors = validateFormMasterValues(
      [
        { key: 'doctorCode', label: 'Doctor Code', required: true, pattern: '^[A-Z]+$' },
        { key: 'remarks', label: 'Remarks', required: false },
      ],
      { doctorCode: '12', remarks: '' },
    );
    assert.ok(errors.some((msg) => /Doctor Code/i.test(msg)));
  });
});

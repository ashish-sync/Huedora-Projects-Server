import test from 'node:test';
import assert from 'node:assert/strict';
import {
  extractPlaceholdersFromText,
  isDateFieldToken,
  normalizePlaceholderType,
  validatePlaceholderValue,
  fillTextPlaceholders,
} from './docxPlaceholders.js';

test('Todays Date and Effective Date normalize to date type', () => {
  assert.equal(normalizePlaceholderType('Todays Date'), 'date');
  assert.equal(normalizePlaceholderType("Today's Date"), 'date');
  assert.equal(normalizePlaceholderType('Effective Date'), 'date');
  assert.equal(isDateFieldToken('Remarks'), false);
});

test('extractPlaceholdersFromText tags Todays Date as date', () => {
  const list = extractPlaceholdersFromText('Signed on [Todays Date] — [Remarks]');
  const datePh = list.find((p) => /today/i.test(p.label));
  const remarks = list.find((p) => /remark/i.test(p.label));
  assert.equal(datePh?.type, 'date');
  assert.equal(datePh?.key, 'todays_date');
  assert.equal(remarks?.type, 'text');
});

test('validatePlaceholderValue accepts ISO dates', () => {
  assert.equal(validatePlaceholderValue('date', '2026-08-20'), null);
  assert.ok(validatePlaceholderValue('date', 'not-a-date'));
});

test('fillTextPlaceholders formats date values for the document', () => {
  const text = 'Date: [Todays Date]';
  const placeholders = extractPlaceholdersFromText(text);
  const out = fillTextPlaceholders(text, { todays_date: '2026-08-20' }, placeholders);
  assert.equal(out, 'Date: 20-08-2026');
});

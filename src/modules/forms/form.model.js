import { defineCollection } from '../../store/filedb.js';
import { softDelete } from '../common/counter.model.js';
import {
  matchFormCategory,
  matchFormFieldFormat,
  matchFormFieldType,
  matchFormFieldWidth,
  matchFormShowOperator,
} from './form.constants.js';

/** Reusable form formats for Public Camp Request and other TYLO forms. */
export const FormMaster = defineCollection('form_masters', {
  ...softDelete,
  name: '',
  code: '',
  category: 'OTHER',
  description: '',
  fields: [],
  isActive: true,
  createdBy: null,
  updatedBy: null,
});

function slugKey(raw, fallback = 'field') {
  const cleaned = String(raw || '')
    .trim()
    .replace(/[^a-zA-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .replace(/_+/g, '_');
  return cleaned || fallback;
}

function optionalNumber(raw) {
  if (raw === undefined || raw === null || raw === '') return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

function optionalInteger(raw) {
  const n = optionalNumber(raw);
  if (n === null) return null;
  return Math.trunc(n);
}

function normalizeOptions(raw, type) {
  // Dropdown/radio/checkbox options, or allowed file extensions for file uploads.
  const needsOptions = type === 'select'
    || type === 'radio'
    || type === 'checkbox_group'
    || type === 'file';
  if (!needsOptions) return [];
  const options = Array.isArray(raw)
    ? raw.map((opt) => String(opt || '').trim()).filter(Boolean)
    : String(raw || '')
        .split(',')
        .map((opt) => opt.trim())
        .filter(Boolean);
  if (type === 'file') {
    return options.map((opt) => opt.replace(/^\./, '').toLowerCase());
  }
  return options;
}

function normalizeShowWhen(raw = {}) {
  const field = slugKey(raw.field || raw.key || '', '');
  if (!field) return null;
  const operator = matchFormShowOperator(raw.operator || raw.op);
  const value = String(raw.value ?? '').trim();
  if ((operator === 'empty' || operator === 'notEmpty') && !value) {
    return { field, operator, value: '' };
  }
  if (!value && operator !== 'empty' && operator !== 'notEmpty') return null;
  return { field, operator, value };
}

export function normalizeFormField(raw = {}, index = 0) {
  const label = String(raw.label || raw.name || '').trim();
  const key = slugKey(raw.key || raw.name || label, `field_${index + 1}`);
  const type = matchFormFieldType(raw.type);
  const width = matchFormFieldWidth(raw.width || raw.colSpan);
  const format = matchFormFieldFormat(raw.format);
  const showWhen = normalizeShowWhen(raw.showWhen || raw.condition || {});

  return {
    key,
    label: label || key,
    type,
    required: raw.required === true || raw.required === 'true' || raw.required === 1,
    options: normalizeOptions(raw.options, type),
    placeholder: String(raw.placeholder || '').trim(),
    helpText: String(raw.helpText || raw.help || '').trim(),
    section: String(raw.section || raw.group || '').trim(),
    width,
    min: optionalNumber(raw.min),
    max: optionalNumber(raw.max),
    minLength: optionalInteger(raw.minLength),
    maxLength: optionalInteger(raw.maxLength),
    pattern: String(raw.pattern || '').trim(),
    format,
    defaultValue: String(raw.defaultValue ?? '').trim(),
    showWhen,
  };
}

export function normalizeFormPayload(body = {}) {
  const name = String(body.name || '').trim();
  const code = slugKey(body.code || name, '').toUpperCase();
  const fields = Array.isArray(body.fields)
    ? body.fields.map((field, index) => normalizeFormField(field, index)).filter((field) => field.label)
    : [];

  // Keep unique keys in declaration order.
  const seen = new Set();
  const uniqueFields = [];
  for (const field of fields) {
    let key = field.key;
    let n = 2;
    while (seen.has(key)) {
      key = `${field.key}_${n}`;
      n += 1;
    }
    seen.add(key);
    uniqueFields.push({ ...field, key });
  }

  return {
    name,
    code,
    category: matchFormCategory(body.category),
    description: String(body.description || '').trim(),
    fields: uniqueFields,
    isActive: body.isActive === false || body.isActive === 'false' ? false : true,
  };
}

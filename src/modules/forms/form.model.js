import { defineCollection } from '../../store/filedb.js';
import { softDelete } from '../common/counter.model.js';
import { matchFormCategory, matchFormFieldType } from './form.constants.js';

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

export function normalizeFormField(raw = {}, index = 0) {
  const label = String(raw.label || raw.name || '').trim();
  const key = slugKey(raw.key || raw.name || label, `field_${index + 1}`);
  const type = matchFormFieldType(raw.type);
  const options = Array.isArray(raw.options)
    ? raw.options.map((opt) => String(opt || '').trim()).filter(Boolean)
    : String(raw.options || '')
        .split(',')
        .map((opt) => opt.trim())
        .filter(Boolean);

  return {
    key,
    label: label || key,
    type,
    required: raw.required === true || raw.required === 'true' || raw.required === 1,
    options: type === 'select' ? options : [],
    placeholder: String(raw.placeholder || '').trim(),
    helpText: String(raw.helpText || raw.help || '').trim(),
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

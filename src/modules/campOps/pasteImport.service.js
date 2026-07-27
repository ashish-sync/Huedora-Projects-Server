import { AppError } from '../../utils/helpers.js';
import { parseExcelBuffer } from './communications/utils/excelParser.js';
import { mapRows } from './communications/utils/importMapper.js';
import {
  CAMP_PASTE_TABULAR_FIELD_KEYS,
  getImportFieldDefinitions,
  matchImportColumns,
} from './import/importColumnMatcher.js';
import {
  applyPasteDefaults,
  validatePasteDefaults,
} from './manualPaste.service.js';
import { enrichPasteLocationFromPin } from './manualPaste.enrich.js';
import {
  escapeRegex,
  parseLocalDateInput,
  trimStr,
  validateMappedImportRows,
} from './campOps.helpers.js';
import { CampOpsCamp, CampOpsClient } from './campOps.model.js';

async function resolveClientForRow(row, { allowCreate = false } = {}) {
  const name = trimStr(row.clientName);
  if (!name) return null;

  const existing = await CampOpsClient.findOne({ isDeleted: false, name });
  if (existing) return existing;
  if (!allowCreate) return { name, _id: null };

  return CampOpsClient.create({
    name,
    code: name.replace(/[^A-Za-z0-9]/g, '').slice(0, 8).toUpperCase() || 'CLIENT',
    isActive: true,
  });
}

function normalizeDoctorName(value = '') {
  return String(trimStr(value) || '')
    .replace(/^dr\.?\s*/i, '')
    .replace(/\./g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function doctorsMatch(row = {}, camp = {}) {
  const rowCode = trimStr(row.doctorCode).toLowerCase();
  const campCode = trimStr(camp.doctorCode).toLowerCase();
  if (rowCode && campCode) return rowCode === campCode;

  const rowName = normalizeDoctorName(row.doctorName);
  const campName = normalizeDoctorName(camp.doctorName);
  return Boolean(rowName && campName && rowName === campName);
}

async function findExistingDuplicateCamp({ client, row }) {
  const campDate = parseLocalDateInput(row?.campDate);
  if (!campDate) return null;

  const doctorCode = trimStr(row.doctorCode);
  const doctorName = trimStr(row.doctorName);
  if (!doctorCode && !doctorName) return null;

  const filter = {
    isDeleted: false,
    status: { $in: ['pending_review', 'approved', 'executed'] },
    campDate,
    campaignType: trimStr(row.campaignType) || 'Screening',
  };

  if (client?._id) {
    filter.clientId = String(client._id);
  } else if (client?.name) {
    filter.clientName = new RegExp(`^${escapeRegex(client.name)}$`, 'i');
  } else {
    return null;
  }

  const candidates = await CampOpsCamp.find(filter);
  return candidates.find((camp) => doctorsMatch(row, camp)) || null;
}

async function buildBodyPreviewFromMappedRows(mappedRows, defaults = {}) {
  return Promise.all(
    mappedRows.map(async (row, index) => {
      const withDefaults = applyPasteDefaults(row, defaults);
      const enriched = await enrichPasteLocationFromPin(withDefaults);
      const rowForValidation = { ...enriched.row };
      const { validRows, invalidRows } = validateMappedImportRows([rowForValidation]);
      const validRow = validRows[0];
      const invalidRow = invalidRows[0];

      const entry = {
        rowNumber: index + 1,
        valid: Boolean(validRow),
        partial: false,
        partialFields: [],
        errors: invalidRow?.errors || [],
        row: (validRow || invalidRow)
          ? { ...(validRow || invalidRow), remarks: trimStr((validRow || invalidRow).remarks) }
          : null,
        pasteDisplay: enriched.display || null,
        pasteFormatted: '',
        block: '',
        duplicateOf: null,
      };

      if (!entry.valid || !entry.row) return entry;

      const client = await resolveClientForRow(entry.row, { allowCreate: false });
      if (client?._id) entry.row.clientName = client.name;

      const duplicate = await findExistingDuplicateCamp({ client, row: entry.row });
      if (duplicate) {
        entry.duplicateOf = {
          campId: duplicate.campId,
          id: duplicate._id,
          status: duplicate.status,
        };
        entry.errors = [
          ...(entry.errors || []),
          `Duplicate of existing camp ${duplicate.campId} for same client, division, date, and doctor`,
        ];
      }

      return entry;
    }),
  );
}

function mergeMapping(autoMapping = {}, manualMapping = {}) {
  const merged = { ...autoMapping };
  Object.entries(manualMapping || {}).forEach(([fieldKey, header]) => {
    if (header) merged[fieldKey] = header;
    else delete merged[fieldKey];
  });
  return merged;
}

function buildColumnResults(headers, mapping, fields) {
  const fieldByHeader = new Map(Object.entries(mapping).map(([fieldKey, header]) => [header, fieldKey]));

  return headers.map((header) => {
    const fieldKey = fieldByHeader.get(header) || null;
    const field = fieldKey ? fields.find((item) => item.key === fieldKey) : null;
    return {
      header,
      fieldKey,
      fieldLabel: field?.label || null,
      status: fieldKey ? 'mapped' : 'unmapped',
      confidence: fieldKey ? 'manual' : null,
    };
  });
}

export async function parsePasteImportFile(buffer, { fieldKeys = null } = {}) {
  if (!buffer?.length) {
    throw new AppError('Excel or CSV file is required', 400, 'VALIDATION_ERROR');
  }

  const parsed = parseExcelBuffer(buffer);
  const keys = fieldKeys ?? getImportFieldDefinitions().map((field) => field.key);
  const columnMatch = matchImportColumns(parsed.headers, keys);
  const fields = getImportFieldDefinitions(keys);

  return {
    sheetName: parsed.sheetName,
    headers: parsed.headers,
    rows: parsed.rows,
    sampleRows: parsed.sampleRows,
    totalRows: parsed.rows.length,
    fields,
    ...columnMatch,
    standardMapping: Object.fromEntries(fields.map((field) => [field.key, field.label])),
  };
}

export async function extractPasteImportPreview({
  buffer,
  fileName = 'upload',
  defaults = {},
  mapping = {},
  fieldKeys = CAMP_PASTE_TABULAR_FIELD_KEYS,
} = {}) {
  const defaultErrors = validatePasteDefaults(defaults);
  if (defaultErrors.length) {
    throw new AppError(defaultErrors.join('. '), 400, 'VALIDATION_ERROR');
  }

  const parsed = await parsePasteImportFile(buffer, { fieldKeys });
  const finalMapping = mergeMapping(parsed.mapping, mapping);
  const mappedRows = mapRows(parsed.rows, finalMapping, defaults.clientName);
  const bodyPreview = await buildBodyPreviewFromMappedRows(mappedRows, defaults);

  const unmappedHeaders = parsed.headers.filter(
    (header) => !Object.values(finalMapping).includes(header),
  );
  const unmappedFields = parsed.fields
    .filter((field) => !finalMapping[field.key])
    .map((field) => ({ key: field.key, label: field.label, required: Boolean(field.required) }));

  return {
    fileName,
    sheetName: parsed.sheetName,
    headers: parsed.headers,
    totalRows: parsed.totalRows,
    fields: parsed.fields,
    mapping: finalMapping,
    suggestions: parsed.suggestions,
    columnResults: buildColumnResults(parsed.headers, finalMapping, parsed.fields),
    unmappedHeaders,
    unmappedFields,
    missingRequiredFields: parsed.fields
      .filter((field) => field.required && !finalMapping[field.key])
      .map((field) => field.label),
    extractedAt: new Date().toISOString(),
    excelPreview: parsed.sampleRows,
    bodyPreview,
    summary: {
      excelFiles: 1,
      validBodyRows: bodyPreview.filter((row) => row.valid).length,
      invalidBodyRows: bodyPreview.filter((row) => !row.valid).length,
      duplicateBodyRows: bodyPreview.filter((row) => row.duplicateOf).length,
    },
  };
}

export async function extractPasteImportPreviewFromRows({
  rows = [],
  headers = [],
  fileName = 'upload',
  sheetName = 'Sheet1',
  defaults = {},
  mapping = {},
  fieldKeys = CAMP_PASTE_TABULAR_FIELD_KEYS,
} = {}) {
  const defaultErrors = validatePasteDefaults(defaults);
  if (defaultErrors.length) {
    throw new AppError(defaultErrors.join('. '), 400, 'VALIDATION_ERROR');
  }
  if (!rows.length) {
    throw new AppError('Import rows are required', 400, 'VALIDATION_ERROR');
  }

  const fields = getImportFieldDefinitions(fieldKeys);
  const columnMatch = headers.length ? matchImportColumns(headers, fieldKeys) : { mapping: {} };
  const finalMapping = mergeMapping(columnMatch.mapping, mapping);
  const mappedRows = mapRows(rows, finalMapping, defaults.clientName);
  const bodyPreview = await buildBodyPreviewFromMappedRows(mappedRows, defaults);

  return {
    fileName,
    sheetName,
    headers,
    totalRows: rows.length,
    fields,
    mapping: finalMapping,
    suggestions: columnMatch.mapping,
    columnResults: buildColumnResults(headers, finalMapping, fields),
    unmappedHeaders: headers.filter((header) => !Object.values(finalMapping).includes(header)),
    unmappedFields: fields
      .filter((field) => !finalMapping[field.key])
      .map((field) => ({ key: field.key, label: field.label, required: Boolean(field.required) })),
    missingRequiredFields: fields
      .filter((field) => field.required && !finalMapping[field.key])
      .map((field) => field.label),
    extractedAt: new Date().toISOString(),
    excelPreview: rows.slice(0, 5),
    bodyPreview,
    summary: {
      excelFiles: 1,
      validBodyRows: bodyPreview.filter((row) => row.valid).length,
      invalidBodyRows: bodyPreview.filter((row) => !row.valid).length,
      duplicateBodyRows: bodyPreview.filter((row) => row.duplicateOf).length,
    },
  };
}

export { buildBodyPreviewFromMappedRows };

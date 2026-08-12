import { AppError } from '../../utils/helpers.js';
import { importAppError } from '../../utils/importErrors.js';
import { parseTabularFile, safeUnlinkImport } from './communications/utils/tabularFileParse.js';
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
  parseLocalDateInput,
  trimStr,
  validateMappedImportRows,
} from './campOps.helpers.js';
import { CampOpsClient } from './campOps.model.js';
import { MAX_PREVIEW_BODY_ROWS } from '../../utils/spreadsheetLimits.js';
import { logMemory } from '../../utils/memory.js';
import {
  buildClientMasterImportCatalog,
  applyClientMasterValidationToResult,
} from './import/importClientMasterValidation.js';
import {
  buildCampDuplicateKey,
  buildDuplicatePreviewFlag,
  findExistingDuplicateCamp,
  formatDuplicateCampMessage,
} from './campDuplicate.js';

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

function markBatchDuplicateRows(entries = []) {
  const seen = new Map();
  return entries.map((entry) => {
    if (!entry?.row || entry.duplicateOf) return entry;
    const key = buildCampDuplicateKey({
      clientId: entry.row.clientId,
      clientName: entry.row.clientName,
      doctorName: entry.row.doctorName,
      campaignType: entry.row.campaignType,
      campDate: entry.row.campDate,
      startTime: entry.row.startTime,
    });
    if (!key) return entry;
    if (seen.has(key)) {
      const first = seen.get(key);
      return {
        ...entry,
        duplicateOf: {
          campId: first.campId || `row-${first.rowNumber}`,
          id: null,
          status: 'batch',
          batchRowNumber: first.rowNumber,
        },
        errors: [
          ...(entry.errors || []),
          `Duplicate of row ${first.rowNumber} for same client, doctor, division, date, and start time`,
        ],
      };
    }
    seen.set(key, { rowNumber: entry.rowNumber, campId: entry.row.campId || '' });
    return entry;
  });
}

async function buildBodyPreviewFromMappedRows(mappedRows, defaults = {}, catalog = null) {
  const clientMasterCatalog = catalog || await buildClientMasterImportCatalog();
  const capped = mappedRows.slice(0, MAX_PREVIEW_BODY_ROWS);
  const out = [];
  const BATCH = 50;
  for (let start = 0; start < capped.length; start += BATCH) {
    const chunk = capped.slice(start, start + BATCH);
    const entries = await Promise.all(
      chunk.map(async (row, offset) => {
        const index = start + offset;
        const withDefaults = applyPasteDefaults(row, defaults);
        const enriched = await enrichPasteLocationFromPin(withDefaults);
        const rowForValidation = { ...enriched.row };
        const { validRows, partialRows, invalidRows } = applyClientMasterValidationToResult(
          validateMappedImportRows(
            [rowForValidation],
            { source: 'excel', allowPartial: true },
          ),
          clientMasterCatalog,
        );
        const validRow = validRows[0];
        const partialRow = partialRows[0];
        const invalidRow = invalidRows[0];
        const creatableRow = validRow || partialRow;

        const entry = {
          rowNumber: index + 1,
          valid: Boolean(validRow),
          partial: Boolean(partialRow),
          partialFields: partialRow?.partialFields || [],
          completionPercent: partialRow?.completionPercent ?? (validRow ? 100 : 0),
          errors: invalidRow?.errors || partialRow?.errors || [],
          row: creatableRow
            ? { ...creatableRow, remarks: trimStr(creatableRow.remarks) }
            : invalidRow
              ? { ...invalidRow, remarks: trimStr(invalidRow.remarks) }
              : null,
          pasteDisplay: enriched.display || null,
          pasteFormatted: '',
          block: '',
          duplicateOf: null,
        };

        if (!creatableRow || !entry.row) return entry;

        const client = await resolveClientForRow(entry.row, { allowCreate: false });
        if (client?._id) entry.row.clientName = client.name;

        const duplicate = await findExistingDuplicateCamp({ client, row: entry.row });
        if (duplicate) {
          entry.duplicateOf = buildDuplicatePreviewFlag(duplicate);
          entry.errors = [
            ...(entry.errors || []),
            formatDuplicateCampMessage(duplicate),
          ];
        }

        return entry;
      }),
    );
    out.push(...entries);
  }
  return markBatchDuplicateRows(out);
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

export async function parsePasteImportFile(input, { fieldKeys = null } = {}) {
  let parsed;
  if (input && typeof input === 'object' && input.path) {
    logMemory('camp:parsePasteImportFile:start', { path: input.path });
    try {
      parsed = await parseTabularFile(input.path, {
        originalName: input.originalname || input.path,
      });
    } finally {
      safeUnlinkImport(input.path);
    }
  } else if (Buffer.isBuffer(input) || input?.length) {
    const buffer = Buffer.isBuffer(input) ? input : input;
    if (!buffer?.length) {
      throw importAppError('FILE_REQUIRED');
    }
    logMemory('camp:parsePasteImportFile:start', { bytes: buffer.length });
    parsed = parseExcelBuffer(buffer);
  } else {
    throw importAppError('FILE_REQUIRED');
  }

  const keys = fieldKeys ?? getImportFieldDefinitions().map((field) => field.key);
  const columnMatch = matchImportColumns(parsed.headers, keys);
  const fields = getImportFieldDefinitions(keys);
  logMemory('camp:parsePasteImportFile:done', { rows: parsed.rows.length });

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
  file,
  fileName = 'upload',
  defaults = {},
  mapping = {},
  fieldKeys = CAMP_PASTE_TABULAR_FIELD_KEYS,
} = {}) {
  const defaultErrors = validatePasteDefaults(defaults);
  if (defaultErrors.length) {
    throw new AppError(defaultErrors.join('. '), 400, 'VALIDATION_ERROR');
  }

  const parsed = await parsePasteImportFile(file || buffer, { fieldKeys });
  const finalMapping = mergeMapping(parsed.mapping, mapping);
  const mappedRows = mapRows(parsed.rows, finalMapping, defaults.clientName);
  const catalog = await buildClientMasterImportCatalog();
  const bodyPreview = await buildBodyPreviewFromMappedRows(mappedRows, defaults, catalog);

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
      partialBodyRows: bodyPreview.filter((row) => row.partial).length,
      invalidBodyRows: bodyPreview.filter((row) => !row.valid && !row.partial).length,
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
    throw importAppError(
      'No camp rows were provided to import. Upload a .csv/.xlsx/.xls/.xlsb file or paste rows, then try again.'
    );
  }

  const fields = getImportFieldDefinitions(fieldKeys);
  const columnMatch = headers.length ? matchImportColumns(headers, fieldKeys) : { mapping: {} };
  const finalMapping = mergeMapping(columnMatch.mapping, mapping);
  const mappedRows = mapRows(rows, finalMapping, defaults.clientName);
  const catalog = await buildClientMasterImportCatalog();
  const bodyPreview = await buildBodyPreviewFromMappedRows(mappedRows, defaults, catalog);

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
      partialBodyRows: bodyPreview.filter((row) => row.partial).length,
      invalidBodyRows: bodyPreview.filter((row) => !row.valid && !row.partial).length,
      duplicateBodyRows: bodyPreview.filter((row) => row.duplicateOf).length,
    },
  };
}

export { buildBodyPreviewFromMappedRows };

import { CampOpsCamp, CampOpsClient } from './campOps.model.js';
import { AppError } from '../../utils/helpers.js';
import {
  trimStr,
  escapeRegex,
  parseLocalDateInput,
  extractFieldsFromText,
  validateMappedImportRows,
  generateCampId,
  captureSubmissionTracking,
  withCampSchedule,
} from './campOps.helpers.js';
import { normalizeCampName } from './campOps.constants.js';

const BLOCK_SEPARATOR = /(?:^|\n)\s*(?:---+|===+|\*\*\*+)\s*(?:\n|$)/;

const DUPLICATE_STATUSES = ['pending_review', 'approved', 'executed'];

function splitPasteBlocks(text) {
  const raw = String(text || '').trim();
  if (!raw) return [];

  const blocks = raw
    .split(BLOCK_SEPARATOR)
    .map((block) => block.trim())
    .filter(Boolean);

  return blocks.length ? blocks : [raw];
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
    status: { $in: DUPLICATE_STATUSES },
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

function buildDuplicatePreviewFlag(existingCamp) {
  if (!existingCamp) return null;
  return {
    campId: existingCamp.campId,
    id: existingCamp._id,
    status: existingCamp.status,
  };
}

async function resolveClientForRow(row, { allowCreate = true } = {}) {
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

function normalizePasteDefaults(defaults = {}) {
  return {
    clientName: trimStr(defaults.clientName),
    campaignType: trimStr(defaults.campaignType),
    campaignName: normalizeCampName(defaults.campaignName),
  };
}

export function validatePasteDefaults(defaults = {}) {
  const normalized = normalizePasteDefaults(defaults);
  const errors = [];
  if (!normalized.clientName) errors.push('Client name is required');
  if (!normalized.campaignType) errors.push('Division / Therapy is required');
  if (!normalized.campaignName) errors.push('Method / Camp name is required');
  return errors;
}

function applyPasteDefaults(row = {}, defaults = {}) {
  const context = normalizePasteDefaults(defaults);
  return {
    ...row,
    clientName: trimStr(row.clientName) || context.clientName,
    campaignType: trimStr(row.campaignType) || context.campaignType,
    campaignName: normalizeCampName(row.campaignName) || context.campaignName,
  };
}

async function buildBodyPreview(text, defaults = {}) {
  const blocks = splitPasteBlocks(text);

  return Promise.all(
    blocks.map(async (block, index) => {
      const extracted = applyPasteDefaults(extractFieldsFromText(block), defaults);
      const { validRows, invalidRows } = validateMappedImportRows([extracted]);
      const validRow = validRows[0];
      const invalidRow = invalidRows[0];

      const entry = {
        rowNumber: index + 1,
        valid: Boolean(validRow),
        partial: false,
        partialFields: [],
        errors: invalidRow?.errors || [],
        row: (validRow || invalidRow)
          ? { ...(validRow || invalidRow), remarks: '' }
          : null,
        block,
        duplicateOf: null,
      };

      if (!entry.valid || !entry.row) {
        return entry;
      }

      const client = await resolveClientForRow(entry.row, { allowCreate: false });
      if (client?._id) {
        entry.row.clientName = client.name;
      }

      const duplicate = await findExistingDuplicateCamp({ client, row: entry.row });
      entry.duplicateOf = buildDuplicatePreviewFlag(duplicate);
      if (duplicate) {
        entry.errors = [
          ...(entry.errors || []),
          `Duplicate of existing camp ${duplicate.campId} for same client, division, date, and doctor`,
        ];
      }

      return entry;
    }),
  );
}

export async function extractManualPastePreview({ text = '', defaults = {} } = {}) {
  const bodyText = String(text || '').trim();
  if (!bodyText) {
    throw new AppError('Paste some camp details before extracting', 400, 'VALIDATION_ERROR');
  }

  const defaultErrors = validatePasteDefaults(defaults);
  if (defaultErrors.length) {
    throw new AppError(defaultErrors.join('. '), 400, 'VALIDATION_ERROR');
  }

  const bodyPreview = await buildBodyPreview(bodyText, defaults);

  return {
    extractedAt: new Date().toISOString(),
    excelPreview: [],
    bodyPreview,
    summary: {
      excelFiles: 0,
      validBodyRows: bodyPreview.filter((row) => row.valid).length,
      invalidBodyRows: bodyPreview.filter((row) => !row.valid).length,
      duplicateBodyRows: bodyPreview.filter((row) => row.duplicateOf).length,
    },
  };
}

export async function processManualPaste({ previewData, text = '', defaults = {} }, actor, helpers = {}) {
  const {
    resolveClientFromBody,
    campPayloadFromBody,
  } = helpers;

  const preview = previewData?.bodyPreview
    ? previewData
    : await extractManualPastePreview({ text, defaults });

  const bodyPreview = preview?.bodyPreview || [];
  if (!bodyPreview.length) {
    throw new AppError('No extractable camp data found. Run extract preview first.', 400, 'VALIDATION_ERROR');
  }

  const tracking = captureSubmissionTracking();
  const results = [];

  for (const entry of bodyPreview) {
    if (!entry.valid || !entry.row) {
      results.push({
        status: 'invalid',
        rowNumber: entry.rowNumber,
        errors: entry.errors || ['Invalid camp row'],
      });
      continue;
    }

    if (entry.duplicateOf?.campId) {
      results.push({
        status: 'duplicate',
        rowNumber: entry.rowNumber,
        campId: entry.duplicateOf.campId,
        id: entry.duplicateOf.id,
      });
      continue;
    }

    try {
      const client = await resolveClientFromBody(
        { clientName: entry.row.clientName || 'Unassigned' },
        { allowCreate: true },
      );
      const payload = campPayloadFromBody(
        {
          ...entry.row,
          source: 'paste',
          clientName: client?.name || entry.row.clientName,
        },
        null,
        client,
      );

      if (!payload.campDate) {
        throw new Error('Camp date is required');
      }

      const camp = await CampOpsCamp.create({
        ...payload,
        campId: await generateCampId(payload.campDate),
        status: 'pending_review',
        source: 'paste',
        createdById: actor.id,
        createdByEmail: actor.email,
        ...tracking,
      });

      results.push({
        status: 'created',
        rowNumber: entry.rowNumber,
        campId: camp.campId,
        id: camp._id,
      });
    } catch (error) {
      results.push({
        status: 'invalid',
        rowNumber: entry.rowNumber,
        errors: [error.message || 'Failed to create camp'],
      });
    }
  }

  const created = results.filter((item) => item.status === 'created');
  const duplicates = results.filter((item) => item.status === 'duplicate');

  if (!created.length) {
    if (duplicates.length) {
      throw new AppError(
        `No new camps created. ${duplicates.length} row(s) matched existing camps for the same client, division, date, and doctor.`,
        409,
        'DUPLICATE_CAMP',
      );
    }
    const firstError = results.find((item) => item.errors?.length)?.errors?.[0];
    throw new AppError(firstError || 'No camps could be created from the pasted content', 400, 'VALIDATION_ERROR');
  }

  return {
    created: created.length,
    campIds: created.map((item) => item.campId),
    camps: created.map((item) => withCampSchedule({ campId: item.campId, _id: item.id })),
    duplicates: duplicates.length,
    duplicateCampIds: duplicates.map((item) => item.campId),
    results,
  };
}

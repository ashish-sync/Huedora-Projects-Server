import { CampOpsCamp, CampOpsClient } from './campOps.model.js';
import { AppError } from '../../utils/helpers.js';
import {
  trimStr,
  escapeRegex,
  parseLocalDateInput,
  validateMappedImportRows,
  generateCampId,
  captureSubmissionTracking,
  withCampSchedule,
} from './campOps.helpers.js';
import { normalizeCampName } from './campOps.constants.js';
import { extractManualPasteFields, formatManualPasteOutput } from './manualPaste.extract.js';
import { enrichPasteLocationFromPin } from './manualPaste.enrich.js';
import {
  assertHistoricalCampDatesAllowed,
  canSetHistoricalCampDates,
  getHistoricalCampDateErrors,
  localTodayIso,
} from './campDatePolicy.js';
import {
  getPasteCreationBlockers,
  getRequestStageBlockers,
} from './campOps.requestValidation.js';
import { assistPasteBlockWithLlm } from './eventExtractor/index.js';
import { normalizePasteStartTime } from './pasteTimeNormalize.js';

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
    // Manual paste uses the method selected above — not parsed from pasted text.
    campaignName: context.campaignName,
  };
}

function extractFieldsFromPasteBlock(block) {
  const { row, display } = extractManualPasteFields(block);
  return {
    ...row,
    pasteDisplay: display,
    pasteFormatted: formatManualPasteOutput(display),
  };
}

async function enrichExtractedPasteFields(extracted) {
  const { pasteDisplay, pasteFormatted, ...row } = extracted;
  const enriched = await enrichPasteLocationFromPin(row, pasteDisplay);
  const nextDisplay = enriched.display;
  return {
    ...enriched.row,
    pasteDisplay: {
      ...nextDisplay,
      locationSource: enriched.locationSource || '',
    },
    pasteFormatted: formatManualPasteOutput(nextDisplay),
  };
}

function applyHistoricalDatePreviewFlags(entry, user) {
  if (!entry?.row) return entry;
  const campDate = parseLocalDateInput(entry.row.campDate) || trimStr(entry.row.campDate);
  if (!campDate) return entry;

  const historicalErrors = getHistoricalCampDateErrors(
    { campDate, requestDate: localTodayIso() },
    { canSetHistorical: canSetHistoricalCampDates(user) },
  );
  if (!historicalErrors.length) return entry;

  entry.errors = [...(entry.errors || []), ...historicalErrors];
  entry.historicalDateBlocked = true;
  // Keep row data for edit, but do not treat as importable until date is fixed.
  entry.valid = false;
  entry.partial = false;
  entry.creationEligible = false;
  entry.reviewStatus = 'REVIEW_REQUIRED';
  return entry;
}

async function buildBodyPreview(text, defaults = {}, { user, referenceDate = null, timezone = 'Asia/Kolkata' } = {}) {
  const blocks = splitPasteBlocks(text);
  const refDate = referenceDate || localTodayIso();

  return Promise.all(
    blocks.map(async (block, index) => {
      const extracted = applyPasteDefaults(
        await enrichExtractedPasteFields(extractFieldsFromPasteBlock(block)),
        defaults,
      );
      const { pasteDisplay, pasteFormatted, ...rowForValidation } = extracted;
      const { validRows, partialRows, invalidRows } = validateMappedImportRows(
        [rowForValidation],
        { source: 'paste', allowPartial: true },
      );
      const validRow = validRows[0];
      const partialRow = partialRows[0];
      const invalidRow = invalidRows[0];
      let creatableRow = validRow || partialRow;

      let entry = {
        rowNumber: index + 1,
        valid: Boolean(validRow),
        partial: Boolean(partialRow),
        partialFields: partialRow?.partialFields || [],
        completionPercent: partialRow?.completionPercent ?? (validRow ? 100 : 0),
        errors: invalidRow?.errors || partialRow?.errors || [],
        creationEligible: Boolean(
          validRow
          || partialRow?.creationEligible
          || (partialRow && !invalidRow),
        ),
        mandatoryMissing: invalidRow?.mandatoryMissing
          || partialRow?.mandatoryMissing
          || [],
        reviewStatus: invalidRow?.reviewStatus
          || (validRow ? 'READY' : partialRow ? 'REVIEW_REQUIRED' : 'REVIEW_REQUIRED'),
        row: creatableRow
          ? { ...creatableRow }
          : invalidRow
            ? { ...invalidRow }
            : { ...rowForValidation },
        pasteDisplay: extracted.pasteDisplay || null,
        pasteFormatted: extracted.pasteFormatted || '',
        block,
        duplicateOf: null,
        extraction: {
          method: 'deterministic',
          usedLlm: false,
          confidence: validRow ? 0.92 : partialRow ? 0.55 : 0.25,
          status: validRow ? 'READY' : 'REVIEW_REQUIRED',
          warnings: [],
          conflicts: [],
          fieldProvenance: {},
          peopleMatches: [],
        },
      };

      // Hybrid: AI fills gaps only when deterministic path is incomplete/ambiguous.
      const assist = await assistPasteBlockWithLlm({
        block,
        deterministicEntry: entry,
        referenceDate: refDate,
        timezone,
      });
      if (assist.rowPatch) {
        const enrichedAssist = await enrichPasteLocationFromPin(assist.rowPatch, {});
        const assisted = applyPasteDefaults(enrichedAssist.row, defaults);
        const revalidated = validateMappedImportRows([assisted], {
          source: 'paste',
          allowPartial: true,
        });
        const nextValid = revalidated.validRows[0];
        const nextPartial = revalidated.partialRows[0];
        const nextInvalid = revalidated.invalidRows[0];
        creatableRow = nextValid || nextPartial;
        const nextRow = creatableRow
          ? { ...creatableRow }
          : nextInvalid
            ? { ...nextInvalid }
            : { ...assisted };
        entry = {
          ...entry,
          valid: Boolean(nextValid),
          partial: Boolean(nextPartial),
          partialFields: nextPartial?.partialFields || [],
          completionPercent: nextPartial?.completionPercent ?? (nextValid ? 100 : 0),
          creationEligible: Boolean(
            nextValid
            || nextPartial?.creationEligible
            || (nextPartial && !nextInvalid),
          ),
          mandatoryMissing: nextInvalid?.mandatoryMissing
            || nextPartial?.mandatoryMissing
            || [],
          reviewStatus: nextInvalid?.reviewStatus
            || (nextValid ? 'READY' : 'REVIEW_REQUIRED'),
          errors: [
            ...(nextInvalid?.errors || nextPartial?.errors || []),
            ...(assist.meta.warnings || []),
          ],
          row: nextRow,
          pasteDisplay: {
            ...(extracted.pasteDisplay || {}),
            ...(enrichedAssist.display || {}),
          },
          pasteFormatted: formatManualPasteOutput({
            ...(extracted.pasteDisplay || {}),
            ...(enrichedAssist.display || {}),
          }),
          extraction: assist.meta,
        };
      } else if (assist.meta) {
        entry.extraction = { ...entry.extraction, ...assist.meta };
        if (assist.meta.warnings?.length) {
          entry.errors = [...new Set([...(entry.errors || []), ...assist.meta.warnings])];
        }
      }

      if (!creatableRow || !entry.row) {
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

      return applyHistoricalDatePreviewFlags(entry, user);
    }),
  );
}

export async function extractManualPastePreview({
  text = '',
  defaults = {},
  user,
  referenceDate = null,
  timezone = 'Asia/Kolkata',
} = {}) {
  const bodyText = String(text || '').trim();
  if (!bodyText) {
    throw new AppError('Paste some camp details before extracting', 400, 'VALIDATION_ERROR');
  }

  const defaultErrors = validatePasteDefaults(defaults);
  if (defaultErrors.length) {
    throw new AppError(defaultErrors.join('. '), 400, 'VALIDATION_ERROR');
  }

  const bodyPreview = await buildBodyPreview(bodyText, defaults, {
    user,
    referenceDate,
    timezone,
  });

  const creatableRows = bodyPreview.filter(
    (row) => (row.valid || row.partial) && !row.duplicateOf && !row.historicalDateBlocked,
  );

  return {
    extractedAt: new Date().toISOString(),
    excelPreview: [],
    bodyPreview,
    summary: {
      excelFiles: 0,
      validBodyRows: creatableRows.filter((row) => row.valid).length,
      partialBodyRows: creatableRows.filter((row) => row.partial).length,
      invalidBodyRows: bodyPreview.filter((row) => !row.valid && !row.partial).length,
      duplicateBodyRows: bodyPreview.filter((row) => row.duplicateOf).length,
      hybridAssistedRows: bodyPreview.filter((row) => row.extraction?.usedLlm).length,
    },
    referenceDate: referenceDate || localTodayIso(),
    timezone: timezone || 'Asia/Kolkata',
  };
}

export async function processManualPaste({ previewData, text = '', defaults = {} }, actor, helpers = {}) {
  const {
    resolveClientFromBody,
    campPayloadFromBody,
  } = helpers;

  const preview = previewData?.bodyPreview
    ? previewData
    : await extractManualPastePreview({ text, defaults, user: helpers.user });

  const bodyPreview = preview?.bodyPreview || [];
  if (!bodyPreview.length) {
    throw new AppError('No extractable camp data found. Run extract preview first.', 400, 'VALIDATION_ERROR');
  }

  const tracking = captureSubmissionTracking();
  const results = [];

  for (const entry of bodyPreview) {
    if (!entry?.row) {
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

    if (entry.historicalDateBlocked) {
      results.push({
        status: 'invalid',
        rowNumber: entry.rowNumber,
        errors: entry.errors || ['Historical camp dates are not allowed'],
      });
      continue;
    }

    // Creation gate is only the 4 mandatory fields — ignore stale valid/partial flags from edit.
    const pasteBlockers = getPasteCreationBlockers(entry.row);
    if (pasteBlockers.length) {
      results.push({
        status: 'invalid',
        rowNumber: entry.rowNumber,
        errors: pasteBlockers,
        mandatoryMissing: entry.mandatoryMissing || [],
      });
      continue;
    }

    try {
      const client = await resolveClientFromBody(
        { clientName: entry.row.clientName || 'Unassigned' },
        { allowCreate: true },
      );
      const today = localTodayIso();
      const normalizedStart = normalizePasteStartTime(entry.row.startTime) || trimStr(entry.row.startTime);
      const payload = campPayloadFromBody(
        {
          ...entry.row,
          startTime: normalizedStart,
          source: 'paste',
          clientName: client?.name || entry.row.clientName,
        },
        null,
        client,
        { allowPartial: true },
      );

      // Missing dates default to local today before policy checks (UTC ISO can be "yesterday").
      const requestDate = parseLocalDateInput(payload.requestDate) || today;
      if (!parseLocalDateInput(payload.campDate) && !trimStr(payload.campDate)) {
        payload.campDate = requestDate;
      }
      payload.requestDate = requestDate;

      assertHistoricalCampDatesAllowed(
        helpers.user,
        helpers.permissions,
        {
          campDate: payload.campDate,
          requestDate: payload.requestDate,
        },
      );

      const incomplete = getRequestStageBlockers(payload).length > 0;
      const camp = await CampOpsCamp.create({
        ...payload,
        campId: payload.campDate ? await generateCampId(payload.campDate) : await generateCampId(),
        status: 'pending_review',
        lifecycleStage: 'request',
        requestReviewStatus: 'review_pending',
        source: 'paste',
        requestIncomplete: incomplete,
        requestDate,
        createdById: actor.id,
        createdByEmail: actor.email,
        ...tracking,
      });

      results.push({
        status: incomplete ? 'created_partial' : 'created',
        rowNumber: entry.rowNumber,
        campId: camp.campId,
        id: camp._id,
        partial: incomplete,
        partialFields: entry.partialFields || [],
      });
    } catch (error) {
      // Surface policy failures immediately (do not bury as generic validation).
      if (error instanceof AppError && (error.status === 403 || error.code === 'FORBIDDEN')) {
        throw error;
      }
      results.push({
        status: 'invalid',
        rowNumber: entry.rowNumber,
        errors: [error.message || 'Failed to create camp'],
      });
    }
  }

  const created = results.filter((item) => item.status === 'created' || item.status === 'created_partial');
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
    partial: created.filter((item) => item.partial).length,
    results,
  };
}

export { applyPasteDefaults };

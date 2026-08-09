import { localTodayIso } from '../campDatePolicy.js';
import { trimStr } from '../campOps.helpers.js';
import { aiEventToCampRow } from './normalize.js';
import { mergeDeterministicAndAiRows, scoreExtractionConfidence } from './merge.js';
import { extractEventsWithOpenAi, isOpenAiExtractorEnabled } from './openai.js';
import {
  deterministicNeedsLlmAssist,
  isGarbageInput,
  validateCampExtractionRow,
} from './validate.js';
import { matchPeopleAgainstContacts } from './contactsMatch.js';

/**
 * After deterministic extraction+validation entry exists, optionally call OpenAI
 * to fill gaps. Returns enrichment metadata + a candidate row for re-validation.
 */
export async function assistPasteBlockWithLlm({
  block,
  deterministicEntry,
  referenceDate = null,
  timezone = 'Asia/Kolkata',
} = {}) {
  const meta = {
    method: 'deterministic',
    extractionMethod: 'deterministic',
    usedLlm: false,
    llmSkippedReason: null,
    confidence: deterministicEntry?.valid ? 0.92 : deterministicEntry?.partial ? 0.55 : 0.25,
    status: deterministicEntry?.valid ? 'READY' : deterministicEntry?.partial ? 'REVIEW_REQUIRED' : 'INVALID',
    warnings: [],
    conflicts: [],
    fieldProvenance: {},
    peopleMatches: [],
    aiError: null,
  };

  if (!deterministicNeedsLlmAssist(deterministicEntry)) {
    meta.llmSkippedReason = 'deterministic_complete';
    return { rowPatch: null, meta };
  }

  if (isGarbageInput(block)) {
    meta.status = 'INVALID';
    meta.warnings.push('Input looks empty or irrelevant');
    meta.llmSkippedReason = 'garbage_input';
    return { rowPatch: null, meta };
  }

  if (!isOpenAiExtractorEnabled()) {
    meta.llmSkippedReason = 'openai_disabled_or_unconfigured';
    meta.warnings.push('AI fallback unavailable (OPENAI_API_KEY not set); using deterministic extraction only');
    return { rowPatch: null, meta };
  }

  let aiPayload;
  try {
    aiPayload = await extractEventsWithOpenAi(block, {
      referenceDate: referenceDate || localTodayIso(),
      timezone,
    });
  } catch (err) {
    meta.aiError = {
      code: err?.code || 'AI_FAILED',
      message: err?.message || 'AI extraction failed',
    };
    meta.warnings.push(`AI fallback failed: ${meta.aiError.message}`);
    meta.llmSkippedReason = 'ai_error';
    return { rowPatch: null, meta };
  }

  if (aiPayload.garbage || !aiPayload.events?.length) {
    meta.warnings.push('AI classified input as non-event / garbage');
    meta.llmSkippedReason = 'ai_garbage';
    meta.status = deterministicEntry?.partial ? 'REVIEW_REQUIRED' : 'INVALID';
    return { rowPatch: null, meta };
  }

  // One paste block → prefer first event; multi-event blocks should be split upstream.
  const aiEvent = aiPayload.events[0];
  const aiRow = aiEventToCampRow(aiEvent, { referenceDate: referenceDate || localTodayIso() });
  const aiHadExplicitEnd = Boolean(trimStr(aiEvent?.event?.endTime));

  const baseRow = deterministicEntry?.row || {};
  const merged = mergeDeterministicAndAiRows(baseRow, aiRow, { aiHadExplicitEnd });
  const validation = validateCampExtractionRow(merged.row, {
    aiMeta: {
      warnings: [
        ...(aiEvent.metadata?.warnings || []),
        ...(aiPayload.notes || []),
      ],
      conflicts: [
        ...(aiEvent.metadata?.conflicts || []),
        ...merged.conflicts,
      ],
    },
  });

  let peopleMatches = [];
  try {
    peopleMatches = await matchPeopleAgainstContacts(aiRow.people || []);
  } catch {
    peopleMatches = [];
  }

  const confidence = scoreExtractionConfidence({
    deterministicValid: Boolean(deterministicEntry?.valid),
    filledByAi: merged.filledByAi,
    conflicts: merged.conflicts,
    validation,
    usedLlm: true,
  });

  meta.method = 'hybrid';
  meta.extractionMethod = 'hybrid';
  meta.usedLlm = true;
  meta.confidence = confidence;
  meta.status = validation.status;
  meta.warnings = [...new Set([...(validation.warnings || []), ...merged.conflicts.map((c) => `Conflict: ${c}`)])];
  meta.conflicts = [...new Set([...(validation.conflicts || []), ...merged.conflicts])];
  meta.fieldProvenance = merged.fieldProvenance;
  meta.peopleMatches = peopleMatches;
  meta.validationCodes = validation.codes;

  return { rowPatch: merged.row, meta };
}

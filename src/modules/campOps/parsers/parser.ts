/**
 * Camp Request Parser — main orchestrator.
 * Configuration-driven, client-agnostic, no AI.
 *
 * Modes:
 *   key_value  — label : value lines
 *   paragraph  — regex patterns on freeform text
 *   hybrid     — key_value first, paragraph fills gaps
 */

import type {
  CampFieldKey,
  CampRequestParseResult,
  ClientParserConfig,
  ExtractedField,
  MatchMethod,
  ParseCampRequestInput,
  ParagraphPattern,
  RawLabelValue,
} from './types.js';
import { resolveClientConfig } from './config.js';
import { DEFAULT_CONTACT_PRIORITY } from './fieldMappings.js';
import {
  buildAliasLookup,
  confidenceForMethod,
  emptyParsedFields,
  extractCityFromAddress,
  extractKeyValuePairs,
  extractPinFromText,
  mergeExtractedFields,
  normalizeFieldValue,
  parseTimeRange,
  resolveContactByPriority,
  resolveFieldFromLabel,
  sanitizeInputText,
} from './parserUtils.js';
import {
  buildMatchedFieldsList,
  buildValidation,
} from './validators.js';

/* -------------------------------------------------------------------------- */
/* Global paragraph patterns (all clients)                                    */
/* -------------------------------------------------------------------------- */

const GLOBAL_PARAGRAPH_PATTERNS: ParagraphPattern[] = [
  {
    id: 'planned-clinic-with-dr',
    regex:
      /^(.+?)\s+has\s+planned\s+(?:a\s+)?(?:health\s+)?clinic\s+with\s+Dr\.?\s*(.+?)\s*\.?\s*$/im,
    groups: { contact_person_name: 1, doctor_name: 2 },
    confidence: 90,
  },
  {
    id: 'dr-inline',
    regex: /\bDr\.?\s+([A-Z][A-Za-z]+(?:\s+[A-Z][A-Za-z]+)+)/,
    groups: { doctor_name: 1 },
    confidence: 85,
  },
  {
    id: 'pin-in-text',
    regex: /\b(\d{6})\b/,
    groups: { pincode: 1 },
    confidence: 80,
  },
];

/* -------------------------------------------------------------------------- */
/* Key-Value Parser (Mode 1)                                                 */
/* -------------------------------------------------------------------------- */

function parseKeyValueMode(
  text: string,
  config: ClientParserConfig,
  lookup: ReturnType<typeof buildAliasLookup>,
): {
  extracted: Map<CampFieldKey, ExtractedField>;
  unmapped: string[];
  pairs: RawLabelValue[];
} {
  const extracted = new Map<CampFieldKey, ExtractedField>();
  const unmapped: string[] = [];
  const ignore = config.ignoreLinePatterns || [];
  const pairs = extractKeyValuePairs(text, ignore);

  for (const pair of pairs) {
    const resolved = resolveFieldFromLabel(pair.label, lookup);

    if (!resolved) {
      if (pair.value && pair.label.length > 1) {
        unmapped.push(pair.label);
      }
      continue;
    }

    let value = pair.value;
    let method: MatchMethod = resolved.method;

    if (
      (resolved.field === 'camp_start_time' || resolved.field === 'camp_end_time') &&
      value
    ) {
      const range = parseTimeRange(value);
      if (range.start && range.end) {
        mergeExtractedFields(extracted, {
          field: 'camp_start_time',
          value: normalizeFieldValue('camp_start_time', range.start),
          method,
          confidence: confidenceForMethod(method),
          sourceLabel: resolved.sourceLabel,
        });
        mergeExtractedFields(extracted, {
          field: 'camp_end_time',
          value: normalizeFieldValue('camp_end_time', range.end),
          method,
          confidence: confidenceForMethod(method),
          sourceLabel: resolved.sourceLabel,
        });
      } else {
        const single = range.start || range.end || value;
        mergeExtractedFields(extracted, {
          field: resolved.field,
          value: normalizeFieldValue(resolved.field, single),
          method,
          confidence: confidenceForMethod(method),
          sourceLabel: resolved.sourceLabel,
        });
      }
      continue;
    }

    const normalized = normalizeFieldValue(resolved.field, value);
    mergeExtractedFields(extracted, {
      field: resolved.field,
      value: normalized,
      method,
      confidence: confidenceForMethod(method),
      sourceLabel: resolved.sourceLabel,
    });
  }

  return { extracted, unmapped, pairs };
}

/* -------------------------------------------------------------------------- */
/* Paragraph Parser (Mode 2)                                                  */
/* -------------------------------------------------------------------------- */

function applyParagraphPatterns(
  text: string,
  patterns: ParagraphPattern[],
  extracted: Map<CampFieldKey, ExtractedField>,
): void {
  for (const pattern of patterns) {
    const match = text.match(pattern.regex);
    if (!match) continue;

    const method: MatchMethod = 'regex';
    const confidence = pattern.confidence ?? confidenceForMethod(method);

    for (const [field, groupIndex] of Object.entries(pattern.groups)) {
      if (!groupIndex) continue;
      const raw = match[groupIndex];
      if (!raw) continue;

      const key = field as CampFieldKey;
      const value = normalizeFieldValue(key, raw.trim());
      if (!value) continue;

      mergeExtractedFields(extracted, {
        field: key,
        value,
        method,
        confidence,
        sourceLabel: pattern.id,
      });
    }
  }
}

function parseParagraphMode(
  text: string,
  config: ClientParserConfig,
  existing: Map<CampFieldKey, ExtractedField>,
): Map<CampFieldKey, ExtractedField> {
  const extracted = new Map(existing);
  const patterns = [
    ...(config.paragraphPatterns || []),
    ...GLOBAL_PARAGRAPH_PATTERNS,
  ];
  applyParagraphPatterns(text, patterns, extracted);
  return extracted;
}

/* -------------------------------------------------------------------------- */
/* Post-processing                                                            */
/* -------------------------------------------------------------------------- */

function applyContactPriority(
  pairs: RawLabelValue[],
  config: ClientParserConfig,
  lookup: ReturnType<typeof buildAliasLookup>,
  extracted: Map<CampFieldKey, ExtractedField>,
): void {
  const priority = config.contactPriority || DEFAULT_CONTACT_PRIORITY;
  const contact = resolveContactByPriority(pairs, lookup, priority);
  const preferPriority =
    config.parserMode === 'key_value' || config.parserMode === 'hybrid';

  if (contact.name && (preferPriority || !extracted.get('contact_person_name')?.value)) {
    extracted.set('contact_person_name', {
      field: 'contact_person_name',
      value: contact.name,
      method: 'inferred',
      confidence: confidenceForMethod('inferred'),
      sourceLabel: 'contact_priority',
    });
  }

  if (contact.phone && (preferPriority || !extracted.get('contact_person_number')?.value)) {
    extracted.set('contact_person_number', {
      field: 'contact_person_number',
      value: contact.phone,
      method: 'inferred',
      confidence: confidenceForMethod('inferred'),
      sourceLabel: 'contact_priority',
    });
  }
}

function applyAddressInference(
  pairs: RawLabelValue[],
  lookup: ReturnType<typeof buildAliasLookup>,
  extracted: Map<CampFieldKey, ExtractedField>,
): void {
  const addressLabels = ['address', 'campaddress', 'campvenue', 'completeaddress', 'venue'];
  let addressText = '';

  for (const pair of pairs) {
    const norm = pair.normalizedLabel;
    if (addressLabels.some((a) => norm.includes(a))) {
      addressText = pair.value;
      break;
    }
  }

  if (!addressText) return;

  if (!extracted.get('pincode')?.value) {
    const pin = extractPinFromText(addressText);
    if (pin) {
      mergeExtractedFields(extracted, {
        field: 'pincode',
        value: pin,
        method: 'inferred',
        confidence: confidenceForMethod('inferred'),
        sourceLabel: 'address',
      });
    }
  }

  if (!extracted.get('city')?.value) {
    const city = extractCityFromAddress(addressText);
    if (city) {
      mergeExtractedFields(extracted, {
        field: 'city',
        value: normalizeFieldValue('city', city),
        method: 'inferred',
        confidence: confidenceForMethod('inferred'),
        sourceLabel: 'address',
      });
    }
  }

  if (!extracted.get('hq')?.value && extracted.get('city')?.value) {
    mergeExtractedFields(extracted, {
      field: 'hq',
      value: extracted.get('city')!.value,
      method: 'inferred',
      confidence: confidenceForMethod('inferred'),
      sourceLabel: 'hq_equals_city',
    });
  }
}

function mapToParsedFields(
  extracted: Map<CampFieldKey, ExtractedField>,
): Record<CampFieldKey, string> {
  const fields = emptyParsedFields();
  for (const [key, entry] of extracted) {
    fields[key] = entry.value || '';
  }
  return fields;
}

function parserModeLabel(mode: ClientParserConfig['parserMode']): string {
  const labels: Record<ClientParserConfig['parserMode'], string> = {
    key_value: 'Key Value Parser',
    paragraph: 'Paragraph Parser',
    hybrid: 'Hybrid Parser',
  };
  return labels[mode] || 'Hybrid Parser';
}

/* -------------------------------------------------------------------------- */
/* Public API                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * Parse camp request text into structured JSON.
 * Pure function — no DB, no side effects. PIN validation enriched by service layer.
 */
export function parseCampRequest(input: ParseCampRequestInput): CampRequestParseResult {
  const text = sanitizeInputText(input.text);
  const config = resolveClientConfig(input.clientId, input.clientName);
  const lookup = buildAliasLookup(config);

  let extracted = new Map<CampFieldKey, ExtractedField>();
  let unmapped: string[] = [];
  let pairs: RawLabelValue[] = [];

  const runKeyValue = config.parserMode === 'key_value' || config.parserMode === 'hybrid';
  const runParagraph = config.parserMode === 'paragraph' || config.parserMode === 'hybrid';

  if (runKeyValue) {
    const kv = parseKeyValueMode(text, config, lookup);
    extracted = kv.extracted;
    unmapped = kv.unmapped;
    pairs = kv.pairs;
  }

  if (runParagraph) {
    extracted = parseParagraphMode(text, config, extracted);
    if (!pairs.length) {
      pairs = extractKeyValuePairs(text, config.ignoreLinePatterns || []);
    }
    if (config.parserMode === 'paragraph') {
      const kv = parseKeyValueMode(text, config, lookup);
      for (const field of kv.extracted.values()) {
        const isContactField =
          field.field === 'contact_person_name' || field.field === 'contact_person_number';
        if (isContactField && extracted.has(field.field)) {
          continue;
        }
        mergeExtractedFields(extracted, field);
      }
      unmapped = [...new Set([...unmapped, ...kv.unmapped])];
    }
  }

  applyContactPriority(pairs, config, lookup, extracted);
  applyAddressInference(pairs, lookup, extracted);

  const parsed_fields = mapToParsedFields(extracted);
  const validation = buildValidation(parsed_fields, extracted);
  const matched_fields = buildMatchedFieldsList(extracted);

  return {
    success: true,
    parsed_fields,
    validation,
    parser: {
      client: config.clientName,
      parser_used: parserModeLabel(config.parserMode),
      matched_fields,
      unmapped_labels: [...new Set(unmapped)],
    },
  };
}

export { resolveClientConfig, listClientParserConfigs } from './config.js';

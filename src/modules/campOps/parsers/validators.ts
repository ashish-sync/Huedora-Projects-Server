/**
 * Validation layer — warnings only, never rejects parsing.
 * PIN/city cross-check uses injected master data (no overwrites).
 */

import type {
  CampFieldKey,
  CampRequestParseResult,
  CityPincodeMatch,
  ExtractedField,
  ParsedFields,
  PinMasterRecord,
  ValidationContext,
} from './types.js';
import {
  CAMP_FIELD_KEYS,
  FIELD_DISPLAY_NAMES,
} from './fieldMappings.js';
import { confidenceForMethod } from './parserUtils.js';

/* -------------------------------------------------------------------------- */
/* Missing fields                                                             */
/* -------------------------------------------------------------------------- */

/** Fields commonly required for camp creation — used for warnings only. */
const COMMONLY_REQUIRED: CampFieldKey[] = [
  'camp_date',
  'camp_start_time',
  'doctor_name',
  'city',
];

export function collectMissingFields(fields: ParsedFields): string[] {
  const missing: string[] = [];

  for (const key of COMMONLY_REQUIRED) {
    if (!String(fields[key] ?? '').trim()) {
      missing.push(FIELD_DISPLAY_NAMES[key]);
    }
  }

  if (!fields.camp_start_time?.trim() && !fields.camp_end_time?.trim()) {
    if (!missing.includes(FIELD_DISPLAY_NAMES.camp_start_time)) {
      missing.push(FIELD_DISPLAY_NAMES.camp_start_time);
    }
  }

  return [...new Set(missing)];
}

/* -------------------------------------------------------------------------- */
/* City / PIN validation                                                      */
/* -------------------------------------------------------------------------- */

export function validateCityPincodeMatch(
  city: string,
  pincode: string,
  pinMaster: PinMasterRecord | null | undefined,
): CityPincodeMatch {
  const normalizedCity = String(city ?? '').trim().toLowerCase();
  const normalizedPin = String(pincode ?? '').replace(/\D/g, '');

  if (!normalizedPin || normalizedPin.length !== 6) {
    return 'unknown';
  }

  if (!pinMaster) {
    return 'unknown';
  }

  if (!normalizedCity) {
    return 'unknown';
  }

  const masterCity = String(pinMaster.cityName ?? '').trim().toLowerCase();
  if (!masterCity) return 'unknown';

  const match =
    masterCity === normalizedCity ||
    masterCity.includes(normalizedCity) ||
    normalizedCity.includes(masterCity);

  return match ? 'true' : 'false';
}

export function buildPinWarnings(
  fields: ParsedFields,
  ctx: ValidationContext,
): string[] {
  const warnings: string[] = [];
  const pin = String(fields.pincode ?? '').replace(/\D/g, '');

  if (pin.length === 6 && ctx.pinMaster) {
  const match = validateCityPincodeMatch(fields.city, pin, ctx.pinMaster);
    if (match === 'false') {
      warnings.push(
        `City "${fields.city}" does not match PIN master city "${ctx.pinMaster.cityName}" for PIN ${pin}`,
      );
    }
    if (!fields.city && ctx.pinSuggestions?.city) {
      warnings.push(
        `PIN ${pin} maps to city "${ctx.pinSuggestions.city}" — consider filling City`,
      );
    }
  }

  if (pin.length > 0 && pin.length !== 6) {
    warnings.push(`PIN "${fields.pincode}" is not a valid 6-digit code`);
  }

  if (fields.contact_person_number && fields.contact_person_number.length !== 10) {
    warnings.push('Contact number is not a valid 10-digit mobile');
  }

  if (fields.camp_date && !/^\d{4}-\d{2}-\d{2}$/.test(fields.camp_date)) {
    warnings.push(`Camp date "${fields.camp_date}" could not be normalized to YYYY-MM-DD`);
  }

  return warnings;
}

/* -------------------------------------------------------------------------- */
/* Confidence                                                                 */
/* -------------------------------------------------------------------------- */

export function calculateOverallConfidence(
  extracted: Map<CampFieldKey, ExtractedField>,
): number {
  const values = [...extracted.values()].filter((e) => e.value);
  if (!values.length) return 0;

  const total = values.reduce((sum, e) => sum + e.confidence, 0);
  return Math.round(total / values.length);
}

export function buildMatchedFieldsList(
  extracted: Map<CampFieldKey, ExtractedField>,
): string[] {
  return CAMP_FIELD_KEYS.filter((key) => {
    const entry = extracted.get(key);
    return Boolean(entry?.value);
  });
}

/* -------------------------------------------------------------------------- */
/* Full validation assembly                                                   */
/* -------------------------------------------------------------------------- */

export function buildValidation(
  fields: ParsedFields,
  extracted: Map<CampFieldKey, ExtractedField>,
  ctx: ValidationContext = {},
): CampRequestParseResult['validation'] {
  const missing_fields = collectMissingFields(fields);
  const warnings = buildPinWarnings(fields, ctx);
  const confidence = calculateOverallConfidence(extracted);

  const city_pincode_match = validateCityPincodeMatch(
    fields.city,
    fields.pincode,
    ctx.pinMaster ?? null,
  );

  return {
    city_pincode_match,
    missing_fields,
    warnings,
    confidence,
  };
}

/** Helper for tests — confidence from method name. */
export { confidenceForMethod };

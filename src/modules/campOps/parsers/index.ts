/**
 * Camp Request Parser — public exports.
 */

export { parseCampRequest, resolveClientConfig, listClientParserConfigs } from './parser.js';
export { buildValidation, validateCityPincodeMatch, calculateOverallConfidence } from './validators.js';
export {
  normalizeLabel,
  normalizeDate,
  normalizeTimeToken,
  normalizePhoneNumber,
  normalizePersonName,
  parseTimeRange,
  extractKeyValuePairs,
} from './parserUtils.js';
export {
  GLOBAL_FIELD_ALIASES,
  CAMP_FIELD_KEYS,
  FIELD_DISPLAY_NAMES,
  DEFAULT_CONTACT_PRIORITY,
} from './fieldMappings.js';
export { CLIENT_PARSER_REGISTRY, GENERIC_CLIENT_CONFIG } from './config.js';
export type {
  CampFieldKey,
  ParsedFields,
  CampRequestParseResult,
  ClientParserConfig,
  ParseCampRequestInput,
  ParserAuditRecord,
  PinMasterRecord,
  ValidationContext,
} from './types.js';

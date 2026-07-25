/**
 * Camp Request Parser — core type definitions.
 * Enterprise parser for email / WhatsApp / plain-text camp requests.
 */

/** Canonical output field keys (snake_case API contract). */
export type CampFieldKey =
  | 'camp_date'
  | 'camp_start_time'
  | 'camp_end_time'
  | 'doctor_name'
  | 'doctor_code'
  | 'city'
  | 'pincode'
  | 'hq'
  | 'expected_patients'
  | 'contact_person_name'
  | 'contact_person_number';

export type ParsedFields = Record<CampFieldKey, string>;

export type MatchMethod =
  | 'exact_label'
  | 'client_alias'
  | 'global_alias'
  | 'regex'
  | 'inferred';

export type ParserMode = 'key_value' | 'paragraph' | 'hybrid';

export type CityPincodeMatch = 'true' | 'false' | 'unknown';

export interface FieldMatchMeta {
  field: CampFieldKey;
  method: MatchMethod;
  confidence: number;
  sourceLabel?: string;
}

export interface ParagraphPattern {
  /** Human-readable pattern id for audit / config. */
  id: string;
  /** Regex with capture groups mapped via `groups`. */
  regex: RegExp;
  /** Map capture group index (1-based) → field key. */
  groups: Partial<Record<CampFieldKey, number>>;
  confidence?: number;
}

export interface ContactRoleConfig {
  role: string;
  nameAliases: string[];
  phoneAliases: string[];
}

export interface ClientParserConfig {
  /** Stable id, e.g. `abbott` */
  clientId: string;
  clientName: string;
  parserMode: ParserMode;
  /** Client-specific label aliases overriding / extending global dictionary. */
  fieldAliases?: Partial<Record<CampFieldKey, string[]>>;
  /** Paragraph-mode regex patterns (client-specific). */
  paragraphPatterns?: ParagraphPattern[];
  /** Ordered contact priority (first match wins). */
  contactPriority?: ContactRoleConfig[];
  /** Lines matching these patterns are ignored during key-value extraction. */
  ignoreLinePatterns?: RegExp[];
}

export interface ParserValidation {
  city_pincode_match: CityPincodeMatch;
  missing_fields: string[];
  warnings: string[];
  confidence: number;
}

export interface ParserMeta {
  client: string;
  parser_used: string;
  matched_fields: string[];
  unmapped_labels: string[];
}

export interface CampRequestParseResult {
  success: boolean;
  parsed_fields: ParsedFields;
  validation: ParserValidation;
  parser: ParserMeta;
}

export interface ParseCampRequestInput {
  text: string;
  clientId?: string;
  clientName?: string;
}

/** Internal: raw key-value pairs before field resolution. */
export interface RawLabelValue {
  label: string;
  normalizedLabel: string;
  value: string;
  line: number;
}

/** Internal: per-field extraction with provenance. */
export interface ExtractedField {
  field: CampFieldKey;
  value: string;
  method: MatchMethod;
  confidence: number;
  sourceLabel?: string;
}

/** PIN master lookup injected by service layer (keeps parser pure). */
export interface PinMasterRecord {
  pinCode: string;
  cityName: string;
  stateName: string;
}

export interface ValidationContext {
  pinMaster?: PinMasterRecord | null;
  /** Suggested city/state from PIN master — never overwrites parsed_fields. */
  pinSuggestions?: { city?: string; state?: string };
}

export interface ParserAuditRecord {
  originalMessage: string;
  parsed: CampRequestParseResult;
  clientId: string;
  clientName: string;
  timestamp: string;
  actorId?: string;
  actorEmail?: string;
}

/** Display names for missing-field reporting. */
export type MissingFieldLabel = string;

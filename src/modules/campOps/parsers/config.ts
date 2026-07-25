/**
 * Client parser configurations.
 * Adding a new client = add one entry here. No parser code changes.
 */

import type { ClientParserConfig } from './types.js';
import { DEFAULT_CONTACT_PRIORITY, DEFAULT_IGNORE_LINE_PATTERNS } from './fieldMappings.js';

/** Generic fallback used when client is unknown or not configured. */
export const GENERIC_CLIENT_CONFIG: ClientParserConfig = {
  clientId: 'generic',
  clientName: 'Generic',
  parserMode: 'hybrid',
  contactPriority: DEFAULT_CONTACT_PRIORITY,
  ignoreLinePatterns: DEFAULT_IGNORE_LINE_PATTERNS,
};

/**
 * Abbott — Paragraph Parser with client-specific aliases.
 * Example: "Clinic Date" → camp_date, "Expected patient count" → expected_patients
 */
export const ABBOTT_CLIENT_CONFIG: ClientParserConfig = {
  clientId: 'abbott',
  clientName: 'Abbott',
  parserMode: 'paragraph',
  fieldAliases: {
    camp_date: ['Clinic Date', 'Activity Date'],
    expected_patients: ['Expected patient count', 'Patient Count', 'Footfall'],
    doctor_name: ['Dr Name', 'Physician Name'],
    camp_start_time: ['Time', 'Slot'],
    city: ['Station', 'Town'],
    hq: ['Territory', 'Head Quarter'],
  },
  paragraphPatterns: [
    {
      id: 'abbott-planned-clinic',
      regex:
        /^(.+?)\s+has\s+planned\s+(?:a\s+)?health\s+clinic\s+with\s+Dr\.?\s*(.+?)\s*\.?\s*$/im,
      groups: { contact_person_name: 1, doctor_name: 2 },
      confidence: 90,
    },
    {
      id: 'abbott-clinic-with-dr',
      regex: /health\s+clinic\s+with\s+Dr\.?\s*([A-Za-z][A-Za-z\s.]+)/i,
      groups: { doctor_name: 1 },
      confidence: 90,
    },
  ],
  contactPriority: DEFAULT_CONTACT_PRIORITY,
  ignoreLinePatterns: DEFAULT_IGNORE_LINE_PATTERNS,
};

/** Dr Reddy's — Key-Value heavy format. */
export const DR_REDDYS_CLIENT_CONFIG: ClientParserConfig = {
  clientId: 'dr-reddys',
  clientName: "Dr. Reddy's",
  parserMode: 'key_value',
  fieldAliases: {
    doctor_name: ['Dr Name', 'HCP Name'],
    doctor_code: ['SC CODE', 'Plan Dr'],
    camp_date: ['Visit Date', 'Clinic Date'],
    contact_person_name: ['SE Name', 'Field Team Name'],
    contact_person_number: ['SE Mobile', 'Field Team Mobile'],
  },
  contactPriority: DEFAULT_CONTACT_PRIORITY,
  ignoreLinePatterns: DEFAULT_IGNORE_LINE_PATTERNS,
};

/** Cipla — hybrid with WhatsApp-style freeform. */
export const CIPLA_CLIENT_CONFIG: ClientParserConfig = {
  clientId: 'cipla',
  clientName: 'Cipla',
  parserMode: 'hybrid',
  fieldAliases: {
    doctor_name: ['Consultant', 'Doctor'],
    expected_patients: ['Target Patients'],
  },
  paragraphPatterns: [
    {
      id: 'cipla-dr-line',
      regex: /Dr\.?\s*([A-Za-z][A-Za-z\s.]+?)(?:\s*[-,]|\s+Code|\s+Mobile|\n|$)/i,
      groups: { doctor_name: 1 },
      confidence: 88,
    },
  ],
  contactPriority: DEFAULT_CONTACT_PRIORITY,
  ignoreLinePatterns: DEFAULT_IGNORE_LINE_PATTERNS,
};

/** Registry: clientId (lowercase) → config. */
export const CLIENT_PARSER_REGISTRY: Record<string, ClientParserConfig> = {
  generic: GENERIC_CLIENT_CONFIG,
  abbott: ABBOTT_CLIENT_CONFIG,
  'dr-reddys': DR_REDDYS_CLIENT_CONFIG,
  cipla: CIPLA_CLIENT_CONFIG,
};

/**
 * Resolve client config by id or display name.
 * Falls back to generic hybrid parser.
 */
export function resolveClientConfig(
  clientId?: string,
  clientName?: string,
): ClientParserConfig {
  const idKey = String(clientId || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '-');
  if (idKey && CLIENT_PARSER_REGISTRY[idKey]) {
    return CLIENT_PARSER_REGISTRY[idKey];
  }

  const nameKey = String(clientName || '')
    .trim()
    .toLowerCase();
  const byName = Object.values(CLIENT_PARSER_REGISTRY).find(
    (cfg) => cfg.clientName.toLowerCase() === nameKey,
  );
  if (byName) return byName;

  if (clientName) {
    return { ...GENERIC_CLIENT_CONFIG, clientId: idKey || 'generic', clientName };
  }

  return GENERIC_CLIENT_CONFIG;
}

/** List all registered client parser configs (for UI dropdown). */
export function listClientParserConfigs(): ClientParserConfig[] {
  return Object.values(CLIENT_PARSER_REGISTRY);
}

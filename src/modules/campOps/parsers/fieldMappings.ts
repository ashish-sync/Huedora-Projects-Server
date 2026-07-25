/**
 * Global field alias dictionary.
 * Every canonical field maps to unlimited label variants.
 * Client configs may extend or override via config.ts.
 */

import type { CampFieldKey } from './types.js';

/** All supported output fields in stable order. */
export const CAMP_FIELD_KEYS: CampFieldKey[] = [
  'camp_date',
  'camp_start_time',
  'camp_end_time',
  'doctor_name',
  'doctor_code',
  'city',
  'pincode',
  'hq',
  'expected_patients',
  'contact_person_name',
  'contact_person_number',
];

/** Human-readable labels for missing-field reporting. */
export const FIELD_DISPLAY_NAMES: Record<CampFieldKey, string> = {
  camp_date: 'Date',
  camp_start_time: 'Time',
  camp_end_time: 'End Time',
  doctor_name: 'Doctor',
  doctor_code: 'Doctor Code',
  city: 'City',
  pincode: 'PIN',
  hq: 'HQ',
  expected_patients: 'Expected Patients',
  contact_person_name: 'Contact Person',
  contact_person_number: 'Contact Number',
};

/**
 * Global alias dictionary — shared across all clients.
 * Normalized matching happens in parserUtils.normalizeLabel().
 */
export const GLOBAL_FIELD_ALIASES: Record<CampFieldKey, string[]> = {
  camp_date: [
    'Date',
    'Clinic Date',
    'Camp Date',
    'Activity Date',
    'Visit Date',
    'Event Date',
    'Schedule Date',
  ],
  camp_start_time: [
    'Time',
    'Start Time',
    'Camp Start Time',
    'Slot',
    'Session',
    'Camp Time',
    'From Time',
    'In Time',
  ],
  camp_end_time: [
    'Time To',
    'End Time',
    'Camp End Time',
    'Session End',
    'To Time',
    'Out Time',
  ],
  doctor_name: [
    'Doctor',
    'Doctor Name',
    'Dr',
    'Dr Name',
    'Physician',
    'Consultant',
    'HCP Name',
    'Doctors Name',
  ],
  doctor_code: [
    'Doctor Code',
    'SC Code',
    'SC CODE',
    'Plan Dr',
    'Doctor ID',
    'Dr Code',
    'SE Code',
  ],
  city: [
    'City',
    'Station',
    'Location',
    'Town',
    'Name of City',
    'Camp City',
  ],
  pincode: [
    'PIN',
    'Pin',
    'Pincode',
    'PIN Code',
    'Postal Code',
    'Zip Code',
    'Zip',
  ],
  hq: [
    'HQ',
    'Head Quarter',
    'Headquarters',
    'Territory',
    'Region',
  ],
  expected_patients: [
    'Patients',
    'Expected Patient',
    'Expected Patients',
    'Patient Count',
    'Expected patient count',
    'Footfall',
    'Target Patients',
    'Expected Footfall',
  ],
  contact_person_name: [
    'SE Name',
    'Representative',
    'Coordinator',
    'Contact Person',
    'Technician',
    'Technician Name',
    'Field Person Name',
    'Field Person',
    'MR Name',
    'BO Name',
    'RSM Name',
    'ABM Name',
    'FLM Name',
  ],
  contact_person_number: [
    'SE Mobile',
    'Representative Mobile',
    'Coordinator Mobile',
    'Technician Mobile',
    'RSM Mobile',
    'ABM Mobile',
    'BO Contact No',
    'BO Mobile',
    'FLM Mob No',
    'Mobile No',
    'Contact Number',
    'Technician Contact',
    'Field Person Contact',
  ],
};

/** Confidence score per match method (rule-based, no AI). */
export const MATCH_METHOD_CONFIDENCE: Record<string, number> = {
  exact_label: 100,
  client_alias: 98,
  global_alias: 95,
  regex: 90,
  inferred: 50,
};

/**
 * Default contact priority when client config does not override.
 * First available role wins (Technician → SE → Representative → Coordinator → RSM).
 */
export const DEFAULT_CONTACT_PRIORITY = [
  {
    role: 'technician',
    nameAliases: ['Technician', 'Technician Name'],
    phoneAliases: ['Technician Mobile', 'Technician Contact'],
  },
  {
    role: 'se',
    nameAliases: ['SE Name', 'SE'],
    phoneAliases: ['SE Mobile', 'SE Mobile No'],
  },
  {
    role: 'representative',
    nameAliases: ['Representative', 'MR Name', 'Field Person'],
    phoneAliases: ['Representative Mobile', 'MR Mobile'],
  },
  {
    role: 'coordinator',
    nameAliases: ['Coordinator', 'Contact Person'],
    phoneAliases: ['Coordinator Mobile', 'Contact Number'],
  },
  {
    role: 'rsm',
    nameAliases: ['RSM Name'],
    phoneAliases: ['RSM Mobile'],
  },
];

/** Lines ignored during key-value extraction (technician-only rows, metadata). */
export const DEFAULT_IGNORE_LINE_PATTERNS: RegExp[] = [
  /^\s*client\b/i,
  /^\s*camp\s*type\b/i,
  /^\s*reminder\b/i,
  /^\s*request\s*source\b/i,
  /^\s*specialit/i,
  /^\s*patch\b/i,
  /^\s*activity\s*name\b/i,
];

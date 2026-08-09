/**
 * Canonical AI extraction schema (Zod). Raw AI output never reaches the DB —
 * it is merged into camp paste rows after deterministic normalization.
 */
import { z } from 'zod';

const nullableString = z.union([z.string(), z.null()]).optional().transform((v) => {
  if (v == null) return null;
  const t = String(v).trim();
  return t || null;
});

const provenance = z.enum([
  'explicit',
  'normalized',
  'master_matched',
  'fuzzy_matched',
  'inferred',
]).optional();

export const AiPersonSchema = z.object({
  role: nullableString,
  name: nullableString,
  employeeCode: nullableString,
  scCode: nullableString,
  speciality: nullableString,
  mobileNumbers: z.array(z.string()).optional().default([]),
  hq: nullableString,
  provenance: provenance.optional(),
});

export const AiEventSchema = z.object({
  event: z.object({
    date: nullableString,
    day: nullableString,
    startTime: nullableString,
    endTime: nullableString,
    expectedPatients: z.union([z.number(), z.string(), z.null()]).optional().nullable(),
  }).optional().default({}),
  location: z.object({
    venue: nullableString,
    address: nullableString,
    area: nullableString,
    city: nullableString,
    state: nullableString,
    pincode: nullableString,
    stationPatch: nullableString,
    hq: nullableString,
    rawAddress: nullableString,
  }).optional().default({}),
  people: z.array(AiPersonSchema).optional().default([]),
  metadata: z.object({
    sourceText: nullableString,
    warnings: z.array(z.string()).optional().default([]),
    conflicts: z.array(z.string()).optional().default([]),
    confidence: z.number().min(0).max(1).optional().nullable(),
  }).optional().default({}),
});

export const AiExtractionResponseSchema = z.object({
  events: z.array(AiEventSchema).default([]),
  garbage: z.boolean().optional().default(false),
  notes: z.array(z.string()).optional().default([]),
});

export const OPENAI_EVENT_JSON_SCHEMA = {
  name: 'camp_event_extraction',
  strict: true,
  schema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      garbage: { type: 'boolean' },
      notes: { type: 'array', items: { type: 'string' } },
      events: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            event: {
              type: 'object',
              additionalProperties: false,
              properties: {
                date: { type: ['string', 'null'] },
                day: { type: ['string', 'null'] },
                startTime: { type: ['string', 'null'] },
                endTime: { type: ['string', 'null'] },
                expectedPatients: { type: ['number', 'string', 'null'] },
              },
              required: ['date', 'day', 'startTime', 'endTime', 'expectedPatients'],
            },
            location: {
              type: 'object',
              additionalProperties: false,
              properties: {
                venue: { type: ['string', 'null'] },
                address: { type: ['string', 'null'] },
                area: { type: ['string', 'null'] },
                city: { type: ['string', 'null'] },
                state: { type: ['string', 'null'] },
                pincode: { type: ['string', 'null'] },
                stationPatch: { type: ['string', 'null'] },
                hq: { type: ['string', 'null'] },
                rawAddress: { type: ['string', 'null'] },
              },
              required: [
                'venue', 'address', 'area', 'city', 'state',
                'pincode', 'stationPatch', 'hq', 'rawAddress',
              ],
            },
            people: {
              type: 'array',
              items: {
                type: 'object',
                additionalProperties: false,
                properties: {
                  role: { type: ['string', 'null'] },
                  name: { type: ['string', 'null'] },
                  employeeCode: { type: ['string', 'null'] },
                  scCode: { type: ['string', 'null'] },
                  speciality: { type: ['string', 'null'] },
                  mobileNumbers: { type: 'array', items: { type: 'string' } },
                  hq: { type: ['string', 'null'] },
                },
                required: [
                  'role', 'name', 'employeeCode', 'scCode',
                  'speciality', 'mobileNumbers', 'hq',
                ],
              },
            },
            metadata: {
              type: 'object',
              additionalProperties: false,
              properties: {
                sourceText: { type: ['string', 'null'] },
                warnings: { type: 'array', items: { type: 'string' } },
                conflicts: { type: 'array', items: { type: 'string' } },
                confidence: { type: ['number', 'null'] },
              },
              required: ['sourceText', 'warnings', 'conflicts', 'confidence'],
            },
          },
          required: ['event', 'location', 'people', 'metadata'],
        },
      },
    },
    required: ['events', 'garbage', 'notes'],
  },
};

export const EXTRACTION_SYSTEM_PROMPT = `You extract healthcare camp/event details from messy operational text (WhatsApp, email, OCR, free-form).

Rules:
- Never invent missing information. Use null when unknown.
- Never invent an end time. If only one time is present, set startTime and leave endTime null.
- Do not invent duration.
- Support multiple events in one input as separate items in events[].
- Preserve ambiguous values in metadata.warnings / conflicts instead of guessing.
- People must be an array with roles such as Doctor, Employee, Technician, Phlebotomist, SE, RSM, ASM, ZSM, FLM, Manager, Coordinator, Contact, Other.
- Put mobile numbers in people[].mobileNumbers (array). Include +91 variants as given; do not invent numbers.
- Dates may appear in many formats; return the date string as written when unsure — backend normalizes.
- Relative dates (tomorrow, next Monday) may be returned as the relative phrase; backend resolves them.
- If the text is irrelevant garbage with no camp/event, set garbage=true and events=[].
- Prefer explicit labeled values over inference.
- location.rawAddress should preserve the original address phrase when present.`;

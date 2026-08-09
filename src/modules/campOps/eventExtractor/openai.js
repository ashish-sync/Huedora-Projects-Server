import { env } from '../../../config/env.js';
import { AppError } from '../../../utils/helpers.js';
import {
  AiExtractionResponseSchema,
  EXTRACTION_SYSTEM_PROMPT,
  OPENAI_EVENT_JSON_SCHEMA,
} from './schema.js';

const DEFAULT_TIMEOUT_MS = 25000;

export function isOpenAiExtractorEnabled() {
  return Boolean(env.openaiApiKey) && env.eventExtractorEnabled !== false;
}

/**
 * Call OpenAI Chat Completions with structured JSON schema.
 * Returns parsed Zod-validated object. Never invents a fake success.
 */
export async function extractEventsWithOpenAi(text, {
  referenceDate = null,
  timezone = 'Asia/Kolkata',
  signal,
} = {}) {
  if (!env.openaiApiKey) {
    throw new AppError('OpenAI API key is not configured', 503, 'AI_NOT_CONFIGURED');
  }

  const model = env.openaiModel || 'gpt-4o-mini';
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), env.openaiTimeoutMs || DEFAULT_TIMEOUT_MS);
  if (signal) {
    signal.addEventListener('abort', () => controller.abort(), { once: true });
  }

  const userPayload = {
    referenceDate: referenceDate || null,
    timezone,
    text,
  };

  let response;
  try {
    response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.openaiApiKey}`,
        'Content-Type': 'application/json',
      },
      signal: controller.signal,
      body: JSON.stringify({
        model,
        temperature: 0,
        response_format: {
          type: 'json_schema',
          json_schema: OPENAI_EVENT_JSON_SCHEMA,
        },
        messages: [
          { role: 'system', content: EXTRACTION_SYSTEM_PROMPT },
          {
            role: 'user',
            content: `Extract camp/event details. referenceDate=${userPayload.referenceDate}; timezone=${timezone}.\n\nINPUT:\n${text}`,
          },
        ],
      }),
    });
  } catch (err) {
    if (err?.name === 'AbortError') {
      throw new AppError('AI extraction timed out', 504, 'AI_TIMEOUT');
    }
    throw new AppError(`AI extraction request failed: ${err?.message || 'network error'}`, 502, 'AI_REQUEST_FAILED');
  } finally {
    clearTimeout(timeout);
  }

  let json;
  try {
    json = await response.json();
  } catch {
    throw new AppError('AI extraction returned non-JSON response', 502, 'AI_BAD_RESPONSE');
  }

  if (!response.ok) {
    const message = json?.error?.message || `OpenAI error (${response.status})`;
    const code = response.status === 429 ? 'AI_RATE_LIMITED' : 'AI_PROVIDER_ERROR';
    throw new AppError(message, response.status === 429 ? 429 : 502, code);
  }

  const content = json?.choices?.[0]?.message?.content;
  if (!content) {
    throw new AppError('AI extraction returned empty content', 502, 'AI_EMPTY_RESPONSE');
  }

  let parsed;
  try {
    parsed = JSON.parse(content);
  } catch {
    throw new AppError('AI extraction returned invalid JSON', 502, 'AI_INVALID_JSON');
  }

  const validated = AiExtractionResponseSchema.safeParse(parsed);
  if (!validated.success) {
    throw new AppError(
      `AI extraction failed schema validation: ${validated.error.issues.slice(0, 3).map((i) => i.message).join('; ')}`,
      502,
      'AI_SCHEMA_INVALID'
    );
  }

  return validated.data;
}

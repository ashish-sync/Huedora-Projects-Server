import { nextSequence } from '../../utils/counters.js';

/**
 * Request One numbering: {TypeLetter}-{MM}-{SEQ}
 * Example: R-11-001
 *
 * Letters (1st letter of request type family):
 *   R – Repair & Service (REPAIR / MAINTENANCE)
 *   G – Goods Issuance (LOGISTICS)
 *   T – Training
 *   F – Finance One (REIMBURSEMENT)
 *   H – Hiring
 *   M – Master One (MASTER_ADD)
 *   O – Other
 *
 * Serial is 3 digits and resets per type letter + calendar month (year-scoped counter).
 */

export const REQUEST_NUMBER_DIGITS = 3;

export const REQUEST_TYPE_LETTERS = Object.freeze({
  REPAIR: 'R',
  MAINTENANCE: 'R',
  SERVICE: 'R',
  LOGISTICS: 'G',
  MOVEMENT: 'G',
  TRAINING: 'T',
  REIMBURSEMENT: 'F',
  HIRING: 'H',
  MASTER_ADD: 'M',
  OTHER: 'O',
});

export function requestTypeLetter(requestType) {
  const key = String(requestType || '')
    .trim()
    .toUpperCase();
  return REQUEST_TYPE_LETTERS[key] || 'O';
}

export function requestNumberPeriod(date = new Date()) {
  const d = date instanceof Date && !Number.isNaN(date.getTime()) ? date : new Date();
  const year = d.getFullYear();
  const month = d.getMonth() + 1;
  const mm = String(month).padStart(2, '0');
  return {
    year,
    mm,
    periodKey: `${year}${mm}`,
  };
}

export function formatRequestNumber(letter, mm, sequence) {
  const seq = Number(sequence);
  const padded = String(Number.isFinite(seq) && seq > 0 ? seq : 0).padStart(
    REQUEST_NUMBER_DIGITS,
    '0'
  );
  return `${String(letter || 'O').toUpperCase()}-${String(mm).padStart(2, '0')}-${padded}`;
}

export function parseRequestNumber(value) {
  const text = String(value || '')
    .trim()
    .toUpperCase();
  const match = /^([RGTFHMO])-(\d{2})-(\d{3,})$/.exec(text);
  if (!match) return null;
  return {
    letter: match[1],
    mm: match[2],
    sequence: Number(match[3]),
  };
}

/** Counter id: requestOne.{letter}.{YYYYMM} */
export function requestNumberCounterName(letter, periodKey) {
  return `requestOne.${String(letter).toUpperCase()}.${periodKey}`;
}

/**
 * Allocate the next Request One number for a request type.
 * Returns e.g. "R-11-001".
 */
export async function nextRequestNumber(requestType, date = new Date()) {
  const letter = requestTypeLetter(requestType);
  const { mm, periodKey } = requestNumberPeriod(date);
  const counterName = requestNumberCounterName(letter, periodKey);
  // Counter returns "R-001"; rebuild as "R-11-001".
  const allocated = await nextSequence(counterName, letter, {
    digits: REQUEST_NUMBER_DIGITS,
    separator: '-',
  });
  const seqPart = String(allocated).split('-').pop();
  return formatRequestNumber(letter, mm, Number(seqPart) || 1);
}

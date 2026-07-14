import { nextCounter } from '../modules/common/counter.model.js';

export async function nextSequence(name, prefix) {
  return nextCounter(name, prefix);
}

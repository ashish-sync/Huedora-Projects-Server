import { nextCounter } from '../modules/common/counter.model.js';

export async function nextSequence(name, prefix, opts) {
  return nextCounter(name, prefix, opts);
}

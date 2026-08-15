import { nextCounter, releaseCounterSequence } from '../modules/common/counter.model.js';

export async function nextSequence(name, prefix, opts) {
  return nextCounter(name, prefix, opts);
}

export async function releaseSequence(name, sequence) {
  return releaseCounterSequence(name, sequence);
}

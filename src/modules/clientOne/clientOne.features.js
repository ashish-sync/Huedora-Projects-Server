import { AppError } from '../../utils/helpers.js';

/** Default portal capabilities — all on for a professional Client One programme. */
export const CLIENT_ONE_FEATURE_KEYS = [
  'dashboard',
  'campTracker',
  'hcw',
  'calendar',
  'invoices',
  'annexures',
  'mis',
  'campRequestLink',
  'poUpload',
];

export const DEFAULT_CLIENT_ONE_FEATURES = Object.freeze({
  dashboard: true,
  campTracker: true,
  hcw: false,
  calendar: false,
  invoices: true,
  annexures: false,
  mis: true,
  campRequestLink: true,
  poUpload: true,
});

export function normalizeClientOneFeatures(raw) {
  const out = { ...DEFAULT_CLIENT_ONE_FEATURES };
  if (!raw || typeof raw !== 'object') return out;
  for (const key of CLIENT_ONE_FEATURE_KEYS) {
    if (Object.prototype.hasOwnProperty.call(raw, key)) {
      out[key] = raw[key] !== false;
    }
  }
  return out;
}

export function assertClientOneFeature(access, featureKey) {
  const features = normalizeClientOneFeatures(access?.features);
  if (!CLIENT_ONE_FEATURE_KEYS.includes(featureKey)) {
    throw new AppError('Unknown Client One feature', 400, 'VALIDATION_ERROR');
  }
  if (features[featureKey] === false) {
    throw new AppError('This feature is not enabled for your programme', 403, 'FEATURE_DISABLED');
  }
  return features;
}

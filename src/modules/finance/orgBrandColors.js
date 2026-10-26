/** Tylo Care defaults — used when an organisation has not set brand colours. */
export const DEFAULT_PRIMARY_COLOR = '#203E64';
export const DEFAULT_SECONDARY_COLOR = '#E7EDF4';

export function sanitizeBrandColor(value) {
  const raw = String(value || '').trim();
  const match = raw.match(/^#?([0-9a-fA-F]{6})$/);
  return match ? `#${match[1].toUpperCase()}` : null;
}

export function resolveOrgBrandColors(source = {}) {
  return {
    primary: sanitizeBrandColor(source.primaryColor) || DEFAULT_PRIMARY_COLOR,
    secondary: sanitizeBrandColor(source.secondaryColor) || DEFAULT_SECONDARY_COLOR,
  };
}

function hexToRgb(hex) {
  const n = parseInt(String(hex).slice(1), 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

function rgbToHex({ r, g, b }) {
  return `#${[r, g, b].map((channel) => channel.toString(16).padStart(2, '0')).join('').toUpperCase()}`;
}

export function mixHex(a, b, amount) {
  const from = hexToRgb(a);
  const to = hexToRgb(b);
  const t = Math.min(1, Math.max(0, Number(amount) || 0));
  return rgbToHex({
    r: Math.round(from.r + (to.r - from.r) * t),
    g: Math.round(from.g + (to.g - from.g) * t),
    b: Math.round(from.b + (to.b - from.b) * t),
  });
}

export function darkenHex(hex, amount = 0.16) {
  return mixHex(hex, '#000000', amount);
}

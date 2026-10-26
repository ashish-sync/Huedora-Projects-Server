import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { darkenHex, mixHex, resolveOrgBrandColors } from './orgBrandColors.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const LOGO_PATH = path.resolve(__dirname, '../../../assets/tylo-logo.png');

export const BRAND = {
  royal: '#203E64',
  royalDark: '#1B3454',
  royalLight: '#E7EDF4',
  royalMuted: '#5B7DB8',
  ink: '#1A1F36',
  muted: '#5C6478',
  line: '#D5DCE8',
  rowAlt: '#F4F7FC',
  white: '#FFFFFF',
  accent: '#E31E24',
  success: '#1B8F4E',
  headerGray: '#6B7280',
  metaBg: '#F9FAFB',
};

export function resolvePdfBrand(org = {}) {
  const { primary, secondary } = resolveOrgBrandColors(org);
  return {
    ...BRAND,
    royal: primary,
    royalDark: darkenHex(primary, 0.18),
    royalLight: secondary,
    royalMuted: mixHex(primary, '#FFFFFF', 0.42),
    rowAlt: mixHex(secondary, '#FFFFFF', 0.28),
    metaBg: mixHex(secondary, '#FFFFFF', 0.4),
  };
}

export function attachOrgBrand(pdf, org) {
  if (pdf) pdf._tyloBrand = resolvePdfBrand(org);
  return pdf?._tyloBrand || BRAND;
}

export function brandOf(pdf) {
  return pdf?._tyloBrand || BRAND;
}

export function resolveLogoPath() {
  return fs.existsSync(LOGO_PATH) ? LOGO_PATH : null;
}

export function moneyInr(n) {
  const num = Number(n);
  if (!Number.isFinite(num)) return '—';
  return `₹${num.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function moneyPlain(n) {
  const num = Number(n);
  if (!Number.isFinite(num)) return '—';
  return num.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function moneyRs(n) {
  const num = Number(n);
  if (!Number.isFinite(num)) return '—';
  return `Rs.${num.toLocaleString('en-IN', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
}

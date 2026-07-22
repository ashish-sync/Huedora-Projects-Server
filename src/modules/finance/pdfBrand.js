import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const LOGO_PATH = path.resolve(__dirname, '../../../assets/tylo-logo.png');

export const BRAND = {
  royal: '#0B3D91',
  royalDark: '#082F73',
  royalLight: '#E8EEF9',
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

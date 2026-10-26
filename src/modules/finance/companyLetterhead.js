/**
 * Letterhead lines for commercial PDF headers — Identity + Tax registration.
 * Keep in sync with client `shared/companyLetterhead.js`.
 *
 * Line 1: bold legal name + regular " • address"
 * Line 2: picked header fields (GSTIN, CIN, Udyam, Email, Website)
 */

function clean(value) {
  return value == null ? '' : String(value).trim();
}

function displayWebsite(value) {
  return clean(value)
    .replace(/^https?:\/\//i, '')
    .replace(/\/$/, '');
}

export const HEADER_DISPLAY_OPTIONS = [
  { key: 'gstin', label: 'GSTIN' },
  { key: 'cin', label: 'CIN' },
  { key: 'udyam', label: 'Udyam' },
  { key: 'email', label: 'Email' },
  { key: 'website', label: 'Website' },
];

export const DEFAULT_HEADER_DISPLAY_KEYS = HEADER_DISPLAY_OPTIONS.map((opt) => opt.key);

const ALLOWED_HEADER_KEYS = new Set(DEFAULT_HEADER_DISPLAY_KEYS);

/** Canonical ordered list, or null when the field was not sent. */
export function sanitizeHeaderDisplayKeys(raw) {
  if (!Array.isArray(raw)) return null;
  const seen = new Set();
  for (const item of raw) {
    const key = String(item || '').trim().toLowerCase();
    if (ALLOWED_HEADER_KEYS.has(key)) seen.add(key);
  }
  return DEFAULT_HEADER_DISPLAY_KEYS.filter((key) => seen.has(key));
}

/** Missing/invalid → all defaults. Explicit [] → none. */
export function resolveHeaderDisplayKeys(source = {}) {
  const sanitized = sanitizeHeaderDisplayKeys(source.headerDisplayKeys);
  return sanitized === null ? [...DEFAULT_HEADER_DISPLAY_KEYS] : sanitized;
}

/**
 * @param {object} org - FinanceOrgProfile or company-shaped object
 * @returns {{
 *   legalName: string,
 *   address: string,
 *   line1: string,
 *   line2: string,
 *   metaParts: string[],
 *   lines: string[],
 * }}
 */
export function formatCompanyLetterhead(org = {}) {
  const legalName = clean(org.legalName);
  const address = clean(org.registeredOffice || org.address);
  const line1 = [legalName, address].filter(Boolean).join(' • ');
  const selected = new Set(resolveHeaderDisplayKeys(org));
  const website = displayWebsite(org.website);
  const udyam = clean(org.udyam);
  const cin = clean(org.cin);

  const metaParts = [];
  if (selected.has('gstin') && org.gstin) metaParts.push(`GSTIN: ${clean(org.gstin)}`);
  if (selected.has('cin') && cin) metaParts.push(`CIN: ${cin}`);
  if (selected.has('udyam') && udyam) metaParts.push(`Udyam: ${udyam}`);
  if (selected.has('email') && org.email) metaParts.push(`Email: ${clean(org.email)}`);
  if (selected.has('website') && website) metaParts.push(`Website: ${website}`);

  const line2 = metaParts.join(' | ');

  return {
    legalName,
    address,
    line1,
    line2,
    metaParts,
    lines: [line1, line2].filter(Boolean),
  };
}

/**
 * Draw line 1 with bold legal name and regular-weight address after " • ".
 * Returns the y position after the line.
 */
export function drawCompanyLetterheadLine1(pdf, orgOrLetterhead, x, y, width, opts = {}) {
  const lh =
    orgOrLetterhead && (orgOrLetterhead.legalName != null || orgOrLetterhead.address != null)
      ? orgOrLetterhead
      : formatCompanyLetterhead(orgOrLetterhead || {});
  const {
    size = 7.5,
    align = 'left',
    ink = '#111827',
    muted = '#4B5563',
  } = opts;

  const legal = lh.legalName || '';
  const address = lh.address || '';
  if (!legal && !address) return y;

  if (align === 'center') {
    // Measure bold+regular widths to center the combined line
    pdf.font('Helvetica-Bold').fontSize(size);
    const legalW = legal ? pdf.widthOfString(legal) : 0;
    pdf.font('Helvetica').fontSize(size);
    const sep = legal && address ? ' • ' : '';
    const sepW = sep ? pdf.widthOfString(sep) : 0;
    const addrW = address ? pdf.widthOfString(address) : 0;
    const totalW = legalW + sepW + addrW;
    let cx = x + Math.max(0, (width - totalW) / 2);

    if (legal) {
      pdf.font('Helvetica-Bold').fontSize(size).fillColor(ink).text(legal, cx, y, {
        lineBreak: false,
      });
      cx += legalW;
    }
    if (sep) {
      pdf.font('Helvetica').fontSize(size).fillColor(muted).text(sep, cx, y, { lineBreak: false });
      cx += sepW;
    }
    if (address) {
      pdf.font('Helvetica').fontSize(size).fillColor(muted).text(address, cx, y, {
        width: Math.max(8, x + width - cx),
        lineBreak: false,
      });
    }
    return y + size + 2;
  }

  let cx = x;
  if (legal) {
    pdf.font('Helvetica-Bold').fontSize(size).fillColor(ink).text(legal, cx, y, {
      lineBreak: false,
    });
    cx += pdf.widthOfString(legal);
  }
  if (legal && address) {
    pdf.font('Helvetica').fontSize(size).fillColor(muted).text(' • ', cx, y, { lineBreak: false });
    cx += pdf.widthOfString(' • ');
  }
  if (address) {
    pdf.font('Helvetica').fontSize(size).fillColor(muted).text(address, cx, y, {
      width: Math.max(8, x + width - cx),
      lineBreak: false,
    });
  }
  return y + size + 2;
}

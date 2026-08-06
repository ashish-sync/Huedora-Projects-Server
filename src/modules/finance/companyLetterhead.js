/**
 * Letterhead lines for commercial PDF headers — Identity + Tax registration.
 * Keep in sync with client `shared/companyLetterhead.js`.
 *
 * Line 1: bold legal name + regular " • address"
 * Line 2: GSTIN | CIN | Udyam | Email | Website
 */

function clean(value) {
  return value == null ? '' : String(value).trim();
}

function displayWebsite(value) {
  return clean(value)
    .replace(/^https?:\/\//i, '')
    .replace(/\/$/, '');
}

/**
 * @param {object} org - FinanceOrgProfile or company-shaped object
 * @returns {{
 *   legalName: string,
 *   address: string,
 *   line1: string,
 *   line2: string,
 *   lines: string[],
 * }}
 */
export function formatCompanyLetterhead(org = {}) {
  const legalName = clean(org.legalName);
  const address = clean(org.registeredOffice || org.address);
  const line1 = [legalName, address].filter(Boolean).join(' • ');

  const udyam = clean(org.udyam);
  const udyamPart = udyam ? `Udyam: ${udyam}` : '';

  const website = displayWebsite(org.website);
  const metaParts = [
    org.gstin ? `GSTIN: ${clean(org.gstin)}` : '',
    org.cin ? `CIN: ${clean(org.cin)}` : '',
    udyamPart,
    org.email ? `Email: ${clean(org.email)}` : '',
    website ? `Website: ${website}` : '',
  ].filter(Boolean);

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

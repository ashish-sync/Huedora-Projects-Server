/**
 * Enterprise ERP commercial document PDF layout.
 * Reference: modular header, party blocks, line table, totals panel, dual signatures.
 */
import PDFDocument from 'pdfkit';
import { formatDisplayDateErp } from './financeCommercial.service.js';
import { BRAND, moneyInr, moneyPlain, moneyRs, resolveLogoPath } from './pdfBrand.js';

export { BRAND, moneyInr, moneyPlain, moneyRs };
export { formatDisplayDateErp };

export const PAGE = {
  width: 595.28,
  height: 841.89,
  margin: 36,
  footerReserve: 48,
};

export function contentWidth() {
  return PAGE.width - PAGE.margin * 2;
}

export function paymentTermsLabel(days) {
  const n = Number(days);
  if (!Number.isFinite(n) || n <= 0) return 'Due on Receipt';
  return `Credit — ${n} days after receipt`;
}

export function aggregateTaxByRate(items = [], taxMode = 'igst') {
  const map = new Map();
  for (const item of items) {
    if (item.sectionTitle || !String(item.description || '').trim()) continue;
    const taxable = Number(item.taxableAmount) || Number(item.amount) || 0;
    if (taxMode === 'igst') {
      const rate = Number(item.igstRate) || 0;
      const key = `igst-${rate}`;
      const entry = map.get(key) || { rate, taxable: 0, igst: 0, cgst: 0, sgst: 0, totalTax: 0 };
      entry.taxable += taxable;
      entry.igst += Number(item.igstAmount) || 0;
      entry.totalTax += Number(item.igstAmount) || 0;
      map.set(key, entry);
    } else {
      const rate = Number(item.cgstRate) || 0;
      const key = `cgst-${rate}`;
      const entry = map.get(key) || { rate, taxable: 0, igst: 0, cgst: 0, sgst: 0, totalTax: 0 };
      entry.taxable += taxable;
      entry.cgst += Number(item.cgstAmount) || 0;
      entry.sgst += Number(item.sgstAmount) || 0;
      entry.totalTax += (Number(item.cgstAmount) || 0) + (Number(item.sgstAmount) || 0);
      map.set(key, entry);
    }
  }
  return [...map.values()].map((row) => ({
    ...row,
    taxable: Math.round(row.taxable * 100) / 100,
    igst: Math.round(row.igst * 100) / 100,
    cgst: Math.round(row.cgst * 100) / 100,
    sgst: Math.round(row.sgst * 100) / 100,
    totalTax: Math.round(row.totalTax * 100) / 100,
  }));
}

export function createCommercialPdf({ title, author, creator = 'TYLO One Finance' }) {
  const margin = PAGE.margin;
  const pdf = new PDFDocument({
    size: 'A4',
    margins: { top: margin, bottom: margin, left: margin, right: margin },
    info: { Title: title, Author: author || 'TYLO', Creator: creator },
    bufferPages: true,
  });

  const chunks = [];
  pdf.on('data', (c) => chunks.push(c));

  const finish = () =>
    new Promise((resolve, reject) => {
      pdf.on('end', () => resolve(Buffer.concat(chunks)));
      pdf.on('error', reject);
      pdf.end();
    });

  return { pdf, finish, margin, contentW: contentWidth() };
}

export function ensureSpace(pdf, y, needed, margin) {
  const maxY = PAGE.height - PAGE.margin - PAGE.footerReserve;
  if (y + needed > maxY) {
    pdf.addPage();
    return margin;
  }
  return y;
}

function hrule(pdf, x, y, w) {
  pdf.strokeColor(BRAND.line).lineWidth(0.5).moveTo(x, y).lineTo(x + w, y).stroke();
}

/** Logo left | title centre | metadata box + status badge right */
export function drawErpHeader(pdf, org, y, margin, contentW, { title, metaRows, statusLabel = 'ISSUED' }) {
  const logoPath = resolveLogoPath();
  const logoW = 92;
  const metaW = 148;
  const titleX = margin + logoW + 6;
  const titleW = contentW - logoW - metaW - 14;
  const metaX = margin + contentW - metaW;
  const blockH = 78;

  if (logoPath) {
    pdf.image(logoPath, margin, y + 4, { width: logoW });
  }

  pdf
    .font('Helvetica-Bold')
    .fontSize(17)
    .fillColor(BRAND.royal)
    .text(title, titleX, y + 26, { width: titleW, align: 'center', characterSpacing: 0.8 });

  pdf.save();
  pdf.rect(metaX, y, metaW, blockH - 6).fill(BRAND.metaBg);
  pdf.rect(metaX, y, metaW, blockH - 6).lineWidth(0.5).strokeColor(BRAND.line).stroke();
  pdf.restore();

  let my = y + 7;
  for (const [label, value] of metaRows) {
    pdf
      .font('Helvetica')
      .fontSize(6)
      .fillColor(BRAND.muted)
      .text(String(label).toUpperCase(), metaX + 7, my, { width: metaW - 14 });
    my += 9;
    pdf
      .font('Helvetica-Bold')
      .fontSize(7.5)
      .fillColor(BRAND.ink)
      .text(String(value ?? '—'), metaX + 7, my, { width: metaW - 14 });
    my += 11;
  }

  const badgeH = 16;
  const badgeY = y + blockH - badgeH - 8;
  pdf.roundedRect(metaX + 6, badgeY, metaW - 12, badgeH, 3).fill(BRAND.success);
  pdf
    .font('Helvetica-Bold')
    .fontSize(6.5)
    .fillColor(BRAND.white)
    .text(String(statusLabel).toUpperCase(), metaX + 6, badgeY + 4, {
      width: metaW - 12,
      align: 'center',
      characterSpacing: 0.6,
    });

  const endY = y + blockH + 4;
  hrule(pdf, margin, endY, contentW);
  return endY + 10;
}

/** Party block with coloured pill header (Supplier, Bill To, Ship To, etc.) */
export function drawErpPartyBlock(pdf, x, y, w, title, headerColor, fields) {
  const headerH = 20;
  const pad = 7;
  const lines = [];
  if (fields.name) lines.push({ bold: true, text: fields.name });
  if (fields.address) lines.push({ text: fields.address });
  if (fields.gstin) lines.push({ text: `GSTIN: ${fields.gstin}` });
  if (fields.pan) lines.push({ text: `PAN NO.: ${fields.pan}` });
  if (fields.stateCode) lines.push({ text: `State Code: ${fields.stateCode}` });
  if (fields.contact) lines.push({ text: fields.contact });
  if (fields.email) lines.push({ text: fields.email });

  pdf.font('Helvetica').fontSize(7);
  let bodyH = pad;
  for (const line of lines) {
    bodyH += pdf.heightOfString(line.text, { width: w - pad * 2, lineGap: 1 }) + 3;
  }
  bodyH += pad;
  const totalH = headerH + bodyH;

  pdf.roundedRect(x, y, w, headerH, 4).fill(headerColor);
  pdf
    .font('Helvetica-Bold')
    .fontSize(7)
    .fillColor(BRAND.white)
    .text(title.toUpperCase(), x + 8, y + 6, { width: w - 16 });

  pdf.save();
  pdf.rect(x, y + headerH - 2, w, bodyH + 2).lineWidth(0.5).strokeColor(BRAND.line).stroke();
  pdf.restore();

  let cy = y + headerH + pad;
  for (const line of lines) {
    pdf
      .font(line.bold ? 'Helvetica-Bold' : 'Helvetica')
      .fontSize(7)
      .fillColor(line.bold ? BRAND.ink : BRAND.muted)
      .text(line.text, x + pad, cy, { width: w - pad * 2, lineGap: 1 });
    cy = pdf.y + 3;
  }

  return y + totalH;
}

/** Right column: payment terms, delivery date, etc. */
export function drawErpTermsStack(pdf, x, y, w, items) {
  let cy = y;
  for (const item of items) {
    pdf
      .font('Helvetica-Bold')
      .fontSize(7)
      .fillColor(BRAND.royal)
      .text(item.label, x, cy, { width: w });
    cy = pdf.y + 3;
    pdf
      .font('Helvetica')
      .fontSize(7.5)
      .fillColor(BRAND.ink)
      .text(item.value || '—', x, cy, { width: w, lineGap: 1 });
    cy = pdf.y + 12;
  }
  return cy;
}

/** Three-column party row */
export function drawErpPartyRow(pdf, y, margin, contentW, cols) {
  const gap = 8;
  const termsW = cols.terms ? 118 : 0;
  const partyW = (contentW - termsW - gap * (cols.terms ? 2 : 1)) / (cols.third ? 3 : 2);
  let x = margin;
  let maxEnd = y;

  if (cols.first) {
    const end = drawErpPartyBlock(
      pdf,
      x,
      y,
      partyW,
      cols.first.title,
      cols.first.color || BRAND.royal,
      cols.first.fields
    );
    maxEnd = Math.max(maxEnd, end);
    x += partyW + gap;
  }

  if (cols.second) {
    const end = drawErpPartyBlock(
      pdf,
      x,
      y,
      partyW,
      cols.second.title,
      cols.second.color || BRAND.headerGray,
      cols.second.fields
    );
    maxEnd = Math.max(maxEnd, end);
    x += partyW + gap;
  }

  if (cols.third) {
    const end = drawErpPartyBlock(
      pdf,
      x,
      y,
      partyW,
      cols.third.title,
      cols.third.color || BRAND.headerGray,
      cols.third.fields
    );
    maxEnd = Math.max(maxEnd, end);
    x += partyW + gap;
  }

  if (cols.terms) {
    const end = drawErpTermsStack(pdf, x, y + 4, termsW, cols.terms);
    maxEnd = Math.max(maxEnd, end);
  }

  hrule(pdf, margin, maxEnd + 6, contentW);
  return maxEnd + 14;
}

/** Generic ERP table */
export function drawErpTable(pdf, margin, y, contentW, columns, rows) {
  const tableW = columns.reduce((s, c) => s + c.w, 0);
  const headerH = 22;

  pdf.save();
  pdf.rect(margin, y, tableW, headerH).fill(BRAND.royal);
  pdf.restore();

  let cx = margin;
  pdf.font('Helvetica-Bold').fontSize(6.5).fillColor(BRAND.white);
  for (const col of columns) {
    pdf.text(col.label, cx + 4, y + 7, { width: col.w - 8, align: col.align || 'left' });
    cx += col.w;
  }
  y += headerH;

  rows.forEach((row, index) => {
    if (row._section) {
      const sectionH = 18;
      pdf.save();
      pdf.rect(margin, y, tableW, sectionH).fill(BRAND.royalLight);
      pdf.restore();
      pdf
        .font('Helvetica-Bold')
        .fontSize(7)
        .fillColor(BRAND.royalDark)
        .text(row._section, margin + 6, y + 5, { width: tableW - 12 });
      y += sectionH;
      return;
    }

    pdf.font('Helvetica').fontSize(7);
    let rowH = 22;
    const descCol = columns.find((c) => c.key === 'desc');
    if (descCol && row.desc) {
      const descH = pdf.heightOfString(String(row.desc), { width: descCol.w - 8, lineGap: 1 });
      rowH = Math.max(22, descH + 10);
    }

    if (index % 2 === 1) {
      pdf.save();
      pdf.rect(margin, y, tableW, rowH).fill(BRAND.rowAlt);
      pdf.restore();
    }

    cx = margin;
    pdf.fillColor(BRAND.ink);
    for (const col of columns) {
      const val = row[col.key] ?? '';
      pdf.text(String(val), cx + 4, y + 6, {
        width: col.w - 8,
        align: col.align || 'left',
        lineGap: 1,
      });
      cx += col.w;
    }

    pdf
      .strokeColor(BRAND.line)
      .lineWidth(0.5)
      .moveTo(margin, y + rowH)
      .lineTo(margin + tableW, y + rowH)
      .stroke();
    y += rowH;
  });

  return y + 6;
}

export function buildPoTableRows(items) {
  let sr = 0;
  const rows = [];
  for (const item of items || []) {
    if (item.sectionTitle) {
      rows.push({ _section: item.sectionTitle });
      continue;
    }
    if (!String(item.description || '').trim()) continue;
    sr += 1;
    rows.push({
      sr: String(sr),
      desc: item.isFoc ? `${item.description} (FOC)` : item.description,
      uom: item.uom || '—',
      qty: item.qty ? String(item.qty) : '—',
      rate: item.isFoc ? '0.00' : moneyPlain(item.rate),
      value: moneyPlain(item.amount),
    });
  }
  return rows;
}

export function poTableColumns(contentW) {
  return [
    { key: 'sr', label: 'SR. NO.', w: 28, align: 'center' },
    { key: 'desc', label: 'DESCRIPTION', w: contentW - 28 - 34 - 38 - 54 - 62 },
    { key: 'uom', label: 'UOM', w: 34, align: 'center' },
    { key: 'qty', label: 'QTY', w: 38, align: 'right' },
    { key: 'rate', label: 'RATE (INR)', w: 54, align: 'right' },
    { key: 'value', label: 'VALUE (INR)', w: 62, align: 'right' },
  ];
}

export function buildGstTableRows(items, taxMode) {
  let sr = 0;
  const rows = [];
  for (const item of items || []) {
    if (item.sectionTitle) {
      rows.push({ _section: item.sectionTitle });
      continue;
    }
    if (!String(item.description || '').trim()) continue;
    sr += 1;
    const sac = item.sacCode ? `\nSAC: ${item.sacCode}` : '';
    const taxVal =
      taxMode === 'igst'
        ? item.igstAmount
          ? `${item.igstRate || 0}%\n${moneyPlain(item.igstAmount)}`
          : '—'
        : item.cgstAmount || item.sgstAmount
          ? `${moneyPlain((Number(item.cgstAmount) || 0) + (Number(item.sgstAmount) || 0))}`
          : '—';
    rows.push({
      sr: String(sr),
      desc: `${item.description || '—'}${sac}`,
      qty: item.qty ? String(item.qty) : '—',
      rate: moneyPlain(item.rate),
      taxable: moneyPlain(item.taxableAmount || item.amount),
      tax: taxVal,
      value: moneyPlain(item.totalAmount || item.taxableAmount || item.amount),
    });
  }
  return rows;
}

export function gstTableColumns(contentW, taxMode) {
  const taxLabel = taxMode === 'igst' ? 'IGST' : 'CGST+SGST';
  return [
    { key: 'sr', label: 'SR. NO.', w: 26, align: 'center' },
    { key: 'desc', label: 'DESCRIPTION / SAC', w: contentW - 26 - 32 - 46 - 46 - 40 - 54 },
    { key: 'qty', label: 'QTY', w: 32, align: 'right' },
    { key: 'rate', label: 'RATE', w: 46, align: 'right' },
    { key: 'taxable', label: 'TAXABLE', w: 46, align: 'right' },
    { key: 'tax', label: taxLabel, w: 40, align: 'right' },
    { key: 'value', label: 'VALUE (INR)', w: 54, align: 'right' },
  ];
}

/** Footer: amount in words + remarks left; totals panel right */
export function drawErpFooterSummary(pdf, margin, y, contentW, { amountWords, remarks, totals, totalLabel = 'TOTAL (INR)' }) {
  const panelW = 168;
  const leftW = contentW - panelW - 14;
  const panelX = margin + contentW - panelW;
  const startY = y;

  pdf.font('Helvetica-Bold').fontSize(7.5).fillColor(BRAND.royal).text('Amount in Words', margin, y);
  y = pdf.y + 4;
  pdf
    .font('Helvetica')
    .fontSize(7.5)
    .fillColor(BRAND.ink)
    .text(amountWords ? `Rupees ${amountWords}` : '—', margin, y, { width: leftW, lineGap: 1 });
  y = pdf.y + 10;

  pdf.font('Helvetica-Bold').fontSize(7.5).fillColor(BRAND.royal).text('Remarks', margin, y);
  y = pdf.y + 4;
  pdf
    .font('Helvetica')
    .fontSize(7.5)
    .fillColor(BRAND.muted)
    .text(remarks || '—', margin, y, { width: leftW, lineGap: 1 });
  const leftEnd = pdf.y + 6;

  let py = startY;
  pdf.save();
  pdf.rect(panelX, py, panelW, 8 + totals.length * 16 + 28).fill(BRAND.metaBg);
  pdf.rect(panelX, py, panelW, 8 + totals.length * 16 + 28).lineWidth(0.5).strokeColor(BRAND.line).stroke();
  pdf.restore();
  py += 8;

  for (const [label, value] of totals) {
    pdf.font('Helvetica-Bold').fontSize(7).fillColor(BRAND.muted).text(label, panelX + 8, py + 2, {
      width: panelW * 0.48,
    });
    pdf
      .font('Helvetica-Bold')
      .fontSize(7.5)
      .fillColor(BRAND.ink)
      .text(String(value), panelX + panelW * 0.45, py + 2, {
        width: panelW * 0.52 - 8,
        align: 'right',
      });
    py += 16;
  }

  py += 2;
  pdf
    .strokeColor(BRAND.line)
    .lineWidth(0.5)
    .moveTo(panelX + 6, py)
    .lineTo(panelX + panelW - 6, py)
    .stroke();
  py += 6;

  pdf.font('Helvetica-Bold').fontSize(7.5).fillColor(BRAND.muted).text(totalLabel, panelX + 8, py, {
    width: panelW * 0.45,
  });
  pdf
    .font('Helvetica-Bold')
    .fontSize(10)
    .fillColor(BRAND.success)
    .text(moneyInr(totals._grandTotal), panelX + panelW * 0.42, py - 1, {
      width: panelW * 0.55 - 8,
      align: 'right',
    });

  return Math.max(leftEnd, py + 24) + 8;
}

export function drawTaxSummaryTable(pdf, margin, y, contentW, items, taxMode) {
  const rows = aggregateTaxByRate(items, taxMode);
  if (!rows.length) return y;

  pdf.font('Helvetica-Bold').fontSize(7.5).fillColor(BRAND.royal).text('Tax Summary', margin, y);
  y += 14;

  const cols =
    taxMode === 'igst'
      ? [
          { label: 'RATE', w: 44, align: 'center' },
          { label: 'TAXABLE VALUE', w: 90, align: 'right' },
          { label: 'IGST', w: 80, align: 'right' },
          { label: 'TOTAL TAX', w: 80, align: 'right' },
        ]
      : [
          { label: 'RATE', w: 40, align: 'center' },
          { label: 'TAXABLE', w: 78, align: 'right' },
          { label: 'CGST', w: 68, align: 'right' },
          { label: 'SGST', w: 68, align: 'right' },
          { label: 'TOTAL', w: 72, align: 'right' },
        ];

  const tableW = cols.reduce((s, c) => s + c.w, 0);
  const headerH = 16;
  const rowH = 15;

  pdf.save();
  pdf.rect(margin, y, tableW, headerH).fill(BRAND.royalMuted);
  pdf.restore();

  let cx = margin;
  pdf.font('Helvetica-Bold').fontSize(6.5).fillColor(BRAND.white);
  for (const col of cols) {
    pdf.text(col.label, cx + 4, y + 4, { width: col.w - 8, align: col.align });
    cx += col.w;
  }
  y += headerH;

  rows.forEach((row, idx) => {
    if (idx % 2 === 1) {
      pdf.save();
      pdf.rect(margin, y, tableW, rowH).fill(BRAND.rowAlt);
      pdf.restore();
    }
    cx = margin;
    pdf.font('Helvetica').fontSize(6.5).fillColor(BRAND.ink);
    const vals =
      taxMode === 'igst'
        ? [`${row.rate}%`, moneyPlain(row.taxable), moneyPlain(row.igst), moneyPlain(row.totalTax)]
        : [
            `${row.rate}%`,
            moneyPlain(row.taxable),
            moneyPlain(row.cgst),
            moneyPlain(row.sgst),
            moneyPlain(row.totalTax),
          ];
    vals.forEach((val, i) => {
      pdf.text(val, cx + 4, y + 3, { width: cols[i].w - 8, align: cols[i].align });
      cx += cols[i].w;
    });
    y += rowH;
  });

  return y + 10;
}

export function drawBankingPanel(pdf, x, y, w, org) {
  if (!org.bankName && !org.accountNumber) return y;

  pdf.font('Helvetica-Bold').fontSize(7.5).fillColor(BRAND.royal).text('Banking Details', x, y);
  y = pdf.y + 4;
  const lines = [
    org.bankName ? `Bank: ${org.bankName}` : '',
    org.accountNumber ? `A/c No.: ${org.accountNumber}` : '',
    org.ifscCode ? `IFSC: ${org.ifscCode}` : '',
    org.bankBranch ? `Branch: ${org.bankBranch}` : '',
    `Beneficiary: ${org.legalName || org.brandLine || '—'}`,
  ].filter(Boolean);

  pdf.font('Helvetica').fontSize(7).fillColor(BRAND.muted);
  for (const line of lines) {
    pdf.text(line, x, y, { width: w });
    y = pdf.y + 2;
  }
  return y + 6;
}

export function drawTermsSection(pdf, margin, y, contentW, terms) {
  if (!terms?.length) return y;
  y = ensureSpace(pdf, y, 50, PAGE.margin);
  pdf.font('Helvetica-Bold').fontSize(7.5).fillColor(BRAND.royal).text('Terms & Conditions', margin, y);
  y = pdf.y + 4;
  terms.forEach((term, index) => {
    y = ensureSpace(pdf, y, 18, PAGE.margin);
    pdf
      .font('Helvetica')
      .fontSize(6.5)
      .fillColor(BRAND.muted)
      .text(`${index + 1}. ${term}`, margin, y, { width: contentW, lineGap: 1 });
    y = pdf.y + 2;
  });
  return y + 6;
}

/** Prepared By | Authorised By */
export function drawErpSignatures(pdf, margin, y, contentW, orgName) {
  y = ensureSpace(pdf, y, 70, PAGE.margin);
  const colW = (contentW - 20) / 2;

  const blocks = [
    { label: 'PREPARED BY', name: '' },
    { label: 'AUTHORISED BY', name: `For ${orgName}` },
  ];

  blocks.forEach((block, i) => {
    const x = margin + i * (colW + 20);
    pdf
      .strokeColor(BRAND.line)
      .lineWidth(0.5)
      .moveTo(x, y + 36)
      .lineTo(x + colW, y + 36)
      .stroke();
    pdf
      .font('Helvetica-Bold')
      .fontSize(7)
      .fillColor(BRAND.muted)
      .text(block.label, x, y + 40, { width: colW, align: 'center' });
    if (block.name) {
      pdf
        .font('Helvetica')
        .fontSize(7)
        .fillColor(BRAND.ink)
        .text(block.name, x, y + 52, { width: colW, align: 'center' });
    }
  });

  return y + 68;
}

export function drawErpDisclaimer(pdf, margin, y, contentW, text) {
  pdf
    .font('Helvetica-Oblique')
    .fontSize(6.5)
    .fillColor(BRAND.muted)
    .text(
      text ||
        'This is a computer-generated document. It is valid without a physical signature when issued electronically.',
      margin,
      y,
      { width: contentW, align: 'center' }
    );
  return pdf.y + 8;
}

export function stampStatutoryFooters(pdf, org) {
  const range = pdf.bufferedPageRange();
  const margin = PAGE.margin;
  const contentW = contentWidth();
  const footerY = PAGE.height - PAGE.margin - 8;

  for (let i = range.start; i < range.start + range.count; i += 1) {
    pdf.switchToPage(i);
    const pageNum = i - range.start + 1;
    const totalPages = range.count;

    hrule(pdf, margin, footerY - 10, contentW);

    const footerLeft = [
      org.cin ? `CIN: ${org.cin}` : '',
      org.pan ? `PAN: ${org.pan}` : '',
      org.gstin ? `GSTIN: ${org.gstin}` : '',
    ]
      .filter(Boolean)
      .join('   |   ');

    pdf.font('Helvetica').fontSize(6).fillColor(BRAND.muted);
    pdf.text(footerLeft, margin, footerY - 4, { width: contentW * 0.7, align: 'left' });
    pdf.text(`Page ${pageNum} of ${totalPages}`, margin + contentW * 0.7, footerY - 4, {
      width: contentW * 0.3,
      align: 'right',
    });
  }
}

/**
 * Shared portrait A4 commercial document PDF (Tylo Care grid template).
 * Used by Bill of Supply, Credit Note, and similar letterheads.
 */
import PDFDocument from 'pdfkit';
import {
  amountInWordsIndian,
  formatDisplayDateErp,
  toAmount,
} from './financeCommercial.service.js';
import { BRAND, moneyPlain, resolveLogoPath } from './pdfBrand.js';

const PAGE = {
  width: 595.28,
  height: 841.89,
  margin: 28,
};

const GRAY = '#F3F4F6';
const INK = '#111827';
const MUTED = '#4B5563';
const LINE = '#111827';

export const PORTRAIT_DOC_PRESETS = {
  bill_of_supply: {
    title: 'BILL OF SUPPLY',
    totalLabel: 'TOTAL BILL VALUE',
    gstMode: 'nil',
    paymentTermsTitle: 'PAYMENT TERMS & IMPORTANT INFORMATION',
    bankNote:
      'Please mention the Bill of Supply number while making payment. Any discrepancy should be communicated within 7 days of receipt.',
    defaultTerms:
      'Payment is due within 30 days from the date of the Bill of Supply unless otherwise agreed.',
    showGstExemptNote: true,
    metaRows: (doc) => [
      [
        ['Bill of Supply No.', doc.documentNumber || ''],
        ['Bill of Supply Date', formatDisplayDateErp(doc.documentDate) || 'DD/MM/YYYY'],
        ['Due Date', formatDisplayDateErp(doc.dueDate) || 'DD/MM/YYYY'],
      ],
      [
        ['PO / WO No.', doc.reference || ''],
        ['PO / WO Date', formatDisplayDateErp(doc.referenceDate) || 'DD/MM/YYYY'],
        ['Project / Service Period', doc.servicePeriod || doc.projectName || ''],
      ],
    ],
  },
  credit_note: {
    title: 'CREDIT NOTE',
    totalLabel: 'TOTAL CREDIT NOTE VALUE',
    gstMode: 'taxable',
    paymentTermsTitle: 'PAYMENT TERMS',
    bankNote:
      'Please mention the invoice number while making payment. Any discrepancy should be communicated within 7 days of receipt.',
    defaultTerms: 'Payment is due within 30 days from the date of invoice.',
    showGstExemptNote: false,
    metaRows: (doc) => [
      [
        ['Credit Note No.', doc.documentNumber || ''],
        ['Credit Note Date', formatDisplayDateErp(doc.documentDate) || 'DD/MM/YYYY'],
        ['Due Date', formatDisplayDateErp(doc.dueDate) || 'DD/MM/YYYY'],
      ],
      [
        ['PO / WO No.', doc.reference || ''],
        ['PO / WO Date', formatDisplayDateErp(doc.referenceDate) || 'DD/MM/YYYY'],
        ['Project / Service Period', doc.servicePeriod || doc.projectName || ''],
      ],
      [
        ['Original Invoice No.', doc.cnReference || ''],
        ['Original Invoice Date', formatDisplayDateErp(doc.originalInvoiceDate) || 'DD/MM/YYYY'],
        ['Reason for Credit Note', doc.creditReason || 'Rate Revision / Cancellation / Service Adjustment'],
      ],
    ],
  },
  debit_note: {
    title: 'DEBIT NOTE',
    totalLabel: 'TOTAL DEBIT NOTE VALUE',
    gstMode: 'taxable',
    paymentTermsTitle: 'PAYMENT TERMS',
    bankNote:
      'Please mention the invoice number while making payment. Any discrepancy should be communicated within 7 days of receipt.',
    defaultTerms: 'Payment is due within 30 days from the date of invoice.',
    showGstExemptNote: false,
    metaRows: (doc) => [
      [
        ['Debit Note No.', doc.documentNumber || ''],
        ['Debit Note Date', formatDisplayDateErp(doc.documentDate) || 'DD/MM/YYYY'],
        ['Due Date', formatDisplayDateErp(doc.dueDate) || 'DD/MM/YYYY'],
      ],
      [
        ['PO / WO No.', doc.reference || ''],
        ['PO / WO Date', formatDisplayDateErp(doc.referenceDate) || 'DD/MM/YYYY'],
        ['Project / Service Period', doc.servicePeriod || doc.projectName || ''],
      ],
      [
        ['Original Invoice No.', doc.dnReference || ''],
        ['Original Invoice Date', formatDisplayDateErp(doc.originalInvoiceDate) || 'DD/MM/YYYY'],
        ['', ''],
      ],
      {
        fullWidth: true,
        label: 'Reason for Debit Note',
        value: doc.debitReason || 'Additional Service / Underbilling / Rate Revision / Tax Adjustment',
      },
    ],
  },
  proforma: {
    title: 'PROFORMA INVOICE',
    totalLabel: 'TOTAL ESTIMATED VALUE',
    gstMode: 'taxable',
    paymentTermsTitle: 'PAYMENT TERMS & DECLARATION',
    bankNote:
      'Please mention the invoice number while making payment. Any discrepancy should be communicated within 7 days of receipt.',
    defaultTerms:
      'Payment is due within 30 days from the date of the final Tax Invoice unless otherwise agreed.',
    showGstExemptNote: false,
    declarationNote:
      'This is a Proforma Invoice issued for quotation, approval or advance payment purposes only. It is not a Tax Invoice under the GST Act and does not create any GST liability. A final Tax Invoice will be issued upon confirmation and/or execution of services, as applicable.',
    metaRows: (doc) => [
      [
        ['Proforma Invoice No.', doc.documentNumber || ''],
        ['Proforma Date', formatDisplayDateErp(doc.documentDate) || 'DD/MM/YYYY'],
        ['Valid Until', formatDisplayDateErp(doc.dueDate) || 'DD/MM/YYYY'],
      ],
      [
        ['PO / WO No.', doc.reference || ''],
        ['PO / WO Date', formatDisplayDateErp(doc.referenceDate) || 'DD/MM/YYYY'],
        ['Project / Service Period', doc.servicePeriod || doc.projectName || ''],
      ],
    ],
  },
  quotation: {
    title: 'QUOTATION',
    totalLabel: 'TOTAL QUOTATION VALUE',
    gstMode: 'taxable',
    paymentTermsTitle: 'PAYMENT TERMS & MSME DECLARATION',
    bankNote:
      'Please mention the invoice number while making payment. Any discrepancy should be communicated within 7 days of receipt.',
    defaultTerms:
      'Payment terms: 30 days from the date of the Tax Invoice unless otherwise agreed in writing.',
    showGstExemptNote: false,
    declarationNote:
      'This quotation is issued for budgetary/commercial evaluation only. It is neither a Proforma Invoice nor a Tax Invoice. Prices are based on the proposed scope, subject to applicable GST, commercial discussions and issuance of a Purchase Order/Work Order. A Proforma Invoice or Tax Invoice will be issued, as applicable.',
    metaRows: (doc) => [
      [
        ['Quotation No.', doc.documentNumber || ''],
        ['Quotation Date', formatDisplayDateErp(doc.documentDate) || 'DD/MM/YYYY'],
        ['Quotation Valid Until', formatDisplayDateErp(doc.dueDate) || 'DD/MM/YYYY'],
      ],
      [
        ['PO / WO No.', doc.reference || ''],
        ['PO / WO Date', formatDisplayDateErp(doc.referenceDate) || 'DD/MM/YYYY'],
        ['Project / Service Period', doc.servicePeriod || doc.projectName || ''],
      ],
    ],
  },
  client_invoice: {
    title: 'TAX INVOICE',
    totalLabel: 'TOTAL INVOICE VALUE',
    gstMode: 'taxable',
    paymentTermsTitle: 'PAYMENT TERMS & MSME DECLARATION',
    bankNote:
      'Please mention the invoice number while making payment. Any discrepancy should be communicated within 7 days of receipt.',
    defaultTerms: 'Payment is due within 30 days from the date of invoice.',
    showGstExemptNote: false,
    declarationNote: (org) => {
      const legal = org.legalName || 'Tylo Care Private Limited';
      const udyam = org.udyam || 'UDYAM-MH-19-0446179';
      return `${legal} is registered as a Micro Enterprise under the MSMED Act, 2006, bearing Udyam Registration No. ${udyam}. Delayed payments shall be governed by applicable provisions of the MSMED Act, 2006.`;
    },
    metaRows: (doc) => [
      [
        ['Invoice No.', doc.documentNumber || ''],
        ['Invoice Date', formatDisplayDateErp(doc.documentDate) || 'DD/MM/YYYY'],
        ['Due Date', formatDisplayDateErp(doc.dueDate) || 'DD/MM/YYYY'],
      ],
      [
        ['PO / WO No.', doc.reference || ''],
        ['PO / WO Date', formatDisplayDateErp(doc.referenceDate) || 'DD/MM/YYYY'],
        ['Project / Service Period', doc.servicePeriod || doc.projectName || ''],
      ],
    ],
  },
};

function contentW() {
  return PAGE.width - PAGE.margin * 2;
}

function box(pdf, x, y, w, h, fill = null) {
  if (fill) pdf.save().rect(x, y, w, h).fill(fill).restore();
  pdf.rect(x, y, w, h).strokeColor(LINE).lineWidth(0.7).stroke();
}

function cellText(pdf, text, x, y, w, h, opts = {}) {
  const {
    align = 'left',
    bold = false,
    size = 8,
    color = INK,
    padX = 4,
    padY = 3,
  } = opts;
  pdf
    .fillColor(color)
    .font(bold ? 'Helvetica-Bold' : 'Helvetica')
    .fontSize(size)
    .text(String(text || ''), x + padX, y + padY, {
      width: w - padX * 2,
      height: h - padY * 2,
      align,
      ellipsis: true,
    });
}

function lineGstRateDisplay(line, gstMode) {
  if (gstMode === 'nil') return 'NIL';
  if (toAmount(line.igstRate) > 0) return `${toAmount(line.igstRate)}%`;
  const half = toAmount(line.cgstRate) + toAmount(line.sgstRate);
  if (half > 0) return `${half}%`;
  return '0%';
}

function sumTax(lines, key) {
  return lines.reduce((s, row) => s + toAmount(row[key]), 0);
}

function drawHeader(pdf, org, cfg, x, y, w) {
  const logoPath = resolveLogoPath();
  const logoW = 72;
  const logoH = 36;
  const titleW = 130;
  const midX = x + logoW + 8;
  const midW = w - logoW - titleW - 16;

  if (logoPath) {
    try {
      pdf.image(logoPath, x, y, { fit: [logoW, logoH], align: 'left', valign: 'center' });
    } catch {
      pdf.font('Helvetica-Bold').fontSize(16).fillColor(INK).text('TYLO', x, y + 4);
      pdf.font('Helvetica').fontSize(7).fillColor(MUTED).text(org.brandLine || '', x, y + 22, { width: logoW });
    }
  } else {
    pdf.font('Helvetica-Bold').fontSize(16).fillColor(INK).text('TYLO', x, y + 4);
    pdf.font('Helvetica').fontSize(7).fillColor(MUTED).text(org.brandLine || 'Bringing Healthcare Closer', x, y + 22, {
      width: logoW,
    });
  }

  const lines = [
    `Registered Office: ${org.registeredOffice || ''}`,
    [org.gstin ? `GSTIN: ${org.gstin}` : '', org.cin ? `CIN: ${org.cin}` : ''].filter(Boolean).join('  |  '),
    [
      org.udyam ? `Udyam: ${org.udyam}${org.udyamLabel ? ` (${org.udyamLabel})` : ''}` : '',
      org.email ? `Email: ${org.email}` : '',
      org.website ? `Website: ${org.website}` : '',
    ]
      .filter(Boolean)
      .join('  |  '),
  ].filter(Boolean);

  pdf.font('Helvetica').fontSize(7.5).fillColor(INK);
  let ty = y + 2;
  for (const line of lines) {
    pdf.text(line, midX, ty, { width: midW, align: 'center', lineGap: 1 });
    ty = pdf.y + 1;
  }

  pdf
    .font('Helvetica-Bold')
    .fontSize(14)
    .fillColor(INK)
    .text(cfg.title, x + w - titleW, y + 10, { width: titleW, align: 'right' });

  return Math.max(y + logoH, ty) + 10;
}

function drawMetaGrid(pdf, doc, cfg, x, y, w) {
  const rowH = 20;
  const colW = [w * 0.36, w * 0.32, w * 0.32];
  const rows = cfg.metaRows(doc);
  let cy = y;
  for (const row of rows) {
    if (row && row.fullWidth) {
      box(pdf, x, cy, w, rowH);
      cellText(pdf, row.label, x, cy, w, 9, { size: 6.2, color: MUTED, bold: true });
      cellText(pdf, row.value, x, cy + 8, w, 11, { size: 8, bold: true });
      cy += rowH;
      continue;
    }
    let cx = x;
    for (let i = 0; i < 3; i += 1) {
      const [label, value] = row[i] || ['', ''];
      box(pdf, cx, cy, colW[i], rowH);
      if (label || value) {
        cellText(pdf, label, cx, cy, colW[i], 9, { size: 6.2, color: MUTED, bold: true });
        cellText(pdf, value, cx, cy + 8, colW[i], 11, { size: 8, bold: true });
      }
      cx += colW[i];
    }
    cy += rowH;
  }
  return cy;
}

function drawParties(pdf, doc, x, y, w) {
  const half = w / 2;
  const headH = 15;
  const bodyH = 72;
  const h = headH + bodyH;

  box(pdf, x, y, half, h);
  box(pdf, x + half, y, half, h);
  box(pdf, x, y, half, headH, GRAY);
  box(pdf, x + half, y, half, headH, GRAY);
  cellText(pdf, 'BILL TO', x, y, half, headH, { bold: true, size: 8, align: 'center', padY: 3 });
  cellText(pdf, 'SHIP TO / SERVICE LOCATION', x + half, y, half, headH, {
    bold: true,
    size: 8,
    align: 'center',
    padY: 3,
  });

  const left = [
    ['Legal Name', doc.recipientName || ''],
    ['Address', doc.placeOfSupply || doc.deliveryAddress || ''],
    ['GSTIN', doc.recipientGstin || ''],
    [
      'State / State Code',
      [doc.recipientStateName, doc.recipientStateCode].filter(Boolean).join(' / ') || doc.recipientStateCode || '',
    ],
  ];
  const right = [
    ['Legal / Location Name', doc.shipToName || ''],
    ['Address', doc.shipToAddress || ''],
    ['GSTIN (if applicable)', doc.shipToGstin || ''],
    [
      'State / State Code',
      [doc.shipToStateName, doc.shipToStateCode].filter(Boolean).join(' / ') || doc.shipToStateCode || '',
    ],
  ];

  const drawParty = (fields, ox) => {
    let py = y + headH + 3;
    for (const [label, value] of fields) {
      pdf.font('Helvetica-Bold').fontSize(6.2).fillColor(MUTED).text(label, ox + 5, py, { width: half - 10 });
      pdf.font('Helvetica').fontSize(7.5).fillColor(INK).text(value || ' ', ox + 5, py + 8, {
        width: half - 10,
        height: 12,
        ellipsis: true,
      });
      py += 16;
    }
  };
  drawParty(left, x);
  drawParty(right, x + half);
  return y + h;
}

function drawItemsTable(pdf, doc, cfg, x, y, w) {
  const cols = [
    { key: 'sr', label: 'Sr.', width: 26, align: 'center' },
    { key: 'desc', label: 'Description of Services', width: 0, align: 'left' },
    { key: 'sac', label: 'SAC', width: 48, align: 'center' },
    { key: 'qty', label: 'Qty', width: 34, align: 'center' },
    { key: 'rate', label: 'Rate (₹)', width: 54, align: 'right' },
    { key: 'taxable', label: 'Taxable Value (₹)', width: 74, align: 'right' },
    { key: 'gst', label: 'GST Rate', width: 50, align: 'center' },
  ];
  const flex = cols.find((c) => c.key === 'desc');
  const fixed = cols.reduce((s, c) => s + c.width, 0);
  flex.width = w - fixed;

  const headH = 16;
  const rowH = 16;
  const lines =
    Array.isArray(doc.lineItems) && doc.lineItems.length
      ? doc.lineItems.filter((r) => r.description || r.sectionTitle)
      : [{ description: '', qty: '', rate: '', taxableAmount: '', sacCode: '' }];

  let cx = x;
  for (const col of cols) {
    box(pdf, cx, y, col.width, headH, GRAY);
    cellText(pdf, col.label, cx, y, col.width, headH, { bold: true, size: 6.8, align: col.align, padY: 4 });
    cx += col.width;
  }

  let cy = y + headH;
  lines.forEach((line, idx) => {
    const taxable = toAmount(line.taxableAmount ?? line.amount);
    const cells = {
      sr: String(idx + 1),
      desc: line.description || '',
      sac: line.sacCode || '',
      qty: line.qty != null && line.qty !== '' ? String(line.qty) : '',
      rate: line.rate != null && line.rate !== '' ? moneyPlain(line.rate) : '',
      taxable: moneyPlain(taxable),
      gst: lineGstRateDisplay(line, cfg.gstMode),
    };
    cx = x;
    for (const col of cols) {
      box(pdf, cx, cy, col.width, rowH);
      cellText(pdf, cells[col.key], cx, cy, col.width, rowH, { size: 7.2, align: col.align, padY: 3 });
      cx += col.width;
    }
    cy += rowH;
  });

  const cgst = cfg.gstMode === 'nil' ? '' : moneyPlain(sumTax(lines, 'cgstAmount'));
  const sgst = cfg.gstMode === 'nil' ? '' : moneyPlain(sumTax(lines, 'sgstAmount'));
  const igst = cfg.gstMode === 'nil' ? '' : moneyPlain(sumTax(lines, 'igstAmount'));

  const labelW = 118;
  const valueW = 74;
  const totalX = x + w - labelW - valueW;
  const totalRows = [
    ['Taxable Value', moneyPlain(doc.subtotal)],
    ['CGST', cgst],
    ['SGST', sgst],
    ['IGST', igst],
    ['Round Off', moneyPlain(doc.roundOff || 0)],
    [cfg.totalLabel, moneyPlain(doc.grandTotal), true],
  ];
  for (const [label, value, strong] of totalRows) {
    box(pdf, totalX, cy, labelW, rowH, strong ? GRAY : null);
    box(pdf, totalX + labelW, cy, valueW, rowH, strong ? GRAY : null);
    cellText(pdf, label, totalX, cy, labelW, rowH, { size: 7.2, bold: Boolean(strong), padY: 3 });
    cellText(pdf, value, totalX + labelW, cy, valueW, rowH, {
      size: 7.2,
      bold: Boolean(strong),
      align: 'right',
      padY: 3,
    });
    cy += rowH;
  }
  return cy;
}

function drawAmountWords(pdf, doc, x, y, w) {
  const h = 20;
  box(pdf, x, y, w, h);
  const words = doc.amountInWords || amountInWordsIndian(doc.grandTotal);
  cellText(pdf, `Amount In Words: Rupees ${words || '____________________ Only.'}`, x, y, w, h, {
    size: 8,
    bold: true,
    padY: 5,
  });
  return y + h;
}

function drawFooter(pdf, org, doc, cfg, x, y, w) {
  const half = w / 2;
  const headH = 15;
  const bodyH = cfg.showGstExemptNote || cfg.declarationNote ? 110 : 88;
  const h = headH + bodyH;

  box(pdf, x, y, half, h);
  box(pdf, x + half, y, half, h);
  box(pdf, x, y, half, headH, GRAY);
  box(pdf, x + half, y, half, headH, GRAY);
  cellText(pdf, 'BANK DETAILS', x, y, half, headH, { bold: true, size: 8, align: 'center', padY: 3 });
  cellText(pdf, cfg.paymentTermsTitle, x + half, y, half, headH, {
    bold: true,
    size: 7.2,
    align: 'center',
    padY: 3,
  });

  const bankLines = [
    `Account Name: ${org.accountHolder || org.legalName || ''}`,
    `Bank: ${org.bankName || ''}`,
    `Branch: ${org.bankBranch || ''}`,
    `Account No.: ${org.accountNumber || ''}`,
    `IFSC: ${org.ifscCode || ''}`,
  ];
  let by = y + headH + 5;
  pdf.font('Helvetica').fontSize(7.2).fillColor(INK);
  for (const line of bankLines) {
    pdf.text(line, x + 6, by, { width: half - 12 });
    by = pdf.y + 1;
  }
  pdf.font('Helvetica-Oblique').fontSize(6.2).fillColor(MUTED).text(cfg.bankNote, x + 6, by + 3, {
    width: half - 12,
  });

  const termsText =
    (Array.isArray(doc.terms) && doc.terms.length ? doc.terms.join(' ') : '') || cfg.defaultTerms;
  let ty = y + headH + 5;
  pdf.font('Helvetica').fontSize(7.5).fillColor(INK).text(termsText, x + half + 6, ty, {
    width: half - 12,
  });
  if (cfg.showGstExemptNote) {
    const udyam = org.udyam || 'UDYAM-MH-19-0446179';
    const legal = org.legalName || 'Tylo Care Private Limited';
    const important = `GST Rate: NIL / EXEMPT. No GST has been charged on this supply as per the applicable provisions of the CGST Act, 2017. ${legal} is registered as a Micro Enterprise under the MSMED Act, 2006, bearing Udyam Registration No. ${udyam}.`;
    ty = pdf.y + 5;
    pdf.font('Helvetica').fontSize(6.8).fillColor(INK).text(important, x + half + 6, ty, {
      width: half - 12,
    });
  } else if (cfg.declarationNote || doc.declaration) {
    const fallback =
      typeof cfg.declarationNote === 'function' ? cfg.declarationNote(org, doc) : cfg.declarationNote;
    const note = trimStrSafe(doc.declaration) || fallback;
    ty = pdf.y + 5;
    pdf.font('Helvetica').fontSize(6.8).fillColor(INK).text(note, x + half + 6, ty, {
      width: half - 12,
    });
  }

  return y + h + 14;
}

function trimStrSafe(v) {
  return v == null ? '' : String(v).trim();
}

function drawSignatory(pdf, org, x, y, w) {
  const boxW = 180;
  const sx = x + w - boxW;
  pdf.font('Helvetica').fontSize(8).fillColor(INK).text(`For ${org.legalName || 'Tylo Care Private Limited'}`, sx, y, {
    width: boxW,
    align: 'center',
  });
  pdf
    .moveTo(sx + 20, y + 40)
    .lineTo(sx + boxW - 20, y + 40)
    .strokeColor(LINE)
    .lineWidth(0.6)
    .stroke();
  pdf.font('Helvetica').fontSize(8).fillColor(INK).text('Authorised Signatory', sx, y + 44, {
    width: boxW,
    align: 'center',
  });
}

/**
 * @param {object} docRow
 * @param {object} orgProfile
 * @param {'bill_of_supply'|'credit_note'|'debit_note'|'proforma'|'quotation'|'client_invoice'} documentType
 */
export function buildPortraitCommercialPdf(docRow, orgProfile, documentType) {
  const cfg = PORTRAIT_DOC_PRESETS[documentType] || PORTRAIT_DOC_PRESETS.bill_of_supply;
  const org = orgProfile || {};
  const doc = {
    ...docRow,
    amountInWords: docRow.amountInWords || amountInWordsIndian(docRow.grandTotal),
  };

  return new Promise((resolve, reject) => {
    const pdf = new PDFDocument({
      size: 'A4',
      margin: 0,
      info: {
        Title: `${cfg.title} ${doc.documentNumber || ''}`.trim(),
        Author: org.legalName || 'Tylo Care',
      },
    });
    const chunks = [];
    pdf.on('data', (c) => chunks.push(c));
    pdf.on('end', () => resolve(Buffer.concat(chunks)));
    pdf.on('error', reject);

    pdf.strokeColor(LINE).fillColor(INK);
    const x = PAGE.margin;
    let y = PAGE.margin;
    const w = contentW();

    y = drawHeader(pdf, org, cfg, x, y, w);
    y = drawMetaGrid(pdf, doc, cfg, x, y, w);
    y = drawParties(pdf, doc, x, y, w);
    y = drawItemsTable(pdf, doc, cfg, x, y, w);
    y = drawAmountWords(pdf, doc, x, y, w);
    y = drawFooter(pdf, org, doc, cfg, x, y, w);
    drawSignatory(pdf, org, x, y, w);

    pdf
      .rect(PAGE.margin - 4, PAGE.margin - 4, w + 8, PAGE.height - PAGE.margin * 2 + 8)
      .strokeColor(BRAND.line)
      .lineWidth(0.4)
      .stroke();

    pdf.end();
  });
}

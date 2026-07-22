/**
 * Unified A4 Landscape commercial document PDF template.
 * Supports: Purchase Order, Proforma Invoice, Tax Invoice, Credit Note.
 */
import PDFDocument from 'pdfkit';
import {
  amountInWordsIndian,
  formatDisplayDateErp,
  normalizeLineItem,
  toAmount,
  usesIgst,
} from './financeCommercial.service.js';
import { BRAND, moneyInr, moneyPlain, resolveLogoPath } from './pdfBrand.js';

export const PAGE = {
  width: 841.89,
  height: 595.28,
  margin: 24,
  footerReserve: 56,
  slimHeaderH: 36,
};

/** Readable print typography (pt) — tuned for A4 landscape */
const FONT = {
  companyName: 14,
  docType: 16,
  headerBody: 10,
  metaLabel: 9,
  metaValue: 10,
  slimTitle: 11,
  slimMeta: 10,
  partyHeader: 9.5,
  partyName: 11,
  partyBody: 10,
  tableHeader: 9.5,
  tableBody: 9.5,
  tableSection: 10,
  blockTitle: 10,
  body: 10,
  bodyBold: 10,
  grandTotal: 14,
  footerLabel: 9.5,
  footerName: 10,
  disclaimer: 9,
  statutory: 8.5,
  summaryValue: 10,
};

export const DOC_PDF_CONFIG = {
  purchase_order: {
    typeLabel: 'PURCHASE ORDER',
    showPaymentDetails: false,
    leftPartyTitle: 'Recipient Details',
    rightPartyTitle: 'Supplier Details',
  },
  proforma: {
    typeLabel: 'PROFORMA INVOICE',
    showPaymentDetails: true,
    leftPartyTitle: 'Recipient Details',
    rightPartyTitle: 'Supplier Details',
  },
  client_invoice: {
    typeLabel: 'TAX INVOICE',
    showPaymentDetails: true,
    leftPartyTitle: 'Recipient Details',
    rightPartyTitle: 'Supplier Details',
  },
  credit_note: {
    typeLabel: 'CREDIT NOTE',
    showPaymentDetails: false,
    leftPartyTitle: 'Recipient Details',
    rightPartyTitle: 'Supplier Details',
  },
};

function contentW() {
  return PAGE.width - PAGE.margin * 2;
}

function hrule(pdf, x, y, w) {
  pdf.strokeColor(BRAND.line).lineWidth(0.5).moveTo(x, y).lineTo(x + w, y).stroke();
}

function resolveDocType(docRow) {
  return docRow.documentType || 'proforma';
}

function resolveTypeLabel(docRow, cfg) {
  if (docRow.documentType === 'client_invoice' && docRow.reverseCharge === 'Y') {
    return 'BILL OF SUPPLY';
  }
  return cfg.typeLabel;
}

function buildParties(docType, docRow, org) {
  const orgParty = {
    name: org.legalName || org.brandLine,
    lines: [
      org.registeredOffice,
      org.gstin ? `GSTIN: ${org.gstin}` : '',
      org.pan ? `PAN: ${org.pan}` : '',
      org.phone ? `Phone: ${org.phone}` : '',
      org.email || '',
      org.website || '',
    ].filter(Boolean),
  };

  const clientParty = {
    name: docRow.recipientName,
    lines: [
      docRow.placeOfSupply,
      docRow.deliveryAddress && docRow.deliveryAddress !== docRow.placeOfSupply
        ? `Ship To: ${docRow.deliveryAddress}`
        : '',
      docRow.recipientGstin ? `GSTIN: ${docRow.recipientGstin}` : '',
      docRow.recipientPan ? `PAN: ${docRow.recipientPan}` : '',
      docRow.recipientStateCode ? `State Code: ${docRow.recipientStateCode}` : '',
      docRow.contactPerson ? `Contact: ${docRow.contactPerson}` : '',
      docRow.contactEmail || '',
    ].filter(Boolean),
  };

  const vendorParty = {
    name: docRow.recipientName,
    lines: [
      docRow.placeOfSupply,
      docRow.recipientGstin ? `GSTIN: ${docRow.recipientGstin}` : '',
      docRow.contactPerson ? `Contact: ${docRow.contactPerson}` : '',
      docRow.contactEmail || '',
    ].filter(Boolean),
  };

  if (docType === 'purchase_order') {
    return { left: orgParty, right: vendorParty };
  }
  return { left: clientParty, right: orgParty };
}

function normalizeGstLines(docRow, org) {
  const taxMode =
    docRow.taxMode || (usesIgst(docRow.recipientStateCode, org.stateCode) ? 'igst' : 'cgst_sgst');
  const raw = Array.isArray(docRow.lineItems) ? docRow.lineItems : [];
  const lines = [];
  for (let i = 0; i < raw.length; i += 1) {
    const row = raw[i];
    if (row.sectionTitle) {
      lines.push({ sectionTitle: row.sectionTitle });
      continue;
    }
    if (!String(row.description || '').trim()) continue;
    const item = normalizeLineItem(row, i, taxMode);
    const gstRate =
      taxMode === 'igst'
        ? item.igstRate
        : (Number(item.cgstRate) || 0) + (Number(item.sgstRate) || 0);
    const gstAmount =
      (Number(item.igstAmount) || 0) + (Number(item.cgstAmount) || 0) + (Number(item.sgstAmount) || 0);
    lines.push({
      description: item.description,
      sacCode: item.sacCode,
      gstRate,
      qty: item.qty,
      rate: item.rate,
      discount: item.discount,
      taxableAmount: item.taxableAmount,
      gstAmount,
      igstAmount: item.igstAmount,
      cgstAmount: item.cgstAmount,
      sgstAmount: item.sgstAmount,
      totalAmount: item.totalAmount,
    });
  }
  return { taxMode, lines };
}

function normalizePoLines(docRow) {
  const taxRate = Number(docRow.purchaseTaxRate) || 5;
  const lines = [];
  for (const raw of docRow.lineItems || []) {
    if (!String(raw.description || '').trim()) continue;
    const isFoc = Boolean(raw.isFoc);
    const qty = toAmount(raw.qty) || 0;
    const rate = isFoc ? 0 : toAmount(raw.rate) || 0;
    const discount = 0;
    const taxableAmount =
      raw.amount != null && raw.amount !== ''
        ? toAmount(raw.amount)
        : Math.round(qty * rate * 100) / 100;
    const gstAmount = Math.round((taxableAmount * taxRate) / 100 * 100) / 100;
    lines.push({
      description: isFoc ? `${raw.description} (FOC)` : raw.description,
      sacCode: raw.hsnCode || raw.sacCode || '—',
      gstRate: taxRate,
      qty,
      rate,
      discount,
      taxableAmount,
      gstAmount,
      totalAmount: Math.round((taxableAmount + gstAmount) * 100) / 100,
    });
  }
  return { taxMode: 'igst', lines, flatTaxRate: taxRate };
}

function aggregateTax(lines, taxMode) {
  const map = new Map();
  for (const row of lines) {
    if (row.sectionTitle) continue;
    const rate = Number(row.gstRate) || 0;
    const key = `${taxMode}-${rate}`;
    const entry = map.get(key) || {
      rate,
      taxable: 0,
      igst: 0,
      cgst: 0,
      sgst: 0,
      gstAmount: 0,
    };
    entry.taxable += Number(row.taxableAmount) || 0;
    entry.gstAmount += Number(row.gstAmount) || 0;
    if (taxMode === 'igst') {
      entry.igst += Number(row.igstAmount) || Number(row.gstAmount) || 0;
    } else {
      entry.cgst += Number(row.cgstAmount) || 0;
      entry.sgst += Number(row.sgstAmount) || 0;
    }
    map.set(key, entry);
  }
  return [...map.values()].map((r) => ({
    ...r,
    taxable: Math.round(r.taxable * 100) / 100,
    igst: Math.round(r.igst * 100) / 100,
    cgst: Math.round(r.cgst * 100) / 100,
    sgst: Math.round(r.sgst * 100) / 100,
    gstAmount: Math.round(r.gstAmount * 100) / 100,
  }));
}

function itemColumns(contentWidth) {
  const fixed = 28 + 44 + 38 + 40 + 58 + 52 + 64 + 58 + 66;
  const productW = Math.max(120, contentWidth - fixed);
  return [
    { key: 'sr', label: 'Sl. No.', w: 28, align: 'center' },
    { key: 'product', label: 'Product Name', w: productW, align: 'left' },
    { key: 'hsn', label: 'HSN/SAC', w: 44, align: 'center' },
    { key: 'gst', label: 'GST %', w: 38, align: 'right' },
    { key: 'qty', label: 'Qty', w: 40, align: 'right' },
    { key: 'rate', label: 'Unit Rate', w: 58, align: 'right' },
    { key: 'disc', label: 'Discount', w: 52, align: 'right' },
    { key: 'taxable', label: 'Taxable', w: 64, align: 'right' },
    { key: 'gstAmt', label: 'GST', w: 58, align: 'right' },
    { key: 'total', label: 'Total', w: 66, align: 'right' },
  ];
}

function drawTableHeader(pdf, margin, y, cols) {
  const tableW = cols.reduce((s, c) => s + c.w, 0);
  const headerH = 24;
  pdf.save();
  pdf.rect(margin, y, tableW, headerH).fill(BRAND.royal);
  pdf.restore();
  let cx = margin;
  pdf.font('Helvetica-Bold').fontSize(FONT.tableHeader).fillColor(BRAND.white);
  for (const col of cols) {
    pdf.text(col.label, cx + 3, y + 7, { width: col.w - 6, align: col.align || 'left' });
    cx += col.w;
  }
  return y + headerH;
}

function drawSlimHeader(pdf, margin, contentWidth, meta, pageNum) {
  const y = margin;
  pdf
    .font('Helvetica-Bold')
    .fontSize(FONT.slimTitle)
    .fillColor(BRAND.royal)
    .text(meta.typeLabel, margin, y + 4);
  pdf
    .font('Helvetica')
    .fontSize(FONT.slimMeta)
    .fillColor(BRAND.muted)
    .text(
      `${meta.docNumber}  ·  ${meta.docDate}  ·  Page ${pageNum}`,
      margin + 200,
      y + 4,
      { width: contentWidth - 200, align: 'right' }
    );
  hrule(pdf, margin, y + PAGE.slimHeaderH - 4, contentWidth);
  return margin + PAGE.slimHeaderH;
}

function drawFullHeader(pdf, org, margin, contentWidth, meta) {
  const logoPath = resolveLogoPath();
  const leftW = contentWidth * 0.55;
  const rightX = margin + leftW + 12;
  const rightW = contentWidth - leftW - 12;
  let y = margin;

  if (logoPath) {
    pdf.image(logoPath, margin, y, { width: 80 });
  }

  const textX = margin + (logoPath ? 86 : 0);
  const textW = leftW - (logoPath ? 86 : 0);
  pdf
    .font('Helvetica-Bold')
    .fontSize(FONT.companyName)
    .fillColor(BRAND.ink)
    .text(org.legalName || org.brandLine || 'TYLO', textX, y, { width: textW });
  y = Math.max(y + 4, pdf.y + 2);

  const leftLines = [
    org.registeredOffice,
    org.gstin ? `GSTIN: ${org.gstin}` : '',
    [org.phone ? `Phone: ${org.phone}` : '', org.email || ''].filter(Boolean).join('  ·  '),
    org.website || '',
  ].filter(Boolean);

  pdf.font('Helvetica').fontSize(FONT.headerBody).fillColor(BRAND.muted);
  for (const line of leftLines) {
    pdf.text(line, textX, y, { width: textW, lineGap: 1 });
    y = pdf.y + 2;
  }

  let ry = margin;
  pdf
    .font('Helvetica-Bold')
    .fontSize(FONT.docType)
    .fillColor(BRAND.royal)
    .text(meta.typeLabel, rightX, ry, { width: rightW, align: 'right' });
  ry = pdf.y + 10;

  const metaRows = [
    ['Document Number', meta.docNumber],
    ['Creation Date', meta.docDate],
    ['Due Date', meta.dueDate || '—'],
    ['Page', meta.pageLabel || '1'],
  ];

  pdf.save();
  pdf.rect(rightX, ry, rightW, metaRows.length * 17 + 10).fill(BRAND.metaBg);
  pdf.rect(rightX, ry, rightW, metaRows.length * 17 + 10).lineWidth(0.5).strokeColor(BRAND.line).stroke();
  pdf.restore();

  let my = ry + 6;
  for (const [label, value] of metaRows) {
    pdf.font('Helvetica').fontSize(FONT.metaLabel).fillColor(BRAND.muted).text(label.toUpperCase(), rightX + 8, my, {
      width: rightW - 16,
    });
    my += 9;
    pdf.font('Helvetica-Bold').fontSize(FONT.metaValue).fillColor(BRAND.ink).text(String(value), rightX + 8, my, {
      width: rightW - 16,
      align: 'right',
    });
    my += 8;
  }

  const endY = Math.max(y, my) + 8;
  hrule(pdf, margin, endY, contentWidth);
  return endY + 8;
}

function drawPartySection(pdf, margin, y, contentWidth, cfg, parties) {
  const colW = (contentWidth - 12) / 2;
  const pad = 8;
  const headerH = 22;

  function drawBlock(x, title, party) {
    pdf.roundedRect(x, y, colW, headerH, 3).fill(BRAND.royal);
    pdf
      .font('Helvetica-Bold')
      .fontSize(FONT.partyHeader)
      .fillColor(BRAND.white)
      .text(title.toUpperCase(), x + pad, y + 6, { width: colW - pad * 2 });

    pdf.font('Helvetica').fontSize(FONT.partyBody);
    let bodyLines = [{ bold: true, text: party.name || '—', size: FONT.partyName }];
    bodyLines = bodyLines.concat((party.lines || []).map((t) => ({ text: t })));
    let bodyH = pad;
    for (const line of bodyLines) {
      pdf.font(line.bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(line.size || FONT.partyBody);
      bodyH += pdf.heightOfString(line.text, { width: colW - pad * 2, lineGap: 1 }) + 3;
    }
    bodyH += pad;

    pdf.save();
    pdf.rect(x, y + headerH - 2, colW, bodyH + 2).lineWidth(0.5).strokeColor(BRAND.line).stroke();
    pdf.restore();

    let cy = y + headerH + pad;
    for (const line of bodyLines) {
      pdf
        .font(line.bold ? 'Helvetica-Bold' : 'Helvetica')
        .fontSize(line.size || FONT.partyBody)
        .fillColor(line.bold ? BRAND.ink : BRAND.muted)
        .text(line.text, x + pad, cy, { width: colW - pad * 2, lineGap: 1 });
      cy = pdf.y + 3;
    }
    return y + headerH + bodyH;
  }

  const leftEnd = drawBlock(margin, cfg.leftPartyTitle, parties.left);
  const rightEnd = drawBlock(margin + colW + 12, cfg.rightPartyTitle, parties.right);
  const endY = Math.max(leftEnd, rightEnd) + 8;
  hrule(pdf, margin, endY, contentWidth);
  return endY + 8;
}

function drawItemsTable(pdf, ctx, startY, lines) {
  const { margin, contentWidth, meta } = ctx;
  const cols = itemColumns(contentWidth);
  const tableW = cols.reduce((s, c) => s + c.w, 0);
  const bottomLimit = PAGE.height - PAGE.margin - PAGE.footerReserve;
  let y = drawTableHeader(pdf, margin, startY, cols);
  let sr = 0;
  let pageNum = 1;

  for (const item of lines) {
    if (item.sectionTitle) {
      const sectionH = 20;
      if (y + sectionH > bottomLimit) {
        pdf.addPage({ size: 'A4', layout: 'landscape' });
        pageNum += 1;
        y = drawSlimHeader(pdf, margin, contentWidth, meta, pageNum);
        y = drawTableHeader(pdf, margin, y, cols);
      }
      pdf.save();
      pdf.rect(margin, y, tableW, sectionH).fill(BRAND.royalLight);
      pdf.restore();
      pdf
        .font('Helvetica-Bold')
        .fontSize(FONT.tableSection)
        .fillColor(BRAND.royalDark)
        .text(item.sectionTitle, margin + 5, y + 5, { width: tableW - 10 });
      y += sectionH;
      continue;
    }

    sr += 1;
    const row = {
      sr: String(sr),
      product: item.description || '—',
      hsn: item.sacCode || '—',
      gst: `${Number(item.gstRate || 0).toFixed(2)}%`,
      qty: item.qty ? String(item.qty) : '—',
      rate: moneyPlain(item.rate),
      disc: item.discount ? moneyPlain(item.discount) : '—',
      taxable: moneyPlain(item.taxableAmount),
      gstAmt: moneyPlain(item.gstAmount),
      total: moneyPlain(item.totalAmount),
    };

    pdf.font('Helvetica').fontSize(FONT.tableBody);
    const descH = pdf.heightOfString(row.product, { width: cols[1].w - 6 });
    const rowH = Math.max(20, descH + 8);

    if (y + rowH > bottomLimit) {
      pdf.addPage({ size: 'A4', layout: 'landscape' });
      pageNum += 1;
      y = drawSlimHeader(pdf, margin, contentWidth, meta, pageNum);
      y = drawTableHeader(pdf, margin, y, cols);
    }

    if (sr % 2 === 0) {
      pdf.save();
      pdf.rect(margin, y, tableW, rowH).fill(BRAND.rowAlt);
      pdf.restore();
    }

    let cx = margin;
    pdf.fillColor(BRAND.ink);
    for (const col of cols) {
      pdf.text(String(row[col.key] ?? ''), cx + 3, y + 5, {
        width: col.w - 6,
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
  }

  ctx.pageNum = pageNum;
  return y + 6;
}

function drawTaxSummary(pdf, margin, y, contentWidth, taxRows, taxMode) {
  if (!taxRows.length) return y;
  pdf.font('Helvetica-Bold').fontSize(FONT.blockTitle).fillColor(BRAND.royal).text('Tax Summary', margin, y);
  y += 14;

  const cols =
    taxMode === 'igst'
      ? [
          { label: 'GST %', w: 56, align: 'center' },
          { label: 'Taxable Value', w: 110, align: 'right' },
          { label: 'IGST', w: 100, align: 'right' },
          { label: 'Total Tax', w: 100, align: 'right' },
        ]
      : [
          { label: 'GST %', w: 48, align: 'center' },
          { label: 'Taxable Value', w: 96, align: 'right' },
          { label: 'CGST', w: 80, align: 'right' },
          { label: 'SGST', w: 80, align: 'right' },
          { label: 'Total Tax', w: 80, align: 'right' },
        ];

  const tableW = cols.reduce((s, c) => s + c.w, 0);
  const headerH = 20;
  const rowH = 18;

  pdf.save();
  pdf.rect(margin, y, tableW, headerH).fill(BRAND.royalMuted);
  pdf.restore();

  let cx = margin;
  pdf.font('Helvetica-Bold').fontSize(FONT.tableHeader).fillColor(BRAND.white);
  for (const col of cols) {
    pdf.text(col.label, cx + 4, y + 5, { width: col.w - 8, align: col.align });
    cx += col.w;
  }
  y += headerH;

  taxRows.forEach((row, idx) => {
    if (idx % 2 === 1) {
      pdf.save();
      pdf.rect(margin, y, tableW, rowH).fill(BRAND.rowAlt);
      pdf.restore();
    }
    cx = margin;
    pdf.font('Helvetica').fontSize(FONT.tableBody).fillColor(BRAND.ink);
    const vals =
      taxMode === 'igst'
        ? [`${row.rate}%`, moneyPlain(row.taxable), moneyPlain(row.igst), moneyPlain(row.gstAmount)]
        : [
            `${row.rate}%`,
            moneyPlain(row.taxable),
            moneyPlain(row.cgst),
            moneyPlain(row.sgst),
            moneyPlain(row.gstAmount),
          ];
    vals.forEach((val, i) => {
      pdf.text(val, cx + 4, y + 4, { width: cols[i].w - 8, align: cols[i].align });
      cx += cols[i].w;
    });
    y += rowH;
  });

  return y + 10;
}

function drawFinancialSummary(pdf, margin, y, contentWidth, docRow, showPayment) {
  const panelW = 200;
  const leftW = contentWidth - panelW - 16;
  const panelX = margin + contentWidth - panelW;
  const startY = y;

  const totalDiscount = (docRow.lineItems || []).reduce(
    (s, r) => s + (Number(r.discount) || 0),
    0
  );

  pdf.font('Helvetica-Bold').fontSize(FONT.blockTitle).fillColor(BRAND.royal).text('Amount in Words', margin, y);
  y = pdf.y + 4;
  pdf
    .font('Helvetica')
    .fontSize(FONT.body)
    .fillColor(BRAND.ink)
    .text(docRow.amountInWords ? `Rupees ${docRow.amountInWords}` : '—', margin, y, {
      width: leftW,
      lineGap: 1,
    });
  y = pdf.y + 10;

  pdf.font('Helvetica-Bold').fontSize(FONT.blockTitle).fillColor(BRAND.royal).text('Terms / Remarks', margin, y);
  y = pdf.y + 4;
  pdf
    .font('Helvetica')
    .fontSize(FONT.body)
    .fillColor(BRAND.muted)
    .text(docRow.customNotes || '—', margin, y, { width: leftW, lineGap: 1 });
  let leftEnd = pdf.y + 8;

  if (showPayment && (docRow._org?.bankName || docRow._org?.accountNumber)) {
    const org = docRow._org;
    pdf.font('Helvetica-Bold').fontSize(FONT.blockTitle).fillColor(BRAND.royal).text('Payment Details', margin, leftEnd);
    leftEnd = pdf.y + 4;
    const payLines = [
      org.bankName ? `Bank: ${org.bankName}` : '',
      org.accountNumber ? `A/c No.: ${org.accountNumber}` : '',
      org.ifscCode ? `IFSC: ${org.ifscCode}` : '',
      org.bankBranch ? `Branch: ${org.bankBranch}` : '',
      `Beneficiary: ${org.legalName || org.brandLine || '—'}`,
    ].filter(Boolean);
    pdf.font('Helvetica').fontSize(FONT.body).fillColor(BRAND.muted);
    for (const line of payLines) {
      pdf.text(line, margin, leftEnd, { width: leftW });
      leftEnd = pdf.y + 1;
    }
    leftEnd += 4;
  }

  const finRows = [
    ['Subtotal', moneyPlain(docRow.subtotal)],
    ['Discount', totalDiscount ? moneyPlain(totalDiscount) : '—'],
    ['Taxable Value', moneyPlain(docRow.subtotal)],
    ['GST', moneyPlain(docRow.taxAmount)],
  ];
  if (docRow.cnAmount) finRows.push(['Credit Note', `(${moneyPlain(docRow.cnAmount)})`]);
  if (docRow.advanceReceived) finRows.push(['Advance', `(${moneyPlain(docRow.advanceReceived)})`]);
  if (docRow.dnAmount) finRows.push(['Debit Note', moneyPlain(docRow.dnAmount)]);
  if (docRow.roundOff) finRows.push(['Round Off', moneyPlain(docRow.roundOff)]);

  let py = startY;
  const boxH = 12 + finRows.length * 16 + 30;
  pdf.save();
  pdf.rect(panelX, py, panelW, boxH).fill(BRAND.metaBg);
  pdf.rect(panelX, py, panelW, boxH).lineWidth(0.5).strokeColor(BRAND.line).stroke();
  pdf.restore();
  py += 10;

  pdf.font('Helvetica-Bold').fontSize(FONT.blockTitle).fillColor(BRAND.royal).text('Financial Summary', panelX + 10, py);
  py += 14;

  for (const [label, value] of finRows) {
    pdf.font('Helvetica').fontSize(FONT.body).fillColor(BRAND.muted).text(label, panelX + 10, py, {
      width: panelW * 0.5,
    });
    pdf
      .font('Helvetica-Bold')
      .fontSize(FONT.summaryValue)
      .fillColor(BRAND.ink)
      .text(String(value), panelX + panelW * 0.45, py, { width: panelW * 0.5 - 10, align: 'right' });
    py += 16;
  }

  py += 2;
  hrule(pdf, panelX + 8, py, panelW - 16);
  py += 6;
  pdf.font('Helvetica-Bold').fontSize(FONT.bodyBold).fillColor(BRAND.muted).text('Grand Total', panelX + 10, py);
  pdf
    .font('Helvetica-Bold')
    .fontSize(FONT.grandTotal)
    .fillColor(BRAND.success)
    .text(moneyInr(docRow.grandTotal), panelX + panelW * 0.35, py - 2, {
      width: panelW * 0.62,
      align: 'right',
    });

  return Math.max(leftEnd, py + 24) + 8;
}

function drawDocumentFooter(pdf, margin, y, contentWidth, docRow, org) {
  const colW = (contentWidth - 20) / 2;
  const createdBy = docRow.createdByEmail || docRow.createdByName || '—';
  const orgName = org.brandLine || org.legalName || 'TYLO';

  hrule(pdf, margin, y, contentWidth);
  y += 10;

  pdf
    .strokeColor(BRAND.line)
    .lineWidth(0.5)
    .moveTo(margin, y + 28)
    .lineTo(margin + colW, y + 28)
    .stroke();
  pdf
    .font('Helvetica-Bold')
    .fontSize(FONT.footerLabel)
    .fillColor(BRAND.muted)
    .text('CREATED BY', margin, y + 34, { width: colW, align: 'center' });
  pdf
    .font('Helvetica')
    .fontSize(FONT.footerName)
    .fillColor(BRAND.ink)
    .text(createdBy, margin, y + 46, { width: colW, align: 'center' });

  const sigX = margin + colW + 20;
  pdf
    .strokeColor(BRAND.line)
    .lineWidth(0.5)
    .moveTo(sigX, y + 28)
    .lineTo(sigX + colW, y + 28)
    .stroke();
  pdf
    .font('Helvetica-Bold')
    .fontSize(FONT.footerLabel)
    .fillColor(BRAND.muted)
    .text('AUTHORIZED SIGNATORY & COMPANY SEAL', sigX, y + 34, { width: colW, align: 'center' });
  pdf
    .font('Helvetica')
    .fontSize(FONT.footerName)
    .fillColor(BRAND.ink)
    .text(`For ${orgName}`, sigX, y + 46, { width: colW, align: 'center' });

  y += 62;
  pdf
    .font('Helvetica-Oblique')
    .fontSize(FONT.disclaimer)
    .fillColor(BRAND.muted)
    .text(
      'This is a computer-generated document. Valid without physical signature when issued electronically.',
      margin,
      y,
      { width: contentWidth, align: 'center' }
    );

  return y + 10;
}

function stampFooters(pdf, org) {
  const range = pdf.bufferedPageRange();
  const margin = PAGE.margin;
  const cw = contentW();
  const footerY = PAGE.height - PAGE.margin + 4;

  for (let i = range.start; i < range.start + range.count; i += 1) {
    pdf.switchToPage(i);
    const pageNum = i - range.start + 1;
    const total = range.count;
    const stat = [org.cin ? `CIN: ${org.cin}` : '', org.pan ? `PAN: ${org.pan}` : '', org.gstin ? `GSTIN: ${org.gstin}` : '']
      .filter(Boolean)
      .join('   |   ');
    pdf.font('Helvetica').fontSize(FONT.statutory).fillColor(BRAND.muted);
    pdf.text(stat, margin, footerY, { width: cw * 0.75, align: 'left' });
    pdf.text(`Page ${pageNum} of ${total}`, margin + cw * 0.75, footerY, {
      width: cw * 0.25,
      align: 'right',
    });
  }
}

/**
 * Build unified commercial document PDF buffer.
 * @param {object} docRow - FinanceCommercialDocument
 * @param {object} orgProfile - FinanceOrgProfile
 * @param {string} [documentType] - override docRow.documentType
 */
export function buildCommercialDocumentPdf(docRow, orgProfile, documentType) {
  const org = orgProfile || {};
  const docType = documentType || resolveDocType(docRow);
  const cfg = DOC_PDF_CONFIG[docType] || DOC_PDF_CONFIG.proforma;
  const typeLabel = resolveTypeLabel(docRow, cfg);

  const isPo = docType === 'purchase_order';
  const { taxMode, lines } = isPo ? normalizePoLines(docRow) : normalizeGstLines(docRow, org);

  const enriched = {
    ...docRow,
    _org: org,
    amountInWords: docRow.amountInWords || amountInWordsIndian(docRow.grandTotal),
  };

  const meta = {
    typeLabel,
    docNumber: docRow.documentNumber || docRow.docKey || 'Draft',
    docDate: formatDisplayDateErp(docRow.documentDate),
    dueDate: formatDisplayDateErp(docRow.dueDate),
    pageLabel: '1',
  };

  const parties = buildParties(docType, docRow, org);
  const taxRows = aggregateTax(lines, taxMode);
  const margin = PAGE.margin;
  const cw = contentW();

  return new Promise((resolve, reject) => {
    const pdf = new PDFDocument({
      size: 'A4',
      layout: 'landscape',
      margins: { top: margin, bottom: margin, left: margin, right: margin },
      info: {
        Title: `${typeLabel} ${meta.docNumber}`,
        Author: org.legalName || 'TYLO',
        Creator: 'TYLO One Finance',
      },
      bufferPages: true,
    });

    const chunks = [];
    pdf.on('data', (c) => chunks.push(c));
    pdf.on('end', () => resolve(Buffer.concat(chunks)));
    pdf.on('error', reject);

    const ctx = { margin, contentWidth: cw, meta, pageNum: 1 };

    let y = drawFullHeader(pdf, org, margin, cw, meta);
    y = drawPartySection(pdf, margin, y, cw, cfg, parties);
    y = drawItemsTable(pdf, ctx, y, lines);

    const bottomLimit = PAGE.height - PAGE.margin - PAGE.footerReserve;
    if (y + 120 > bottomLimit) {
      pdf.addPage({ size: 'A4', layout: 'landscape' });
      ctx.pageNum += 1;
      y = drawSlimHeader(pdf, margin, cw, meta, ctx.pageNum);
    }

    y = drawTaxSummary(pdf, margin, y, cw, taxRows, taxMode);

    const terms = [...(docRow.terms || []), ...(docType === 'proforma' ? org.proformaNotes || [] : org.defaultTerms || [])].filter(
      Boolean
    );
    if (terms.length) {
      pdf.font('Helvetica-Bold').fontSize(FONT.blockTitle).fillColor(BRAND.royal).text('Additional Terms', margin, y);
      y = pdf.y + 5;
      terms.slice(0, 4).forEach((t, i) => {
        pdf.font('Helvetica').fontSize(FONT.body).fillColor(BRAND.muted).text(`${i + 1}. ${t}`, margin, y, {
          width: cw * 0.6,
          lineGap: 1,
        });
        y = pdf.y + 3;
      });
      y += 4;
    }

    if (y + 100 > bottomLimit) {
      pdf.addPage({ size: 'A4', layout: 'landscape' });
      ctx.pageNum += 1;
      y = drawSlimHeader(pdf, margin, cw, meta, ctx.pageNum);
    }

    y = drawFinancialSummary(pdf, margin, y, cw, enriched, cfg.showPaymentDetails);
    y = drawDocumentFooter(pdf, margin, y, cw, docRow, org);

    stampFooters(pdf, org);
    pdf.end();
  });
}

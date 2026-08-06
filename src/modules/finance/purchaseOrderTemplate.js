/**
 * A4 Portrait Purchase Order PDF — Tylo Care procurement template.
 */
import PDFDocument from 'pdfkit';
import {
  amountInWordsIndian,
  formatDisplayDateErp,
  toAmount,
} from './financeCommercial.service.js';
import { BRAND, moneyPlain, resolveLogoPath } from './pdfBrand.js';

const PAGE = { width: 595.28, height: 841.89, margin: 22 };
const GRAY = '#E5E7EB';
const INK = '#111827';
const MUTED = '#4B5563';
const LINE = '#111827';

function contentW() {
  return PAGE.width - PAGE.margin * 2;
}

function box(pdf, x, y, w, h, fill = null) {
  if (fill) pdf.save().rect(x, y, w, h).fill(fill).restore();
  pdf.rect(x, y, w, h).strokeColor(LINE).lineWidth(0.6).stroke();
}

function cell(pdf, text, x, y, w, h, opts = {}) {
  const { align = 'left', bold = false, size = 7, color = INK, padX = 2.5, padY = 1.5 } = opts;
  pdf
    .fillColor(color)
    .font(bold ? 'Helvetica-Bold' : 'Helvetica')
    .fontSize(size)
    .text(String(text ?? ''), x + padX, y + padY, {
      width: w - padX * 2,
      height: h - padY * 2,
      align,
      ellipsis: true,
    });
}

function sectionHead(pdf, title, x, y, w, h = 13) {
  box(pdf, x, y, w, h, GRAY);
  cell(pdf, title, x, y, w, h, { bold: true, size: 7.5, align: 'center', padY: 2.5 });
  return y + h;
}

function labeledField(pdf, label, value, x, y, w, rowH) {
  box(pdf, x, y, w, rowH);
  cell(pdf, label, x, y, w * 0.38, rowH, { bold: true, size: 6, color: MUTED });
  cell(pdf, value || '', x + w * 0.38, y, w * 0.62, rowH, { size: 7 });
}

function drawHeader(pdf, org, x, y, w) {
  const logoPath = resolveLogoPath();
  const logoW = 68;
  const titleW = 120;
  const midX = x + logoW + 6;
  const midW = w - logoW - titleW - 12;

  if (logoPath) {
    try {
      pdf.image(logoPath, x, y, { fit: [logoW, 32], align: 'left', valign: 'center' });
    } catch {
      pdf.font('Helvetica-Bold').fontSize(14).fillColor(INK).text('TYLO', x, y + 2);
      pdf
        .font('Helvetica')
        .fontSize(6)
        .fillColor(MUTED)
        .text(org.brandLine || 'Bringing Healthcare Closer', x, y + 18, { width: logoW });
    }
  } else {
    pdf.font('Helvetica-Bold').fontSize(14).fillColor(INK).text('TYLO', x, y + 2);
    pdf
      .font('Helvetica')
      .fontSize(6)
      .fillColor(MUTED)
      .text(org.brandLine || 'Bringing Healthcare Closer', x, y + 18, { width: logoW });
  }

  const lines = [
    `Registered Office: ${org.registeredOffice || ''}`,
    [
      org.gstin ? `GSTIN: ${org.gstin}` : null,
      org.cin ? `CIN: ${org.cin}` : null,
      org.udyam ? `Udyam: ${org.udyam}${org.udyamLabel ? ` (${org.udyamLabel})` : ''}` : null,
    ]
      .filter(Boolean)
      .join('  |  '),
    [org.email ? `Email: ${org.email}` : null, org.website ? `Website: ${org.website}` : null]
      .filter(Boolean)
      .join('  |  '),
  ].filter(Boolean);

  let ty = y;
  pdf.font('Helvetica').fontSize(6.2).fillColor(INK);
  for (const line of lines) {
    pdf.text(line, midX, ty, { width: midW, align: 'center' });
    ty = pdf.y + 1;
  }

  pdf
    .font('Helvetica-Bold')
    .fontSize(12)
    .fillColor(INK)
    .text('PURCHASE ORDER', x + w - titleW, y + 8, { width: titleW, align: 'right' });

  return y + 34;
}

function drawMeta(pdf, doc, x, y, w) {
  const col = w / 3;
  const rowH = 14;
  const cells = [
    ['Purchase Order No.', doc.documentNumber || ''],
    ['Purchase Order Date', formatDisplayDateErp(doc.documentDate) || 'DD/MM/YYYY'],
    ['Revision No.', doc.revisionNo != null && doc.revisionNo !== '' ? String(doc.revisionNo) : '0'],
    ['Vendor Quote Ref.', doc.vendorQuoteRef || doc.reference || ''],
    ['Vendor Quote Date', formatDisplayDateErp(doc.vendorQuoteDate || doc.referenceDate) || 'DD/MM/YYYY'],
    ['Project / Cost Centre / Dept.', doc.projectCostCentre || doc.projectName || ''],
  ];
  let cy = y;
  for (let r = 0; r < 2; r += 1) {
    for (let c = 0; c < 3; c += 1) {
      const [label, value] = cells[r * 3 + c];
      const cx = x + c * col;
      box(pdf, cx, cy, col, rowH);
      cell(pdf, label, cx, cy, col, 6.5, { size: 5.6, bold: true, color: MUTED });
      cell(pdf, value, cx, cy + 6, col, 8, { size: 7, bold: true });
    }
    cy += rowH;
  }
  return cy;
}

function drawBuyerVendor(pdf, doc, org, x, y, w) {
  const half = w / 2;
  const headH = 12;
  const rows = 7;
  const rowH = 10;
  const bodyH = rows * rowH;
  box(pdf, x, y, half, headH + bodyH);
  box(pdf, x + half, y, half, headH + bodyH);
  sectionHead(pdf, 'BUYER DETAILS', x, y, half, headH);
  sectionHead(pdf, 'VENDOR DETAILS', x + half, y, half, headH);

  const buyer = [
    ['Company Name', doc.buyerCompanyName || org.legalName || 'Tylo Care Private Limited'],
    ['Registered Office', doc.buyerAddress || org.registeredOffice || ''],
    ['GSTIN', doc.buyerGstin || org.gstin || ''],
    ['Contact Person', doc.buyerContactPerson || ''],
    ['Mobile', doc.buyerMobile || ''],
    ['Email', doc.buyerEmail || org.email || ''],
    ['', ''],
  ];
  const vendor = [
    ['Vendor Name', doc.recipientName || doc.vendorName || ''],
    ['Vendor Code', doc.vendorCode || ''],
    ['Vendor Address', doc.placeOfSupply || doc.vendorAddress || ''],
    ['GSTIN', doc.recipientGstin || doc.vendorGstin || ''],
    ['Contact Person', doc.contactPerson || ''],
    ['Mobile', doc.vendorMobile || ''],
    ['Email', doc.contactEmail || ''],
  ];

  let ly = y + headH;
  for (let i = 0; i < rows; i += 1) {
    if (buyer[i][0]) labeledField(pdf, buyer[i][0], buyer[i][1], x, ly, half, rowH);
    else box(pdf, x, ly, half, rowH);
    labeledField(pdf, vendor[i][0], vendor[i][1], x + half, ly, half, rowH);
    ly += rowH;
  }
  return y + headH + bodyH;
}

function drawDeliveryBilling(pdf, doc, org, x, y, w) {
  const half = w / 2;
  const headH = 12;
  const rows = 5;
  const rowH = 11;
  const bodyH = rows * rowH;
  box(pdf, x, y, half, headH + bodyH);
  box(pdf, x + half, y, half, headH + bodyH);
  sectionHead(pdf, 'DELIVERY DETAILS', x, y, half, headH);
  sectionHead(pdf, 'BILLING DETAILS', x + half, y, half, headH);

  const delivery = [
    ['Delivery Address', doc.deliveryAddress || ''],
    ['Delivery Contact', doc.deliveryContact || ''],
    ['Mobile', doc.deliveryMobile || ''],
    ['Expected Delivery Date', formatDisplayDateErp(doc.dueDate || doc.expectedDeliveryDate) || ''],
    ['Delivery Instructions', doc.deliveryInstructions || ''],
  ];
  const billing = [
    [
      'Billing Address',
      doc.billingAddress ||
        [org.legalName || 'Tylo Care Private Limited', org.registeredOffice || ''].filter(Boolean).join(', '),
    ],
    ['GSTIN', doc.billingGstin || org.gstin || ''],
    ['State', doc.billingState || org.state || ''],
    ['State Code', doc.billingStateCode || org.stateCode || ''],
    [
      'Place of Supply',
      doc.billingPlaceOfSupply ||
        [
          doc.billingState || org.state,
          doc.billingStateCode || org.stateCode
            ? `(${doc.billingStateCode || org.stateCode})`
            : null,
        ]
          .filter(Boolean)
          .join(' '),
    ],
  ];

  let ly = y + headH;
  for (let i = 0; i < rows; i += 1) {
    labeledField(pdf, delivery[i][0], delivery[i][1], x, ly, half, rowH);
    labeledField(pdf, billing[i][0], billing[i][1], x + half, ly, half, rowH);
    ly += rowH;
  }
  return y + headH + bodyH;
}

function drawCommercial(pdf, doc, x, y, w) {
  const headH = 12;
  y = sectionHead(pdf, 'COMMERCIAL DETAILS', x, y, w, headH);
  const col = w / 3;
  const rowH = 12;
  const cells = [
    ['Payment Terms', doc.paymentTerms || ''],
    ['Freight', doc.freight || ''],
    ['Insurance', doc.insurance || ''],
    ['Delivery Terms', doc.deliveryTerms || ''],
    ['Warranty', doc.warranty || ''],
    ['Validity', doc.validity || ''],
  ];
  let cy = y;
  for (let r = 0; r < 2; r += 1) {
    for (let c = 0; c < 3; c += 1) {
      const [label, value] = cells[r * 3 + c];
      const cx = x + c * col;
      box(pdf, cx, cy, col, rowH);
      cell(pdf, label, cx, cy, col, 5.5, { size: 5.6, bold: true, color: MUTED });
      cell(pdf, value, cx, cy + 5.5, col, 6.5, { size: 6.8 });
    }
    cy += rowH;
  }
  return cy;
}

function lineGstPct(line) {
  const igst = toAmount(line.igstRate);
  if (igst > 0) return igst;
  return toAmount(line.cgstRate) + toAmount(line.sgstRate);
}

function lineGstAmt(line) {
  return toAmount(line.igstAmount) + toAmount(line.cgstAmount) + toAmount(line.sgstAmount);
}

function drawItems(pdf, doc, x, y, w) {
  const headH = 12;
  y = sectionHead(pdf, 'ITEM DETAILS', x, y, w, headH);

  const cols = [
    { key: 'sr', label: 'Sr', width: 18 },
    { key: 'desc', label: 'Item Description', width: 0 },
    { key: 'make', label: 'Make', width: 36 },
    { key: 'model', label: 'Model', width: 36 },
    { key: 'qty', label: 'Qty', width: 26 },
    { key: 'unit', label: 'Unit', width: 28 },
    { key: 'rate', label: 'Unit Rate (₹)', width: 48 },
    { key: 'disc', label: 'Discount (₹)', width: 44 },
    { key: 'taxable', label: 'Taxable Value (₹)', width: 52 },
    { key: 'gstPct', label: 'GST %', width: 28 },
    { key: 'gstAmt', label: 'GST Amount (₹)', width: 48 },
    { key: 'total', label: 'Total Amount (₹)', width: 52 },
  ];
  const fixed = cols.reduce((s, c) => s + c.width, 0);
  cols.find((c) => c.key === 'desc').width = w - fixed;

  const rowH = 11;
  let cx = x;
  for (const col of cols) {
    box(pdf, cx, y, col.width, rowH, GRAY);
    cell(pdf, col.label, cx, y, col.width, rowH, { bold: true, size: 5, align: 'center', padY: 2 });
    cx += col.width;
  }
  y += rowH;

  const raw = Array.isArray(doc.lineItems) ? doc.lineItems : [];
  const lines = [];
  for (let i = 0; i < 7; i += 1) lines.push(raw[i] || {});

  lines.forEach((line, idx) => {
    const taxable = toAmount(line.taxableAmount ?? line.amount);
    const gstPct = lineGstPct(line);
    const gstAmt = lineGstAmt(line);
    const total = toAmount(line.totalAmount) || taxable + gstAmt;
    const values = {
      sr: String(idx + 1),
      desc: line.description || '',
      make: line.make || '',
      model: line.model || '',
      qty: line.qty != null && line.qty !== '' ? String(line.qty) : '',
      unit: line.unit || line.uom || '',
      rate: line.rate != null && line.rate !== '' ? moneyPlain(line.rate) : '',
      disc: line.discount != null && line.discount !== '' ? moneyPlain(line.discount) : '',
      taxable: line.description ? moneyPlain(taxable) : '',
      gstPct: line.description ? String(gstPct) : '',
      gstAmt: line.description ? moneyPlain(gstAmt) : '',
      total: line.description ? moneyPlain(total) : '',
    };
    cx = x;
    for (const col of cols) {
      box(pdf, cx, y, col.width, rowH);
      const align = ['sr', 'qty', 'unit', 'gstPct'].includes(col.key)
        ? 'center'
        : ['rate', 'disc', 'taxable', 'gstAmt', 'total'].includes(col.key)
          ? 'right'
          : 'left';
      cell(pdf, values[col.key], cx, y, col.width, rowH, { size: 5.8, align, padY: 2 });
      cx += col.width;
    }
    y += rowH;
  });
  return y;
}

function drawTotals(pdf, doc, x, y, w) {
  const rowH = 11;
  const labelW = 110;
  const valueW = 70;
  const totalX = x + w - labelW - valueW;
  const rows = [
    ['Taxable Value', moneyPlain(doc.subtotal)],
    ['Total GST', moneyPlain(doc.taxAmount)],
    ['Round Off', moneyPlain(doc.roundOff || 0)],
    ['GRAND TOTAL', moneyPlain(doc.grandTotal), true],
  ];
  for (const [label, value, strong] of rows) {
    box(pdf, totalX, y, labelW, rowH, strong ? GRAY : null);
    box(pdf, totalX + labelW, y, valueW, rowH, strong ? GRAY : null);
    cell(pdf, label, totalX, y, labelW, rowH, { size: 6.5, bold: Boolean(strong), padY: 2 });
    cell(pdf, value, totalX + labelW, y, valueW, rowH, {
      size: 6.5,
      bold: Boolean(strong),
      align: 'right',
      padY: 2,
    });
    y += rowH;
  }
  return y;
}

function drawAmountWords(pdf, doc, x, y, w) {
  const h = 15;
  box(pdf, x, y, w, h);
  const words = doc.amountInWords || amountInWordsIndian(doc.grandTotal);
  cell(pdf, `Amount In Words: Rupees ${words || '____________________ Only.'}`, x, y, w, h, {
    size: 7,
    bold: true,
    padY: 3,
  });
  return y + h;
}

function drawSignatory(pdf, org, x, y, w) {
  const boxW = 170;
  const sx = x + w - boxW;
  pdf.font('Helvetica').fontSize(7).fillColor(INK).text(`For ${org.legalName || 'Tylo Care Private Limited'}`, sx, y, {
    width: boxW,
    align: 'center',
  });
  pdf
    .moveTo(sx + 16, y + 24)
    .lineTo(sx + boxW - 16, y + 24)
    .strokeColor(LINE)
    .lineWidth(0.55)
    .stroke();
  pdf.font('Helvetica').fontSize(7).fillColor(INK).text('Authorised Signatory', sx, y + 27, {
    width: boxW,
    align: 'center',
  });
}

export function buildPurchaseOrderTemplatePdf(docRow, orgProfile) {
  const org = orgProfile || {};
  const doc = {
    ...docRow,
    amountInWords: docRow.amountInWords || amountInWordsIndian(docRow.grandTotal),
  };

  return new Promise((resolve, reject) => {
    const pdf = new PDFDocument({
      size: [PAGE.width, PAGE.height],
      margin: 0,
      info: { Title: `Purchase Order ${doc.documentNumber || ''}`.trim(), Author: org.legalName || 'Tylo Care' },
    });
    const chunks = [];
    pdf.on('data', (c) => chunks.push(c));
    pdf.on('end', () => resolve(Buffer.concat(chunks)));
    pdf.on('error', reject);

    const x = PAGE.margin;
    let y = PAGE.margin;
    const w = contentW();

    y = drawHeader(pdf, org, x, y, w);
    y = drawMeta(pdf, doc, x, y, w);
    y = drawBuyerVendor(pdf, doc, org, x, y, w);
    y = drawDeliveryBilling(pdf, doc, org, x, y, w);
    y = drawCommercial(pdf, doc, x, y, w);
    y = drawItems(pdf, doc, x, y, w);
    y = drawTotals(pdf, doc, x, y + 2, w);
    y = drawAmountWords(pdf, doc, x, y + 2, w);
    drawSignatory(pdf, org, x, y + 6, w);

    pdf
      .rect(PAGE.margin - 2, PAGE.margin - 2, w + 4, PAGE.height - PAGE.margin * 2 + 4)
      .strokeColor(BRAND.line)
      .lineWidth(0.35)
      .stroke();

    pdf.end();
  });
}

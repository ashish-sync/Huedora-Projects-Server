/**
 * A4 Landscape Delivery Challan PDF — logistics / non-sale movement template.
 */
import PDFDocument from 'pdfkit';
import { formatDisplayDateErp } from './financeCommercial.service.js';
import { BRAND, resolveLogoPath } from './pdfBrand.js';
import { formatCompanyLetterhead, drawCompanyLetterheadLine1 } from './companyLetterhead.js';

const PAGE = { width: 841.89, height: 595.28, margin: 22 };
const GRAY = '#E5E7EB';
const INK = '#111827';
const MUTED = '#4B5563';
const LINE = '#111827';

const DECLARATION =
  'The goods covered under this Delivery Challan are being transported for reasons other than sale and do not constitute a taxable supply under the applicable provisions of the CGST Act, 2017. This Delivery Challan is issued solely for the movement, tracking and acknowledgement of goods.';

function contentW() {
  return PAGE.width - PAGE.margin * 2;
}

function box(pdf, x, y, w, h, fill = null) {
  if (fill) pdf.save().rect(x, y, w, h).fill(fill).restore();
  pdf.rect(x, y, w, h).strokeColor(LINE).lineWidth(0.65).stroke();
}

function cell(pdf, text, x, y, w, h, opts = {}) {
  const { align = 'left', bold = false, size = 7.5, color = INK, padX = 3, padY = 2 } = opts;
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

function sectionHead(pdf, title, x, y, w, h = 14) {
  box(pdf, x, y, w, h, GRAY);
  cell(pdf, title, x, y, w, h, { bold: true, size: 8, align: 'center', padY: 3 });
  return y + h;
}

function labeledRows(pdf, rows, x, y, w, rowH = 14) {
  let cy = y;
  for (const [label, value] of rows) {
    box(pdf, x, cy, w, rowH);
    cell(pdf, label, x, cy, w * 0.38, rowH, { bold: true, size: 5.8, color: MUTED });
    cell(pdf, value || '', x + w * 0.38, cy, w * 0.62, rowH, { size: 6.8 });
    cy += rowH;
  }
  return cy;
}

function drawHeader(pdf, org, x, y, w) {
  const logoPath = resolveLogoPath();
  const logoW = 70;
  const titleW = 140;
  const midX = x + logoW + 8;
  const midW = Math.max(80, w - logoW - titleW - 16);

  if (logoPath) {
    try {
      pdf.image(logoPath, x, y, { fit: [logoW, 34], align: 'left', valign: 'center' });
    } catch {
      pdf.font('Helvetica-Bold').fontSize(15).fillColor(INK).text('TYLO', x, y + 2);
      pdf.font('Helvetica').fontSize(6.5).fillColor(MUTED).text(org.brandLine || '', x, y + 20, {
        width: logoW,
      });
    }
  } else {
    pdf.font('Helvetica-Bold').fontSize(15).fillColor(INK).text('TYLO', x, y + 2);
    pdf.font('Helvetica').fontSize(6.5).fillColor(MUTED).text(org.brandLine || '', x, y + 20, {
      width: logoW,
    });
  }

  const letterhead = formatCompanyLetterhead(org);
  let ty = drawCompanyLetterheadLine1(pdf, letterhead, midX, y, midW, {
    size: 8.5,
    align: 'center',
    ink: INK,
    muted: MUTED,
  });
  if (letterhead.line2) {
    pdf.font('Helvetica').fontSize(6.5).fillColor(MUTED);
    pdf.text(letterhead.line2, midX, ty, { width: midW, align: 'center' });
    ty = pdf.y + 1;
  }

  pdf.font('Helvetica-Bold').fontSize(13).fillColor(INK).text('DELIVERY CHALLAN', x + w - titleW, y + 8, {
    width: titleW,
    align: 'right',
  });
  return y + 34;
}

function drawMeta(pdf, doc, x, y, w) {
  const col = w / 2;
  const rowH = 14;
  const cells = [
    ['Delivery Challan No.', doc.documentNumber || ''],
    ['Delivery Challan Date', formatDisplayDateErp(doc.documentDate) || ''],
    ['Dispatch Date', formatDisplayDateErp(doc.dispatchDate) || ''],
    ['Expected Delivery Date', formatDisplayDateErp(doc.expectedDeliveryDate || doc.dueDate) || ''],
  ];
  let cy = y;
  for (let r = 0; r < 2; r += 1) {
    for (let c = 0; c < 2; c += 1) {
      const [label, value] = cells[r * 2 + c];
      const cx = x + c * col;
      box(pdf, cx, cy, col, rowH);
      cell(pdf, label, cx, cy, col, 7, { size: 6, bold: true, color: MUTED });
      cell(pdf, value, cx, cy + 6, col, 8, { size: 7.5, bold: true });
    }
    cy += rowH;
  }
  return cy;
}

function drawParties(pdf, doc, org, x, y, w) {
  const half = w / 2;
  const headH = 12;
  const bodyH = 72;
  box(pdf, x, y, half, headH + bodyH);
  box(pdf, x + half, y, half, headH + bodyH);
  sectionHead(pdf, 'FROM', x, y, half, headH);
  sectionHead(pdf, 'DELIVER TO', x + half, y, half, headH);

  const fromRows = [
    ['Company Name', org.legalName || ''],
    ['Registered Office', org.registeredOffice || ''],
    ['GSTIN', org.gstin || ''],
    ['Contact Person', doc.fromContactPerson || ''],
    ['Mobile', org.phone || ''],
    ['Email', org.email || ''],
  ];
  const toRows = [
    ['Recipient Type', doc.recipientType || ''],
    ['Name', doc.recipientName || ''],
    ['Company (if applicable)', doc.deliverToCompany || ''],
    ['Contact Person', doc.contactPerson || ''],
    ['Mobile', doc.deliverToMobile || ''],
    ['Address', doc.deliveryAddress || doc.shipToAddress || ''],
  ];

  let ly = y + headH;
  let ry = y + headH;
  const rowH = bodyH / 6;
  for (let i = 0; i < 6; i += 1) {
    box(pdf, x, ly, half, rowH);
    cell(pdf, fromRows[i][0], x, ly, half * 0.4, rowH, { size: 5.8, bold: true, color: MUTED });
    cell(pdf, fromRows[i][1], x + half * 0.4, ly, half * 0.6, rowH, { size: 6.8 });
    box(pdf, x + half, ry, half, rowH);
    cell(pdf, toRows[i][0], x + half, ry, half * 0.42, rowH, { size: 5.8, bold: true, color: MUTED });
    cell(pdf, toRows[i][1], x + half + half * 0.42, ry, half * 0.58, rowH, { size: 6.8 });
    ly += rowH;
    ry += rowH;
  }
  return y + headH + bodyH;
}

function drawCourierPurpose(pdf, doc, x, y, w) {
  const half = w / 2;
  const headH = 12;
  const bodyH = 66;
  box(pdf, x, y, half, headH + bodyH);
  box(pdf, x + half, y, half, headH + bodyH);
  sectionHead(pdf, 'COURIER DETAILS', x, y, half, headH);
  sectionHead(pdf, 'PURPOSE OF MOVEMENT', x + half, y, half, headH);

  const courierRows = [
    ['Courier Name', doc.courierName || doc.transporterName || ''],
    ['AWB / Consignment No.', doc.awbNo || ''],
    ['Mode (Air / Surface)', doc.courierMode || ''],
    ['No. of Packages', doc.packageCount != null ? String(doc.packageCount) : ''],
    ['Origin / Dispatch City', doc.originCity || ''],
    ['Destination City', doc.destinationCity || ''],
  ];
  labeledRows(pdf, courierRows, x, y + headH, half, bodyH / 6);
  box(pdf, x + half, y + headH, half, bodyH);
  cell(pdf, doc.purposeOfMovement || doc.projectName || '', x + half, y + headH, half, bodyH, {
    size: 7.2,
    padX: 5,
    padY: 4,
  });
  return y + headH + bodyH;
}

function drawItems(pdf, doc, x, y, w) {
  const headH = 12;
  y = sectionHead(pdf, 'ITEM DETAILS', x, y, w, headH);

  const cols = [
    { key: 'sr', label: 'Sr', width: 22 },
    { key: 'assetId', label: 'Asset ID', width: 48 },
    { key: 'desc', label: 'Description', width: 0 },
    { key: 'make', label: 'Make', width: 42 },
    { key: 'model', label: 'Model', width: 42 },
    { key: 'serial', label: 'Manufacturer Serial No.', width: 70 },
    { key: 'qty', label: 'Qty', width: 28 },
    { key: 'acc', label: 'Accessories Supplied', width: 62 },
    { key: 'cond', label: 'Condition', width: 48 },
    { key: 'remarks', label: 'Remarks', width: 48 },
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
  for (let i = 0; i < 8; i += 1) lines.push(raw[i] || {});

  lines.forEach((line, idx) => {
    const values = {
      sr: String(idx + 1),
      assetId: line.assetId || '',
      desc: line.description || '',
      make: line.make || '',
      model: line.model || '',
      serial: line.manufacturerSerialNo || line.serialNo || '',
      qty: line.qty != null && line.qty !== '' ? String(line.qty) : '',
      acc: line.accessories || '',
      cond: line.condition || '',
      remarks: line.remarks || '',
    };
    cx = x;
    for (const col of cols) {
      box(pdf, cx, y, col.width, rowH);
      cell(pdf, values[col.key], cx, y, col.width, rowH, {
        size: 6,
        align: col.key === 'sr' || col.key === 'qty' ? 'center' : 'left',
        padY: 2,
      });
      cx += col.width;
    }
    y += rowH;
  });
  return y;
}

function drawDeclaration(pdf, x, y, w) {
  const headH = 12;
  const bodyH = 26;
  y = sectionHead(pdf, 'DECLARATION', x, y, w, headH);
  box(pdf, x, y, w, bodyH);
  cell(pdf, DECLARATION, x, y, w, bodyH, { size: 6.6, padX: 5, padY: 3 });
  return y + bodyH;
}

function drawDispatch(pdf, doc, x, y, w) {
  const headH = 12;
  y = sectionHead(pdf, 'DISPATCH DETAILS', x, y, w, headH);
  const col = w / 3;
  const rowH = 22;
  const labels = ['Packed By', 'Checked By', 'Dispatched By'];
  const values = [doc.packedBy || '', doc.checkedBy || '', doc.dispatchedBy || ''];
  for (let i = 0; i < 3; i += 1) {
    const cx = x + i * col;
    box(pdf, cx, y, col, rowH);
    cell(pdf, labels[i], cx, y, col * 0.55, rowH / 2, { bold: true, size: 6, color: MUTED });
    cell(pdf, values[i], cx + col * 0.55, y, col * 0.45, rowH / 2, { size: 6.5 });
    cell(pdf, 'Signature', cx, y + rowH / 2, col, rowH / 2, { size: 6, color: MUTED });
  }
  return y + rowH;
}

function drawAck(pdf, doc, x, y, w) {
  const headH = 12;
  y = sectionHead(pdf, 'RECEIVER ACKNOWLEDGEMENT', x, y, w, headH);
  const leftW = w * 0.72;
  const rightW = w - leftW;
  const rowH = 15;
  const h = rowH * 2;

  box(pdf, x, y, leftW / 2, rowH);
  cell(pdf, 'Received By', x, y, leftW / 2 * 0.4, rowH, { bold: true, size: 6, color: MUTED });
  cell(pdf, doc.receivedBy || '', x + leftW / 2 * 0.4, y, leftW / 2 * 0.6, rowH, { size: 6.8 });

  box(pdf, x + leftW / 2, y, leftW / 2, rowH);
  cell(pdf, 'Mobile', x + leftW / 2, y, leftW / 2 * 0.35, rowH, { bold: true, size: 6, color: MUTED });
  cell(pdf, doc.receivedMobile || '', x + leftW / 2 + leftW / 2 * 0.35, y, leftW / 2 * 0.65, rowH, { size: 6.8 });

  box(pdf, x, y + rowH, leftW / 2, rowH);
  cell(pdf, 'Condition on Receipt', x, y + rowH, leftW / 2 * 0.5, rowH, { bold: true, size: 5.8, color: MUTED });
  cell(pdf, doc.conditionOnReceipt || '', x + leftW / 2 * 0.5, y + rowH, leftW / 2 * 0.5, rowH, { size: 6.8 });

  box(pdf, x + leftW / 2, y + rowH, leftW / 2, rowH);
  cell(pdf, 'Date', x + leftW / 2, y + rowH, leftW / 2 * 0.35, rowH, { bold: true, size: 6, color: MUTED });
  cell(
    pdf,
    formatDisplayDateErp(doc.receivedDate) || '',
    x + leftW / 2 + leftW / 2 * 0.35,
    y + rowH,
    leftW / 2 * 0.65,
    rowH,
    { size: 6.8 }
  );

  box(pdf, x + leftW, y, rightW, h);
  cell(pdf, 'QR CODE\n(Future Use)', x + leftW, y, rightW, h, { align: 'center', size: 7.5, bold: true, padY: 8 });
  return y + h;
}

export function buildDeliveryChallanTemplatePdf(docRow, orgProfile) {
  const org = orgProfile || {};
  const doc = { ...docRow };

  return new Promise((resolve, reject) => {
    const pdf = new PDFDocument({
      size: [PAGE.width, PAGE.height],
      margin: 0,
      info: { Title: `Delivery Challan ${doc.documentNumber || ''}`.trim(), Author: org.legalName || 'Tylo Care' },
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
    y = drawParties(pdf, doc, org, x, y, w);
    y = drawCourierPurpose(pdf, doc, x, y, w);
    y = drawItems(pdf, doc, x, y, w);
    y = drawDeclaration(pdf, x, y, w);
    y = drawDispatch(pdf, doc, x, y, w);
    drawAck(pdf, doc, x, y, w);

    pdf
      .rect(PAGE.margin - 3, PAGE.margin - 3, w + 6, PAGE.height - PAGE.margin * 2 + 6)
      .strokeColor(BRAND.line)
      .lineWidth(0.4)
      .stroke();

    pdf.end();
  });
}

export { DECLARATION as DELIVERY_CHALLAN_DECLARATION };

import path from 'path';
import { randomBytes } from 'crypto';
import { AppError } from '../../utils/helpers.js';
import { uploadDir } from '../../config/paths.js';
import { pipeUploadToResponse } from '../../storage/serveUpload.js';
import { FinanceCommercialDocument } from '../finance/finance.model.js';
import {
  getOrCreateOrgProfile,
  orgSourceForDocument,
  resolveOrgProfileId,
  usesIgst,
} from '../finance/financeCommercial.service.js';
import { buildClientInvoicePdfBuffer } from '../finance/clientInvoicePdf.js';
import { CampOpsClientMaster } from '../campOps/campOps.model.js';
import { createOrRefreshProgramRequestLink } from '../campOps/campRequestForm.service.js';
import {
  computeClientOneKpis,
  loadClientMasterOrThrow,
  loadScopedCamps,
  toClientOneCampDto,
} from './clientOne.service.js';

const campUploadRoot = uploadDir('camp-ops');
const financeUploadRoot = uploadDir('finance');

const ISSUED_INVOICE_STATUSES = new Set([
  'Issued',
  'Approved',
  'Paid',
  'Partially Paid',
  'PartiallyPaid',
]);

function trimStr(value) {
  return String(value || '').trim();
}

function newFileId() {
  return `f-${randomBytes(6).toString('hex')}`;
}

function newPoId() {
  return `po-${randomBytes(5).toString('hex')}`;
}

function calendarBucket(status, campDate, today) {
  const st = String(status || '').toLowerCase();
  if (st === 'cancelled' || st === 'rejected') return 'cancelled';
  if (st === 'executed') return 'completed';
  const date = String(campDate || '').slice(0, 10);
  if (date && date < today) return 'completed';
  return 'upcoming';
}

export async function buildClientOneCalendar(access, { from, to, now = new Date() } = {}) {
  const camps = await loadScopedCamps(access, { from, to });
  const today = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}-${String(now.getUTCDate()).padStart(2, '0')}`;
  const events = camps
    .map((raw) => {
      const dto = toClientOneCampDto(raw);
      return {
        ...dto,
        bucket: calendarBucket(dto.status, dto.campDate, today),
      };
    })
    .sort((a, b) => String(a.campDate || '').localeCompare(String(b.campDate || '')));

  const byDate = {};
  for (const ev of events) {
    const key = String(ev.campDate || '').slice(0, 10) || 'unknown';
    if (!byDate[key]) byDate[key] = [];
    byDate[key].push(ev);
  }
  return { from: from || null, to: to || null, events, byDate };
}

export function toClientOneInvoiceDto(row) {
  if (!row) return null;
  const doc = typeof row.toObject === 'function' ? row.toObject() : { ...row };
  return {
    _id: doc._id,
    documentType: doc.documentType || 'client_invoice',
    documentNumber: doc.documentNumber || doc.docKey || '',
    status: doc.status || '',
    documentDate: doc.documentDate || '',
    dueDate: doc.dueDate || '',
    recipientName: doc.recipientName || '',
    projectName: doc.projectName || '',
    servicePeriod: doc.servicePeriod || '',
    grandTotal: doc.grandTotal ?? null,
    currency: 'INR',
  };
}

export async function listClientOneInvoices(access) {
  const masterId = access.clientMasterId;
  const filter = {
    isDeleted: false,
    documentType: 'client_invoice',
    clientMasterId: masterId,
  };
  const rows = await FinanceCommercialDocument.find(filter);
  const list = (Array.isArray(rows) ? rows : [])
    .filter((row) => ISSUED_INVOICE_STATUSES.has(String(row.status || '').trim())
      || String(row.status || '').toLowerCase() === 'issued')
    .map(toClientOneInvoiceDto)
    .sort((a, b) => String(b.documentDate || '').localeCompare(String(a.documentDate || '')));
  return list;
}

export async function findScopedInvoiceOrThrow(access, invoiceId) {
  const row = await FinanceCommercialDocument.findOne({
    _id: invoiceId,
    isDeleted: false,
    documentType: 'client_invoice',
    clientMasterId: access.clientMasterId,
  });
  if (!row) throw new AppError('Invoice not found', 404, 'NOT_FOUND');
  const status = String(row.status || '').trim();
  if (!ISSUED_INVOICE_STATUSES.has(status) && status.toLowerCase() !== 'issued') {
    throw new AppError('Invoice is not available', 404, 'NOT_FOUND');
  }
  return row;
}

export async function sendClientOneInvoicePdf(res, access, invoiceId, { download = false } = {}) {
  const row = await findScopedInvoiceOrThrow(access, invoiceId);
  if (row.source === 'uploaded' && row.storageKey) {
    const filePath = path.join(financeUploadRoot, row.storageKey);
    res.setHeader('Content-Type', row.uploadedMimeType || 'application/pdf');
    res.setHeader(
      'Content-Disposition',
      `${download ? 'attachment' : 'inline'}; filename="${(row.uploadedFileName || row.documentNumber || 'invoice').replace(/[^\w.-]+/g, '_')}.pdf"`,
    );
    await pipeUploadToResponse(res, filePath, { contentType: row.uploadedMimeType || 'application/pdf' });
    return;
  }

  const live = row.orgProfileId
    ? await resolveOrgProfileId(row.orgProfileId)
    : await getOrCreateOrgProfile();
  const renderOrg = orgSourceForDocument(row, live);
  const docObj = row.toObject ? row.toObject() : { ...row };
  docObj.taxMode = usesIgst(docObj.recipientStateCode, renderOrg.stateCode) ? 'igst' : 'cgst_sgst';
  const pdfBuffer = await buildClientInvoicePdfBuffer(docObj, renderOrg);
  const safeName = (row.documentNumber || row.docKey || 'invoice').replace(/[^\w./-]+/g, '_');
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader(
    'Content-Disposition',
    `${download ? 'attachment' : 'inline'}; filename="${safeName}.pdf"`,
  );
  res.send(pdfBuffer);
}

function mapFileMeta(file, kind, extra = {}) {
  if (!file?.storedName && !file?.id) return null;
  return {
    id: file.id || file.storedName,
    fileName: file.fileName || file.storedName || 'file',
    mimeType: file.mimeType || 'application/octet-stream',
    fileSize: file.fileSize || 0,
    uploadedAt: file.uploadedAt || '',
    kind,
    ...extra,
  };
}

export async function listClientOneAnnexures(access) {
  const master = await loadClientMasterOrThrow(access.clientMasterId);
  const terms = Array.isArray(master.campTermsFiles) ? master.campTermsFiles : [];
  const fromTerms = terms
    .map((f) => mapFileMeta(f, 'programme', { label: 'Programme annexure' }))
    .filter(Boolean);

  const invoices = await listClientOneInvoices(access);
  const fromInvoices = invoices.map((inv) => ({
    id: `invoice-${inv._id}`,
    fileName: `${inv.documentNumber || 'Invoice'}.pdf`,
    mimeType: 'application/pdf',
    fileSize: 0,
    uploadedAt: inv.documentDate || '',
    kind: 'invoice',
    label: 'Invoice-linked',
    invoiceId: inv._id,
    documentNumber: inv.documentNumber,
  }));

  return [...fromTerms, ...fromInvoices];
}

export async function sendClientOneAnnexure(res, access, annexureId, { download = false } = {}) {
  const id = trimStr(annexureId);
  if (id.startsWith('invoice-')) {
    return sendClientOneInvoicePdf(res, access, id.slice('invoice-'.length), { download: true });
  }
  const master = await loadClientMasterOrThrow(access.clientMasterId);
  const terms = Array.isArray(master.campTermsFiles) ? master.campTermsFiles : [];
  const doc = terms.find((f) => String(f.id) === id || String(f.storedName) === id);
  if (!doc?.storedName) throw new AppError('Annexure not found', 404, 'NOT_FOUND');
  const full = path.join(campUploadRoot, doc.storedName);
  res.setHeader('Content-Type', doc.mimeType || 'application/octet-stream');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader(
    'Content-Disposition',
    `${download ? 'attachment' : 'inline'}; filename="${String(doc.fileName || doc.storedName).replace(/"/g, '')}"`,
  );
  await pipeUploadToResponse(res, full, { contentType: doc.mimeType });
}

export async function buildClientOneMis(access, { from, to } = {}) {
  const camps = await loadScopedCamps(access, { from, to });
  const kpis = computeClientOneKpis(camps, { from, to });
  const rows = camps.map(toClientOneCampDto);
  return {
    client: {
      name: access.clientName,
      programName: access.programName,
      campName: access.campName,
    },
    from: from || null,
    to: to || null,
    kpis,
    camps: rows,
  };
}

export function misToCsv(payload) {
  const lines = [];
  lines.push('Client One MIS');
  lines.push(`Client,${csvEscape(payload.client?.name)}`);
  lines.push(`Programme,${csvEscape(payload.client?.programName)}`);
  lines.push(`Method,${csvEscape(payload.client?.campName)}`);
  lines.push(`From,${csvEscape(payload.from)}`);
  lines.push(`To,${csvEscape(payload.to)}`);
  lines.push('');
  lines.push('Metric,Value');
  const k = payload.kpis || {};
  for (const [label, value] of [
    ['Total camps', k.total],
    ['Approved', k.approved],
    ['Executed', k.executed],
    ['Cancelled', k.cancelled],
    ['Pending', k.pending],
    ['Upcoming 7 days', k.upcoming7Days],
    ['Completion %', k.executionCompletionPct],
    ['Chargeable', k.chargeable],
    ['Non-chargeable', k.nonChargeable],
  ]) {
    lines.push(`${csvEscape(label)},${csvEscape(value)}`);
  }
  lines.push('');
  lines.push('Camp ID,Date,Status,Assignment,Execution,HCW,City,Chargeable');
  for (const row of payload.camps || []) {
    lines.push([
      row.campId,
      row.campDate,
      row.status,
      row.assignmentStatus,
      row.executionStatus || row.effectiveExecutionStatus,
      row.hcwName,
      row.city,
      row.chargeableStatus,
    ].map(csvEscape).join(','));
  }
  return `${lines.join('\n')}\n`;
}

function csvEscape(value) {
  const s = value == null ? '' : String(value);
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

export async function getClientOneCampRequestLink(access, { rotate = false } = {}) {
  const master = await loadClientMasterOrThrow(access.clientMasterId);
  const link = await createOrRefreshProgramRequestLink(master, {
    id: `client-one:${access.accessId}`,
    email: `client-one:${access.accessId}`,
  }, { replace: rotate === true });
  return {
    url: link.url,
    path: link.path,
    createdAt: link.createdAt || '',
    reused: Boolean(link.reused),
    replaced: Boolean(link.replaced),
    programName: access.programName,
    campName: access.campName,
  };
}

function ensurePoFiles(entry) {
  if (!entry) return [];
  if (!Array.isArray(entry.files)) {
    entry.files = entry.poFile?.storedName ? [{ ...entry.poFile, id: entry.poFile.id || newFileId() }] : [];
  }
  return entry.files;
}

function ensurePurchaseOrders(master) {
  if (!Array.isArray(master.purchaseOrders) || !master.purchaseOrders.length) {
    if (master.poFile?.storedName || master.poNumber) {
      master.purchaseOrders = [{
        id: newPoId(),
        poNumber: master.poNumber || '',
        poNetValue: master.poNetValue ?? 0,
        poApplyGst18: Boolean(master.poApplyGst18),
        poGstAmount: master.poGstAmount ?? 0,
        poGrossValue: master.poGrossValue ?? 0,
        poIssueDate: master.poIssueDate || '',
        poExpiryDate: master.poExpiryDate || '',
        files: master.poFile ? [master.poFile] : [],
        poFile: master.poFile || null,
      }];
    } else {
      master.purchaseOrders = [];
    }
  }
  return master.purchaseOrders;
}

export function toClientOnePoDto(po) {
  if (!po) return null;
  const files = ensurePoFiles(po).map((f) => mapFileMeta(f, 'po', { poId: po.id })).filter(Boolean);
  return {
    id: po.id,
    poNumber: po.poNumber || '',
    poIssueDate: po.poIssueDate || '',
    poExpiryDate: po.poExpiryDate || '',
    fileCount: files.length,
    files,
  };
}

export async function listClientOnePurchaseOrders(access) {
  const master = await CampOpsClientMaster.findOne({ _id: access.clientMasterId, isDeleted: false });
  if (!master) throw new AppError('Client master not found', 404, 'NOT_FOUND');
  const orders = ensurePurchaseOrders(master);
  return orders.map(toClientOnePoDto).filter(Boolean);
}

export async function appendClientOnePoFiles(access, uploaded = [], poId = '') {
  if (!uploaded.length) throw new AppError('PO file is required', 400, 'VALIDATION_ERROR');
  const master = await CampOpsClientMaster.findOne({ _id: access.clientMasterId, isDeleted: false });
  if (!master) throw new AppError('Client master not found', 404, 'NOT_FOUND');
  const orders = ensurePurchaseOrders(master);
  let entry = poId ? orders.find((po) => String(po.id) === String(poId)) : orders[0];
  if (!entry) {
    entry = {
      id: poId || newPoId(),
      poNumber: '',
      poNetValue: 0,
      poApplyGst18: false,
      poGstAmount: 0,
      poGrossValue: 0,
      poIssueDate: '',
      poExpiryDate: '',
      files: [],
      poFile: null,
    };
    orders.push(entry);
  }
  const files = ensurePoFiles(entry);
  for (const file of uploaded) {
    files.push({
      id: newFileId(),
      fileName: file.originalname || file.filename,
      storedName: file.filename,
      mimeType: file.mimetype || 'application/octet-stream',
      fileSize: file.size || 0,
      url: `/uploads/camp-ops/${file.filename}`,
      uploadedAt: new Date().toISOString(),
    });
  }
  entry.files = files;
  entry.poFile = files[0] || null;
  master.purchaseOrders = orders;
  master.poFile = entry.poFile;
  if (!master.campTerms || master.campTerms === 'none') master.campTerms = 'po_based';
  master.updatedById = `client-one:${access.accessId}`;
  await master.save();
  return orders.map(toClientOnePoDto);
}

export async function sendClientOnePoFile(res, access, poId, fileId) {
  const master = await loadClientMasterOrThrow(access.clientMasterId);
  const orders = ensurePurchaseOrders(master);
  const entry = orders.find((po) => String(po.id) === String(poId)) || orders[0];
  if (!entry) throw new AppError('Purchase order not found', 404, 'NOT_FOUND');
  const files = ensurePoFiles(entry);
  const doc = fileId
    ? files.find((f) => String(f.id) === String(fileId) || String(f.storedName) === String(fileId))
    : files[0] || entry.poFile;
  if (!doc?.storedName) throw new AppError('PO file not found', 404, 'NOT_FOUND');
  const full = path.join(campUploadRoot, doc.storedName);
  res.setHeader('Content-Type', doc.mimeType || 'application/octet-stream');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader(
    'Content-Disposition',
    `inline; filename="${String(doc.fileName || doc.storedName).replace(/"/g, '')}"`,
  );
  await pipeUploadToResponse(res, full, { contentType: doc.mimeType });
}

export { campUploadRoot };

import { Router } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { v4 as uuid } from 'uuid';
import { authenticate, requirePermission } from '../../middleware/auth.js';
import { asyncHandler, parsePagination, paginated, AppError } from '../../utils/helpers.js';
import { PERMISSIONS } from '../../config/constants.js';
import { env } from '../../config/env.js';
import { DocumentTemplate } from './template.model.js';
import { SignatureMaster } from '../signatures/signature.model.js';
import {
  analyzeDocx,
  extractPlaceholdersFromText,
  fillDocxBuffer,
  fillTextPlaceholders,
  validatePlaceholderValue,
  writeBuffer,
  ensureDir,
  readDocxBuffer,
  repackDocxDocumentXml,
} from './docxPlaceholders.js';
import { rewriteServiceAgreementLineTableXml } from './serviceAgreementLineTable.js';
import { buildTemplatePdf } from './buildTemplatePdf.js';
import { convertDocxBufferToPdf } from './docxToPdf.js';
import { PdfEngineUnavailableError } from './pdfEngineErrors.js';
import { previewStore } from './previewStore.js';
import { sendExcel, sendCsv } from '../../utils/excelExport.js';
import { cellValue, excelUpload, sampleCsvFilename } from '../../utils/masterExcel.js';
import { importRateLimiter } from '../../middleware/importRateLimit.js';
import { executeUploadedImport } from '../imports/streaming/runStreamingImport.js';
import { uploadDir } from '../../config/paths.js';
import { rejectUnsafeUploadedFiles } from '../../utils/rejectUnsafeUpload.js';

const templateRoot = uploadDir('templates');
const previewRoot = uploadDir('previews');
ensureDir(templateRoot);
ensureDir(previewRoot);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: env.uploadMaxBytes },
});

function sendNativePdf(res, converted, filename = 'preview.pdf') {
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename="${filename}"`);
  res.setHeader('X-PDF-Engine', converted.engine);
  res.send(converted.buffer);
}

function invalidatePrintPreviewCache(docxPath) {
  try {
    fs.unlinkSync(`${docxPath}.print.pdf`);
  } catch {
    /* no cache */
  }
}

async function docxBufferForNativePdf(buffer) {
  const { xml } = await readDocxBuffer(buffer);
  const nextXml = rewriteServiceAgreementLineTableXml(xml);
  if (nextXml === xml) return buffer;
  return repackDocxDocumentXml(buffer, nextXml);
}

const router = Router();
router.use(authenticate);

const canReadTemplates = requirePermission(PERMISSIONS.AGREEMENTS_READ, PERMISSIONS.AGREEMENTS_WRITE);
router.use((req, res, next) => {
  if (req.method !== 'GET') return next();
  return canReadTemplates(req, res, next);
});

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const { page, limit, skip, sort } = parsePagination(req.query);
    const filter = { isDeleted: false };
    if (req.query.all !== 'true') filter.isActive = true;
    if (req.query.category) filter.category = req.query.category;
    if (req.query.agreementType) filter.agreementType = req.query.agreementType;
    if (req.query.q) {
      const q = String(req.query.q);
      filter.$or = [
        { name: new RegExp(q, 'i') },
        { description: new RegExp(q, 'i') },
      ];
    }
    const [data, total] = await Promise.all([
      DocumentTemplate.find(filter).sort(sort || 'name').skip(skip).limit(limit),
      DocumentTemplate.countDocuments(filter),
    ]);
    res.json(paginated(data, total, page, limit));
  })
);

router.get(
  '/export',
  asyncHandler(async (_req, res) => {
    const rows = await DocumentTemplate.find({ isDeleted: false }).sort('name');
    sendExcel(
      res,
      'Document_Master.xlsx',
      [
        'Name of the template',
        'Document type',
        'Signing',
        'Active',
        'Description',
        'File Name',
        'Placeholders',
      ],
      rows.map((t) => [
        t.name,
        t.documentType || t.agreementType || '',
        t.category,
        t.agreementType,
        t.signingType || 'SIGNING',
        t.isActive === false ? 'No' : 'Yes',
        t.description,
        t.originalFileName || '',
        Array.isArray(t.placeholders)
          ? t.placeholders.map((p) => (typeof p === 'string' ? p : p.key || p.label || '')).filter(Boolean).join(', ')
          : '',
      ]),
      { sheetName: 'Document Master' }
    );
  })
);

import { TEMPLATE_HEADERS, TEMPLATE_SAMPLE_ROWS } from './template.excel.js';

router.get(
  '/sample',
  asyncHandler(async (_req, res) => {
    sendCsv(
      res,
      sampleCsvFilename('Document_Master'),
      TEMPLATE_HEADERS,
      TEMPLATE_SAMPLE_ROWS
    );
  })
);

router.post(
  '/import',
  requirePermission(PERMISSIONS.AGREEMENTS_WRITE),
  importRateLimiter,
  excelUpload.single('file'),
  asyncHandler(async (req, res) => {
    const { job, summary } = await executeUploadedImport({
      file: req.file,
      userId: req.user?._id,
      importType: 'DocumentTemplate',
      processRow: async ({ record: row }) => {
        const name = cellValue(row, ['Name of the template', 'Name', 'name']);
        if (!name) return { skipped: true };
        const documentType = cellValue(row, ['Document type', 'Document Type', 'documentType']) || 'LEASE';
        const signingRaw = cellValue(row, ['Signing', 'Signing Mode', 'signingType']).toUpperCase();
        const signingType = signingRaw.includes('NON') ? 'NON_SIGNING' : 'SIGNING';
        const bodyHtml = `Document: ${name}\n\nEdit this template body and add placeholders as needed.`;
        await DocumentTemplate.create({
          name,
          category: 'AGREEMENT',
          agreementType: documentType,
          documentType,
          signingType,
          description: '',
          bodyHtml,
          sourceType: 'TEXT',
          placeholders: extractPlaceholdersFromText(bodyHtml),
          isActive: !['no', 'false', '0', 'inactive'].includes(
            cellValue(row, ['Active', 'isActive']).toLowerCase()
          ),
          createdBy: req.user._id,
        });
        return { ok: true };
      },
    });

    res.json({
      data: {
        jobId: job?._id,
        status: job?.status,
        percent: job?.percent ?? 100,
        totalRows: summary.totalRows,
        created: summary.created,
        updated: 0,
        errorRows: summary.errorRows,
        errors: summary.errors,
      },
    });
  })
);

router.get(
  '/preview/:token.pdf',
  asyncHandler(async (req, res) => {
    const entry = previewStore.get(req.params.token);
    if (!entry || entry.expires < Date.now()) {
      throw new AppError('Preview expired. Fill placeholders again.', 404, 'PREVIEW_EXPIRED');
    }
    if (!fs.existsSync(entry.pdfPath)) throw new AppError('Preview file missing', 404);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'inline; filename="preview.pdf"');
    if (entry.pdfEngine) res.setHeader('X-PDF-Engine', entry.pdfEngine);
    fs.createReadStream(entry.pdfPath).pipe(res);
  })
);

router.get(
  '/preview/:token.docx',
  asyncHandler(async (req, res) => {
    const entry = previewStore.get(req.params.token);
    if (!entry || entry.expires < Date.now()) {
      throw new AppError('Preview expired. Fill placeholders again.', 404, 'PREVIEW_EXPIRED');
    }
    if (!entry.filledDocxKey) throw new AppError('Filled Word file not available', 404);
    const full = path.join(previewRoot, entry.filledDocxKey);
    if (!fs.existsSync(full)) throw new AppError('Filled Word file missing', 404);
    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    );
    res.setHeader('Content-Disposition', 'inline; filename="preview-filled.docx"');
    fs.createReadStream(full).pipe(res);
  })
);

router.get(
  '/preview-meta/:token',
  asyncHandler(async (req, res) => {
    const entry = previewStore.get(req.params.token);
    if (!entry || entry.expires < Date.now()) {
      throw new AppError('Preview expired', 404, 'PREVIEW_EXPIRED');
    }
    res.json({
      data: {
        filledText: entry.filledText,
        values: entry.values,
        templateId: entry.templateId,
        title: entry.title,
        previewUrl: `/api/v1/templates/preview/${req.params.token}.pdf`,
        filledDocxUrl: entry.filledDocxKey
          ? `/api/v1/templates/preview/${req.params.token}.docx`
          : null,
        filledDocxKey: entry.filledDocxKey,
        pdfEngine: entry.pdfEngine || 'pdfkit',
      },
    });
  })
);

router.post(
  '/render-pdf',
  requirePermission(PERMISSIONS.AGREEMENTS_WRITE),
  upload.single('file'),
  asyncHandler(async (req, res) => {
    if (!req.file) throw new AppError('Word file required (.docx)', 400, 'VALIDATION_ERROR');
    await rejectUnsafeUploadedFiles(req.file, {
      allowedExt: ['.docx'],
      maxBytes: env.uploadMaxBytes,
    });
    const ext = path.extname(req.file.originalname).toLowerCase();
    const isDocx =
      ext === '.docx' ||
      req.file.mimetype ===
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
    if (!isDocx) {
      throw new AppError('Please upload a Word (.docx) file only', 400, 'INVALID_FILE');
    }
    const converted = await convertDocxBufferToPdf(await docxBufferForNativePdf(req.file.buffer));
    if (!converted?.buffer) {
      throw new AppError(
        'Word-faithful PDF preview needs Microsoft Word or LibreOffice on this computer.',
        503,
        'PDF_ENGINE_UNAVAILABLE'
      );
    }
    sendNativePdf(res, converted, 'upload-preview.pdf');
  })
);

router.get(
  '/:id/print-preview.pdf',
  asyncHandler(async (req, res) => {
    const tpl = await DocumentTemplate.findOne({ _id: req.params.id, isDeleted: false });
    if (!tpl?.storageKey) throw new AppError('No Word file on this template', 404);
    const full = path.join(templateRoot, tpl.storageKey);
    if (!fs.existsSync(full)) throw new AppError('File missing', 404);

    const cachePath = `${full}.print.pdf`;
    try {
      const src = fs.statSync(full);
      const cache = fs.statSync(cachePath);
      if (cache.mtimeMs >= src.mtimeMs && cache.size > 64) {
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', 'inline; filename="template-preview.pdf"');
        res.setHeader('X-PDF-Engine', 'cached');
        fs.createReadStream(cachePath).pipe(res);
        return;
      }
    } catch {
      /* rebuild */
    }

    const converted = await convertDocxBufferToPdf(await docxBufferForNativePdf(fs.readFileSync(full)));
    if (!converted?.buffer) {
      throw new AppError(
        'Word-faithful PDF preview needs Microsoft Word or LibreOffice on this computer.',
        503,
        'PDF_ENGINE_UNAVAILABLE'
      );
    }
    try {
      fs.writeFileSync(cachePath, converted.buffer);
    } catch {
      /* cache is optional */
    }
    sendNativePdf(res, converted, 'template-preview.pdf');
  })
);

router.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const tpl = await DocumentTemplate.findOne({ _id: req.params.id, isDeleted: false });
    if (!tpl) throw new AppError('Template not found', 404);

    if (tpl.sourceType === 'DOCX' && tpl.storageKey) {
      const full = path.join(templateRoot, tpl.storageKey);
      if (fs.existsSync(full)) {
        try {
          const analysis = await analyzeDocx(fs.readFileSync(full));
          tpl.repeatableTables = analysis.repeatableTables || [];
          if (Array.isArray(analysis.placeholders)) {
            tpl.placeholders = analysis.placeholders;
          }
          tpl.bodyHtml = analysis.plain || tpl.bodyHtml;
          await tpl.save();
        } catch {
          /* keep stored metadata */
        }
      }
    }

    res.json({ data: tpl });
  })
);

router.get(
  '/:id/file',
  asyncHandler(async (req, res) => {
    const tpl = await DocumentTemplate.findOne({ _id: req.params.id, isDeleted: false });
    if (!tpl?.storageKey) throw new AppError('No Word file on this template', 404);
    const full = path.join(templateRoot, tpl.storageKey);
    if (!fs.existsSync(full)) throw new AppError('File missing', 404);
    res.download(full, tpl.originalFileName || 'template.docx');
  })
);

router.post(
  '/',
  requirePermission(PERMISSIONS.AGREEMENTS_WRITE),
  asyncHandler(async (req, res) => {
    if (!req.body.name) throw new AppError('name required', 400, 'VALIDATION_ERROR');
    const bodyHtml = req.body.bodyHtml || '';
    if (!bodyHtml) throw new AppError('bodyHtml required for text templates', 400, 'VALIDATION_ERROR');
    const placeholders = extractPlaceholdersFromText(bodyHtml);
    const tpl = await DocumentTemplate.create({
      name: req.body.name,
      category: req.body.category || 'AGREEMENT',
      agreementType: req.body.agreementType || 'LEASE',
      description: req.body.description || '',
      bodyHtml,
      sourceType: 'TEXT',
      placeholders,
      isActive: true,
      createdBy: req.user._id,
    });
    res.status(201).json({ data: tpl });
  })
);

router.post(
  '/analyze',
  requirePermission(PERMISSIONS.AGREEMENTS_WRITE),
  upload.single('file'),
  asyncHandler(async (req, res) => {
    if (!req.file) throw new AppError('Word file required (.docx)', 400, 'VALIDATION_ERROR');
    await rejectUnsafeUploadedFiles(req.file, {
      allowedExt: ['.docx'],
      maxBytes: env.uploadMaxBytes,
    });
    const ext = path.extname(req.file.originalname).toLowerCase();
    const isDocx =
      ext === '.docx' ||
      req.file.mimetype ===
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

    if (!isDocx) {
      throw new AppError('Please upload a Word (.docx) file only', 400, 'INVALID_FILE');
    }

    const analysis = await analyzeDocx(req.file.buffer);
    res.json({
      data: {
        plain: analysis.plain,
        placeholders: analysis.placeholders,
        repeatableTables: analysis.repeatableTables || [],
        originalFileName: req.file.originalname,
        sizeBytes: req.file.size,
      },
    });
  })
);

router.post(
  '/upload',
  requirePermission(PERMISSIONS.AGREEMENTS_WRITE),
  upload.single('file'),
  asyncHandler(async (req, res) => {
    if (!req.file) throw new AppError('Word file required (.docx)', 400, 'VALIDATION_ERROR');
    await rejectUnsafeUploadedFiles(req.file, {
      allowedExt: ['.docx'],
      maxBytes: env.uploadMaxBytes,
    });
    const ext = path.extname(req.file.originalname).toLowerCase();
    const isDocx =
      ext === '.docx' ||
      req.file.mimetype ===
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

    if (!isDocx) {
      throw new AppError('Please upload a Word (.docx) file only', 400, 'INVALID_FILE');
    }
    if (!req.body.name || !String(req.body.name).trim()) {
      throw new AppError('Template name is required', 400, 'VALIDATION_ERROR');
    }

    const documentType = req.body.documentType || req.body.agreementType || 'LEASE';
    const signingType =
      req.body.signingType === 'NON_SIGNING' || req.body.signingType === 'non_signing'
        ? 'NON_SIGNING'
        : 'SIGNING';
    const name = String(req.body.name).trim();

    let defaultSenderSignatureId = null;
    let defaultSenderSignature = null;
    const rawSigId = String(req.body.defaultSenderSignatureId || req.body.defaultSignatureId || '').trim();
    if (rawSigId) {
      const master = await SignatureMaster.findOne({
        _id: rawSigId,
        isDeleted: false,
        isActive: true,
      });
      if (!master) throw new AppError('Default signature not found', 404);
      defaultSenderSignatureId = master._id;
      defaultSenderSignature = {
        name: master.name,
        roleLabel: master.roleLabel,
        signatureType: master.signatureType,
        signatureData: master.signatureData,
      };
    }

    const analysis = await analyzeDocx(req.file.buffer);
    const storageKey = `${uuid()}-${req.file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
    const storedPath = path.join(templateRoot, storageKey);
    writeBuffer(storedPath, req.file.buffer);
    invalidatePrintPreviewCache(storedPath);

    const tpl = await DocumentTemplate.create({
      name,
      category: req.body.category || 'AGREEMENT',
      agreementType: documentType === 'TEMPORARY_OWNERSHIP' ? 'TEMPORARY_OWNERSHIP' : 'LEASE',
      documentType,
      signingType,
      defaultSenderSignatureId,
      defaultSenderSignature,
      description:
        req.body.description ||
        `${signingType === 'SIGNING' ? 'Signing' : 'Non-signing'} · ${documentType}`,
      bodyHtml: analysis.plain,
      sourceType: 'DOCX',
      originalFileName: req.file.originalname,
      storageKey,
      contentType: req.file.mimetype,
      placeholders: analysis.placeholders,
      repeatableTables: analysis.repeatableTables || [],
      isActive: true,
      createdBy: req.user._id,
    });

    res.status(201).json({ data: tpl });
  })
);

router.post(
  '/:id/fill-preview',
  requirePermission(PERMISSIONS.AGREEMENTS_WRITE),
  asyncHandler(async (req, res) => {
    const tpl = await DocumentTemplate.findOne({ _id: req.params.id, isDeleted: false });
    if (!tpl) throw new AppError('Template not found', 404);

    const values = req.body.values || {};
    const lineRows = req.body.lineRows && typeof req.body.lineRows === 'object' ? req.body.lineRows : {};
    let placeholders = tpl.placeholders || [];
    let repeatableTables = Array.isArray(tpl.repeatableTables) ? tpl.repeatableTables : [];

    if (tpl.sourceType === 'DOCX' && tpl.storageKey) {
      const fullPath = path.join(templateRoot, tpl.storageKey);
      if (fs.existsSync(fullPath)) {
        const analysis = await analyzeDocx(fs.readFileSync(fullPath));
        placeholders = analysis.placeholders || [];
        repeatableTables = analysis.repeatableTables || [];
        tpl.placeholders = placeholders;
        tpl.repeatableTables = repeatableTables;
        if (analysis.plain) tpl.bodyHtml = analysis.plain;
        await tpl.save();
      }
    } else if (!placeholders.length && tpl.bodyHtml) {
      placeholders = extractPlaceholdersFromText(tpl.bodyHtml);
      tpl.placeholders = placeholders;
      await tpl.save();
    }

    const missing = placeholders.filter((p) => {
      const v = values[p.key] ?? values[p.label];
      return v == null || String(v).trim() === '';
    });
    if (missing.length) {
      throw new AppError(
        `Fill all placeholders: ${missing.map((m) => m.label).join(', ')}`,
        400,
        'PLACEHOLDERS_REQUIRED',
        missing
      );
    }

    const invalid = [];
    for (const p of placeholders) {
      const v = values[p.key] ?? values[p.label];
      const err = validatePlaceholderValue(p.type, v);
      if (err) invalid.push({ ...p, message: err });
    }

    for (const table of repeatableTables) {
      const rows = Array.isArray(lineRows[table.id]) ? lineRows[table.id] : [];
      const minRows = Number(table.minRows) > 0 ? Number(table.minRows) : 1;
      const maxRows = Number(table.maxRows) > 0 ? Number(table.maxRows) : 20;
      if (rows.length < minRows) {
        throw new AppError(
          `Add at least ${minRows} line item${minRows === 1 ? '' : 's'} for the item table`,
          400,
          'LINE_ROWS_REQUIRED'
        );
      }
      if (rows.length > maxRows) {
        throw new AppError(
          `At most ${maxRows} line items are allowed`,
          400,
          'LINE_ROWS_LIMIT'
        );
      }
      rows.forEach((row, rowIndex) => {
        for (const col of table.columns || []) {
          const v = row?.[col.key] ?? row?.[col.label];
          if (v == null || String(v).trim() === '') {
            invalid.push({
              ...col,
              key: `${table.id}.${rowIndex}.${col.key}`,
              label: `Row ${rowIndex + 1} · ${col.label}`,
              message: 'This field is required',
            });
            continue;
          }
          const err = validatePlaceholderValue(col.type, v);
          if (err) {
            invalid.push({
              ...col,
              key: `${table.id}.${rowIndex}.${col.key}`,
              label: `Row ${rowIndex + 1} · ${col.label}`,
              message: err,
            });
          }
        }
      });
    }

    if (invalid.length) {
      throw new AppError(
        invalid.map((i) => `${i.label}: ${i.message}`).join('; '),
        400,
        'PLACEHOLDER_INVALID',
        invalid
      );
    }

    let filledText = fillTextPlaceholders(tpl.bodyHtml || '', values, placeholders);
    let filledDocxKey = null;
    let filledDocxBuffer = null;
    let blocks = null;

    if (tpl.sourceType === 'DOCX' && tpl.storageKey) {
      const full = path.join(templateRoot, tpl.storageKey);
      if (!fs.existsSync(full)) throw new AppError('Template Word file missing', 404);
      const buffer = fs.readFileSync(full);
      const filled = await fillDocxBuffer(buffer, values, {
        repeatableTables,
        lineRows,
        documentPlaceholders: placeholders,
      });
      filledText = filled.filledText;
      blocks = filled.blocks;
      filledDocxBuffer = filled.filledBuffer;
      filledDocxKey = `${uuid()}-filled.docx`;
      writeBuffer(path.join(previewRoot, filledDocxKey), filled.filledBuffer);
    }

    const title = req.body.title || tpl.name;
    const signingType =
      req.body.signingType === 'NON_SIGNING' || tpl.signingType === 'NON_SIGNING'
        ? 'NON_SIGNING'
        : 'SIGNING';
    let pdfBuffer;
    let pdfEngine;
    try {
      ({ buffer: pdfBuffer, engine: pdfEngine } = await buildTemplatePdf({
        title,
        filledDocxBuffer,
        filledText,
        blocks,
        pdfOptions: {
          signingType,
          showSignatures: signingType === 'SIGNING',
          senderSample: tpl.defaultSenderSignature?.name || 'Sender',
        },
        allowPdfKitFallback: !(tpl.sourceType === 'DOCX' && filledDocxBuffer),
      }));
    } catch (err) {
      if (err instanceof PdfEngineUnavailableError) {
        throw new AppError(err.message, err.status, err.code);
      }
      throw err;
    }
    const token = uuid();
    const pdfName = `${token}.pdf`;
    const pdfPath = path.join(previewRoot, pdfName);
    writeBuffer(pdfPath, pdfBuffer);

    previewStore.set(token, {
      pdfPath,
      filledText,
      values,
      lineRows,
      templateId: tpl._id,
      filledDocxKey,
      title,
      signingType,
      pdfEngine,
      expires: Date.now() + 60 * 60 * 1000,
    });

    res.json({
      data: {
        previewToken: token,
        previewUrl: `/api/v1/templates/preview/${token}.pdf`,
        filledDocxUrl: filledDocxKey ? `/api/v1/templates/preview/${token}.docx` : null,
        pdfEngine,
        filledText,
        placeholders,
        repeatableTables,
        values,
        lineRows,
        signingType,
      },
    });
  })
);

router.patch(
  '/:id',
  requirePermission(PERMISSIONS.AGREEMENTS_WRITE),
  asyncHandler(async (req, res) => {
    const tpl = await DocumentTemplate.findOne({ _id: req.params.id, isDeleted: false });
    if (!tpl) throw new AppError('Template not found', 404);
    for (const key of ['name', 'description', 'bodyHtml', 'category', 'agreementType', 'isActive']) {
      if (req.body[key] !== undefined) tpl[key] = req.body[key];
    }
    if (req.body.bodyHtml !== undefined && tpl.sourceType !== 'DOCX') {
      tpl.placeholders = extractPlaceholdersFromText(req.body.bodyHtml);
    }
    if (req.body.bodyHtml !== undefined) {
      tpl.placeholders = extractPlaceholdersFromText(req.body.bodyHtml);
      if (tpl.sourceType !== 'DOCX') tpl.sourceType = 'TEXT';
    }
    await tpl.save();
    res.json({ data: tpl });
  })
);

export { previewStore, previewRoot, templateRoot };
export default router;

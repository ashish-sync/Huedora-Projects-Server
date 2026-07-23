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
  textToPdfBuffer,
  validatePlaceholderValue,
  writeBuffer,
  ensureDir,
} from './docxPlaceholders.js';
import { previewStore } from './previewStore.js';
import { sendExcel } from '../../utils/excelExport.js';
import { cellValue, excelUpload, parseSheetRows } from '../../utils/masterExcel.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const templateRoot = path.resolve(__dirname, '../../../uploads/templates');
const previewRoot = path.resolve(__dirname, '../../../uploads/previews');
ensureDir(templateRoot);
ensureDir(previewRoot);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: env.uploadMaxBytes },
});

const router = Router();
router.use(authenticate);

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
        'Name',
        'Document Type',
        'Category',
        'Agreement Type',
        'Signing Mode',
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

const TEMPLATE_HEADERS = [
  'Name',
  'Document Type',
  'Category',
  'Agreement Type',
  'Signing Mode',
  'Active',
  'Description',
];

router.get(
  '/sample',
  asyncHandler(async (_req, res) => {
    sendExcel(
      res,
      'Document_Master_Sample.xlsx',
      TEMPLATE_HEADERS,
      [
        [
          'Lease Agreement Sample',
          'LEASE',
          'AGREEMENT',
          'LEASE',
          'SIGNING',
          'Yes',
          'Sample text template — edit body after import',
        ],
      ],
      { sheetName: 'Document Master' }
    );
  })
);

router.post(
  '/import',
  requirePermission(PERMISSIONS.AGREEMENTS_WRITE),
  excelUpload.single('file'),
  asyncHandler(async (req, res) => {
    if (!req.file) throw new AppError('Excel file required', 400, 'VALIDATION_ERROR');
    const rows = parseSheetRows(req.file.buffer);
    const errors = [];
    let created = 0;

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const rowNum = i + 2;
      try {
        const name = cellValue(row, ['Name', 'name']);
        if (!name) continue;
        const documentType = cellValue(row, ['Document Type', 'documentType']) || 'LEASE';
        const signingRaw = cellValue(row, ['Signing Mode', 'signingType']).toUpperCase();
        const signingType = signingRaw.includes('NON') ? 'NON_SIGNING' : 'SIGNING';
        const bodyHtml = `Document: ${name}\n\nEdit this template body and add placeholders as needed.`;
        await DocumentTemplate.create({
          name,
          category: cellValue(row, ['Category', 'category']) || 'AGREEMENT',
          agreementType: cellValue(row, ['Agreement Type', 'agreementType']) || documentType,
          documentType,
          signingType,
          description: cellValue(row, ['Description', 'description']) || '',
          bodyHtml,
          sourceType: 'TEXT',
          placeholders: extractPlaceholdersFromText(bodyHtml),
          isActive: !['no', 'false', '0', 'inactive'].includes(
            cellValue(row, ['Active', 'isActive']).toLowerCase()
          ),
          createdBy: req.user._id,
        });
        created += 1;
      } catch (err) {
        errors.push({ row: rowNum, field: 'import', message: err.message });
      }
    }

    res.json({
      data: {
        totalRows: rows.length,
        created,
        updated: 0,
        errorRows: errors.length,
        errors: errors.slice(0, 200),
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
    fs.createReadStream(entry.pdfPath).pipe(res);
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
        filledDocxKey: entry.filledDocxKey,
      },
    });
  })
);

router.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const tpl = await DocumentTemplate.findOne({ _id: req.params.id, isDeleted: false });
    if (!tpl) throw new AppError('Template not found', 404);
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
    writeBuffer(path.join(templateRoot, storageKey), req.file.buffer);

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
    let placeholders = tpl.placeholders || [];
    if (!placeholders.length && tpl.bodyHtml) {
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
    let blocks = null;

    if (tpl.sourceType === 'DOCX' && tpl.storageKey) {
      const full = path.join(templateRoot, tpl.storageKey);
      if (!fs.existsSync(full)) throw new AppError('Template Word file missing', 404);
      const buffer = fs.readFileSync(full);
      const filled = await fillDocxBuffer(buffer, values);
      filledText = filled.filledText;
      blocks = filled.blocks;
      filledDocxKey = `${uuid()}-filled.docx`;
      writeBuffer(path.join(previewRoot, filledDocxKey), filled.filledBuffer);
    }

    const title = req.body.title || tpl.name;
    const signingType =
      req.body.signingType === 'NON_SIGNING' || tpl.signingType === 'NON_SIGNING'
        ? 'NON_SIGNING'
        : 'SIGNING';
    const pdfBuffer = await textToPdfBuffer(title, filledText, {
      signingType,
      showSignatures: signingType === 'SIGNING',
      senderSample: tpl.defaultSenderSignature?.name || 'Sender',
      blocks,
    });
    const token = uuid();
    const pdfName = `${token}.pdf`;
    const pdfPath = path.join(previewRoot, pdfName);
    writeBuffer(pdfPath, pdfBuffer);

    previewStore.set(token, {
      pdfPath,
      filledText,
      values,
      templateId: tpl._id,
      filledDocxKey,
      title,
      signingType,
      expires: Date.now() + 60 * 60 * 1000,
    });

    res.json({
      data: {
        previewToken: token,
        previewUrl: `/api/v1/templates/preview/${token}.pdf`,
        filledText,
        placeholders,
        values,
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

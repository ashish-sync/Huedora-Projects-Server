import { Router } from 'express';
import multer from 'multer';
import rateLimit from 'express-rate-limit';
import { AppError, asyncHandler, parsePagination, paginated } from '../../utils/helpers.js';
import { writeAudit } from '../../utils/audit.js';
import { createUploadStorage } from '../../storage/createUploadStorage.js';
import { ensureUploadCommit } from '../../storage/uploadLifecycle.js';
import { multerStoredUploadFileNameWithPurpose } from '../../storage/uploadKeys.js';
import { CampOpsCamp } from '../campOps/campOps.model.js';
import { assertClientOneFeature } from './clientOne.features.js';
import {
  buildCampScopeFilter,
  computeClientOneKpis,
  defaultDashboardWindow,
  loadScopedCamps,
  resolveClientOneSessionAccess,
  signClientOneSession,
  toClientOneCampDto,
  verifyClientOnePin,
  verifyClientOneSessionToken,
  isClientOnePreviewToken,
} from './clientOne.service.js';
import {
  appendClientOnePoFiles,
  buildClientOneCalendar,
  buildClientOneMis,
  campUploadRoot,
  getClientOneCampRequestLink,
  listClientOneAnnexures,
  listClientOneInvoices,
  listClientOnePurchaseOrders,
  misToCsv,
  sendClientOneAnnexure,
  sendClientOneInvoicePdf,
  sendClientOnePoFile,
} from './clientOne.portal.js';

const router = Router();

const linkLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => req.ip || 'unknown',
  message: { error: { message: 'Too many requests. Try again later.', code: 'RATE_LIMIT' } },
});

const pinLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => req.ip || 'unknown',
  message: { error: { message: 'Too many PIN attempts. Try again later.', code: 'RATE_LIMIT' } },
});

const poUpload = multer({
  storage: createUploadStorage({
    destination: (_req, _file, cb) => cb(null, campUploadRoot),
    filename: multerStoredUploadFileNameWithPurpose('po'),
  }),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const mime = String(file.mimetype || '').toLowerCase();
    const name = String(file.originalname || '').toLowerCase();
    const allowed =
      mime === 'application/pdf'
      || mime.startsWith('image/')
      || mime.includes('word')
      || mime.includes('sheet')
      || mime.includes('excel')
      || /\.(pdf|png|jpe?g|webp|docx?|xlsx?)$/i.test(name);
    cb(allowed ? null : new Error('PO file type not allowed'), allowed);
  },
});

router.use(linkLimiter);

async function requireClientOneSession(req, _res, next) {
  try {
    const header = String(req.headers.authorization || '');
    const bearer = header.toLowerCase().startsWith('bearer ')
      ? header.slice(7).trim()
      : '';
    const decoded = verifyClientOneSessionToken(bearer);
    const access = await resolveClientOneSessionAccess(decoded);
    req.clientOne = {
      decoded,
      access,
      isPreview: isClientOnePreviewToken(decoded) || access.isPreview === true,
    };
    next();
  } catch (err) {
    next(err);
  }
}

function requireFeature(featureKey) {
  return (req, _res, next) => {
    try {
      assertClientOneFeature(req.clientOne.access, featureKey);
      next();
    } catch (err) {
      next(err);
    }
  };
}

function rangeFromQuery(req) {
  const defaults = defaultDashboardWindow();
  const from = req.query.from ? String(req.query.from).slice(0, 10) : defaults.from;
  const to = req.query.to ? String(req.query.to).slice(0, 10) : defaults.to;
  return { from, to };
}

router.post(
  '/session',
  pinLimiter,
  asyncHandler(async (req, res) => {
    const pin = req.body?.pin;
    const accessId = req.body?.accessId || '';
    let access;
    try {
      access = await verifyClientOnePin({ pin, accessId });
    } catch (err) {
      await writeAudit({
        action: 'CLIENT_ONE.LOGIN_FAILURE',
        entityType: 'client_one_access',
        entityId: accessId || null,
        result: 'FAILURE',
        message: err?.message || 'Invalid PIN',
        source: 'UI',
        actorType: 'USER',
        ip: req.ip,
        requestId: req.requestId,
      });
      throw err;
    }

    const session = signClientOneSession(access);
    await writeAudit({
      action: 'CLIENT_ONE.LOGIN_SUCCESS',
      entityType: 'client_one_access',
      entityId: access._id,
      after: {
        accessId: access.accessId,
        clientName: access.clientName,
        programName: access.programName,
        campName: access.campName,
      },
      source: 'UI',
      actorType: 'USER',
      actorEmail: `client-one:${access.accessId}`,
      ip: req.ip,
      requestId: req.requestId,
      programmeId: access.programName,
    });

    res.json({ data: session });
  }),
);

router.post(
  '/session/logout',
  asyncHandler(async (_req, res) => {
    res.json({ data: { ok: true } });
  }),
);

router.get(
  '/me',
  requireClientOneSession,
  asyncHandler(async (req, res) => {
    const session = signClientOneSession(req.clientOne.access, {
      preview: req.clientOne.isPreview,
    });
    res.json({
      data: {
        client: session.client,
        features: session.features,
        mode: req.clientOne.isPreview ? 'preview' : 'external',
      },
    });
  }),
);

router.get(
  '/dashboard',
  requireClientOneSession,
  requireFeature('dashboard'),
  asyncHandler(async (req, res) => {
    const { from, to } = rangeFromQuery(req);
    const camps = await loadScopedCamps(req.clientOne.access, { from, to });
    const kpis = computeClientOneKpis(camps, { from, to });
    const session = signClientOneSession(req.clientOne.access, {
      preview: req.clientOne.isPreview,
    });
    res.json({
      data: {
        client: session.client,
        features: session.features,
        mode: req.clientOne.isPreview ? 'preview' : 'external',
        kpis,
      },
    });
  }),
);

router.get(
  '/camps',
  requireClientOneSession,
  requireFeature('campTracker'),
  asyncHandler(async (req, res) => {
    const { page, limit, skip } = parsePagination(req.query);
    const { from, to } = rangeFromQuery(req);
    const filter = buildCampScopeFilter(req.clientOne.access);
    filter.campDate = { $gte: from, $lte: to };
    const rows = await CampOpsCamp.find(filter);
    const list = (Array.isArray(rows) ? rows : [])
      .slice()
      .sort((a, b) => String(a.campDate || '').localeCompare(String(b.campDate || '')));
    const total = list.length;
    const pageRows = list.slice(skip, skip + limit).map(toClientOneCampDto);
    res.json(paginated(pageRows, total, page, limit));
  }),
);

router.get(
  '/camps/:id',
  requireClientOneSession,
  requireFeature('campTracker'),
  asyncHandler(async (req, res) => {
    const scope = buildCampScopeFilter(req.clientOne.access);
    const camp = await CampOpsCamp.findOne({
      _id: req.params.id,
      ...scope,
    });
    if (!camp) throw new AppError('Camp not found', 404, 'NOT_FOUND');
    res.json({ data: toClientOneCampDto(camp) });
  }),
);

router.get(
  '/hcw',
  requireClientOneSession,
  requireFeature('hcw'),
  asyncHandler(async (req, res) => {
    const { from, to } = rangeFromQuery(req);
    const camps = await loadScopedCamps(req.clientOne.access, { from, to });
    const rows = camps
      .map(toClientOneCampDto)
      .filter((row) => row.hcwName || row.assignmentStatus)
      .map((row) => ({
        campId: row.campId,
        campDate: row.campDate,
        status: row.status,
        hcwName: row.hcwName || '',
        hcwContact: row.hcwContact || '',
        hcwCategory: row.hcwCategory || '',
        assignmentStatus: row.assignmentStatus || '',
        campAddress: row.campAddress || '',
        city: row.city || '',
        _id: row._id,
      }))
      .sort((a, b) => String(a.campDate || '').localeCompare(String(b.campDate || '')));
    res.json({ data: rows });
  }),
);

router.get(
  '/calendar',
  requireClientOneSession,
  requireFeature('calendar'),
  asyncHandler(async (req, res) => {
    const { from, to } = rangeFromQuery(req);
    const data = await buildClientOneCalendar(req.clientOne.access, { from, to });
    res.json({ data });
  }),
);

router.get(
  '/invoices',
  requireClientOneSession,
  requireFeature('invoices'),
  asyncHandler(async (req, res) => {
    const data = await listClientOneInvoices(req.clientOne.access);
    res.json({ data });
  }),
);

router.get(
  '/invoices/:id/pdf',
  requireClientOneSession,
  requireFeature('invoices'),
  asyncHandler(async (req, res) => {
    const download = String(req.query.download || '') === '1';
    await sendClientOneInvoicePdf(res, req.clientOne.access, req.params.id, { download });
  }),
);

router.get(
  '/annexures',
  requireClientOneSession,
  requireFeature('annexures'),
  asyncHandler(async (req, res) => {
    const data = await listClientOneAnnexures(req.clientOne.access);
    res.json({ data });
  }),
);

router.get(
  '/annexures/:id/download',
  requireClientOneSession,
  requireFeature('annexures'),
  asyncHandler(async (req, res) => {
    await sendClientOneAnnexure(res, req.clientOne.access, req.params.id, { download: true });
  }),
);

router.get(
  '/mis',
  requireClientOneSession,
  requireFeature('mis'),
  asyncHandler(async (req, res) => {
    const { from, to } = rangeFromQuery(req);
    const data = await buildClientOneMis(req.clientOne.access, { from, to });
    res.json({ data });
  }),
);

router.get(
  '/mis/export',
  requireClientOneSession,
  requireFeature('mis'),
  asyncHandler(async (req, res) => {
    const { from, to } = rangeFromQuery(req);
    const data = await buildClientOneMis(req.clientOne.access, { from, to });
    const csv = misToCsv(data);
    const name = `client-one-mis-${from || 'all'}-${to || 'all'}.csv`.replace(/[^\w.-]+/g, '_');
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${name}"`);
    res.send(csv);
  }),
);

router.get(
  '/camp-request-link',
  requireClientOneSession,
  requireFeature('campRequestLink'),
  asyncHandler(async (req, res) => {
    const data = await getClientOneCampRequestLink(req.clientOne.access, { rotate: false });
    res.json({ data });
  }),
);

router.post(
  '/camp-request-link/rotate',
  requireClientOneSession,
  requireFeature('campRequestLink'),
  asyncHandler(async (req, res) => {
    const data = await getClientOneCampRequestLink(req.clientOne.access, { rotate: true });
    await writeAudit({
      action: 'CLIENT_ONE.CAMP_REQUEST_LINK_ROTATE',
      entityType: 'camp_ops_client_master',
      entityId: req.clientOne.access.clientMasterId,
      after: { path: data.path },
      source: 'UI',
      actorType: 'USER',
      actorEmail: `client-one:${req.clientOne.access.accessId}`,
      ip: req.ip,
      requestId: req.requestId,
    });
    res.json({ data });
  }),
);

router.get(
  '/purchase-orders',
  requireClientOneSession,
  requireFeature('poUpload'),
  asyncHandler(async (req, res) => {
    const data = await listClientOnePurchaseOrders(req.clientOne.access);
    res.json({ data });
  }),
);

router.post(
  '/purchase-orders',
  requireClientOneSession,
  requireFeature('poUpload'),
  poUpload.fields([
    { name: 'files', maxCount: 10 },
    { name: 'poFile', maxCount: 1 },
  ]),
  ensureUploadCommit(),
  asyncHandler(async (req, res) => {
    const uploaded = [
      ...(Array.isArray(req.files?.files) ? req.files.files : []),
      ...(Array.isArray(req.files?.poFile) ? req.files.poFile : []),
    ];
    const poId = String(req.body?.poId || req.query?.poId || '').trim();
    const data = await appendClientOnePoFiles(req.clientOne.access, uploaded, poId);
    await writeAudit({
      action: 'CLIENT_ONE.PO_UPLOAD',
      entityType: 'camp_ops_client_master',
      entityId: req.clientOne.access.clientMasterId,
      after: { count: uploaded.length, poId: poId || null },
      source: 'UI',
      actorType: 'USER',
      actorEmail: `client-one:${req.clientOne.access.accessId}`,
      ip: req.ip,
      requestId: req.requestId,
    });
    res.status(201).json({ data });
  }),
);

router.get(
  '/purchase-orders/:poId/files/:fileId',
  requireClientOneSession,
  requireFeature('poUpload'),
  asyncHandler(async (req, res) => {
    await sendClientOnePoFile(res, req.clientOne.access, req.params.poId, req.params.fileId);
  }),
);

router.get(
  '/purchase-orders/:poId/file',
  requireClientOneSession,
  requireFeature('poUpload'),
  asyncHandler(async (req, res) => {
    await sendClientOnePoFile(res, req.clientOne.access, req.params.poId, '');
  }),
);

export default router;

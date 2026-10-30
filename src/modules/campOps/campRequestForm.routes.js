import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { asyncHandler } from '../../utils/helpers.js';
import { writeAudit } from '../../utils/audit.js';
import { sendCsv } from '../../utils/excelExport.js';
import { excelUpload, assertSpreadsheetUpload, discardUploadBuffer, sampleCsvFilename } from '../../utils/masterExcel.js';
import { importRateLimiter } from '../../middleware/importRateLimit.js';
import { notifyCampWorkflow, notifyCampBulkSummary } from './campOps.notifications.js';
import {
  importProgramFormFile,
  listProgramFormCities,
  listProgramFormDistricts,
  listProgramFormStates,
  lookupProgramFormPin,
  PROGRAM_FORM_SAMPLE_FIELDS,
  PROGRAM_FORM_SAMPLE_ROW,
  publicProgramRequestContext,
  resolveProgramByRequestToken,
  submitProgramCampRequest,
} from './campRequestForm.service.js';

const router = Router();

const linkLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => req.ip || 'unknown',
  message: { error: { message: 'Too many requests. Try again later.', code: 'RATE_LIMIT' } },
});

router.use(linkLimiter);

router.get(
  '/:token',
  asyncHandler(async (req, res) => {
    const { master, client } = await resolveProgramByRequestToken(req.params.token);
    res.json({ data: publicProgramRequestContext(master, client) });
  }),
);

router.post(
  '/:token',
  asyncHandler(async (req, res) => {
    const camp = await submitProgramCampRequest(req.params.token, req.body || {});
    await writeAudit({
      action: 'camp_ops.program_form_create',
      entityType: 'camp_ops_camp',
      entityId: camp._id,
      after: {
        campId: camp.campId,
        clientName: camp.clientName,
        campaignType: camp.campaignType,
        campaignName: camp.campaignName,
        campDate: camp.campDate,
      },
      actorEmail: 'program-form',
      requestId: req.correlationId,
      actorType: 'SYSTEM',
      ip: req.ip,
    });
    await notifyCampWorkflow({ camp, action: 'create', actorId: null });
    res.status(201).json({
      data: {
        campId: camp.campId,
        status: camp.status,
      },
    });
  }),
);

router.get(
  '/:token/import/sample',
  asyncHandler(async (req, res) => {
    await resolveProgramByRequestToken(req.params.token);
    sendCsv(
      res,
      sampleCsvFilename('camp-request-form'),
      PROGRAM_FORM_SAMPLE_FIELDS.map((field) => field.label),
      [PROGRAM_FORM_SAMPLE_ROW],
    );
  }),
);

router.post(
  '/:token/import',
  importRateLimiter,
  excelUpload.single('file'),
  asyncHandler(async (req, res) => {
    try {
      assertSpreadsheetUpload(req.file);
      const result = await importProgramFormFile(req.params.token, req.file);
      await writeAudit({
        action: 'camp_ops.program_form_import',
        entityType: 'camp_ops_import',
        entityId: null,
        after: result.summary,
        actorEmail: 'program-form',
        requestId: req.correlationId,
        actorType: 'SYSTEM',
        ip: req.ip,
      });
      await notifyCampBulkSummary({
        action: 'import',
        actorId: null,
        success: result.created.map((row) => ({ id: row.id, campId: row.campId })),
        skipped: result.skipped,
        failed: result.failed,
      });
      res.status(result.summary.created ? 201 : 200).json({ data: result });
    } finally {
      discardUploadBuffer(req.file);
    }
  }),
);

router.get(
  '/:token/geo/pin/:pin',
  asyncHandler(async (req, res) => {
    await resolveProgramByRequestToken(req.params.token);
    const result = await lookupProgramFormPin(req.params.pin);
    res.json(result);
  }),
);

router.get(
  '/:token/geo/states',
  asyncHandler(async (req, res) => {
    await resolveProgramByRequestToken(req.params.token);
    res.json({ data: await listProgramFormStates() });
  }),
);

router.get(
  '/:token/geo/districts',
  asyncHandler(async (req, res) => {
    await resolveProgramByRequestToken(req.params.token);
    res.json({ data: await listProgramFormDistricts(req.query.stateId) });
  }),
);

router.get(
  '/:token/geo/cities',
  asyncHandler(async (req, res) => {
    await resolveProgramByRequestToken(req.params.token);
    res.json({ data: await listProgramFormCities(req.query.stateId) });
  }),
);

export default router;

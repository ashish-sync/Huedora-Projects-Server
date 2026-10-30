import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { asyncHandler } from '../../utils/helpers.js';
import { writeAudit } from '../../utils/audit.js';
import { notifyCampWorkflow } from './campOps.notifications.js';
import {
  listProgramFormCities,
  listProgramFormDistricts,
  listProgramFormStates,
  lookupProgramFormPin,
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

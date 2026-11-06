import { Router } from 'express';
import { authenticate, requirePermission } from '../../middleware/auth.js';
import { PERMISSIONS } from '../../config/constants.js';
import { asyncHandler } from '../../utils/helpers.js';
import {
  acceptRequest,
  createEvent,
  declineRequest,
  deleteEvent,
  listDirectory,
  listEvents,
  suggestAlternative,
  summaryCounts,
  updateEvent,
} from './calendar.service.js';

const router = Router();
router.use(authenticate);
router.use(requirePermission(PERMISSIONS.DASHBOARDS_READ, PERMISSIONS.NOTIFICATIONS_READ));

router.get(
  '/directory',
  asyncHandler(async (req, res) => {
    const data = await listDirectory(req.user._id, { q: req.query.q });
    res.json({ data });
  }),
);

router.get(
  '/summary',
  asyncHandler(async (req, res) => {
    const data = await summaryCounts(req.user._id);
    res.json({ data });
  }),
);

router.get(
  '/events',
  asyncHandler(async (req, res) => {
    const data = await listEvents(req.user._id, {
      from: req.query.from,
      to: req.query.to,
      kind: req.query.kind,
    });
    res.json({ data });
  }),
);

router.post(
  '/events',
  asyncHandler(async (req, res) => {
    const data = await createEvent(req.user._id, req.body || {}, req.user);
    res.status(201).json({ data });
  }),
);

router.patch(
  '/events/:id',
  asyncHandler(async (req, res) => {
    const data = await updateEvent(req.user._id, req.params.id, req.body || {}, req.user);
    res.json({ data });
  }),
);

router.delete(
  '/events/:id',
  asyncHandler(async (req, res) => {
    const data = await deleteEvent(req.user._id, req.params.id);
    res.json({ data });
  }),
);

router.post(
  '/events/:id/accept',
  asyncHandler(async (req, res) => {
    const data = await acceptRequest(req.user._id, req.params.id, req.body || {}, req.user);
    res.json({ data });
  }),
);

router.post(
  '/events/:id/decline',
  asyncHandler(async (req, res) => {
    const data = await declineRequest(req.user._id, req.params.id, req.body || {}, req.user);
    res.json({ data });
  }),
);

router.post(
  '/events/:id/suggest',
  asyncHandler(async (req, res) => {
    const data = await suggestAlternative(req.user._id, req.params.id, req.body || {}, req.user);
    res.json({ data });
  }),
);

export default router;

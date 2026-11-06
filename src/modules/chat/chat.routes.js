import { Router } from 'express';
import { authenticate } from '../../middleware/auth.js';
import { asyncHandler, paginated } from '../../utils/helpers.js';
import {
  findOrCreateDm,
  listConversationsForUser,
  listDirectory,
  listMessages,
  markConversationRead,
  sendMessage,
  unreadTotalForUser,
} from './chat.service.js';

const router = Router();
router.use(authenticate);

/** Active colleagues available to message (any authenticated employee). */
router.get(
  '/directory',
  asyncHandler(async (req, res) => {
    const data = await listDirectory(req.user._id, { q: req.query.q });
    res.json({ data });
  }),
);

router.get(
  '/unread-count',
  asyncHandler(async (req, res) => {
    const count = await unreadTotalForUser(req.user._id);
    res.json({ data: { count } });
  }),
);

router.get(
  '/conversations',
  asyncHandler(async (req, res) => {
    const data = await listConversationsForUser(req.user._id);
    res.json({ data });
  }),
);

router.post(
  '/conversations',
  asyncHandler(async (req, res) => {
    const peerUserId = req.body?.peerUserId || req.body?.userId;
    const data = await findOrCreateDm(req.user._id, peerUserId);
    res.status(201).json({ data });
  }),
);

router.get(
  '/conversations/:id/messages',
  asyncHandler(async (req, res) => {
    const result = await listMessages(req.params.id, req.user._id, {
      page: req.query.page,
      limit: req.query.limit,
    });
    res.json(paginated(result.data, result.total, result.page, result.limit));
  }),
);

router.post(
  '/conversations/:id/messages',
  asyncHandler(async (req, res) => {
    const data = await sendMessage(req.params.id, req.user._id, req.body?.body ?? req.body?.text);
    res.status(201).json({ data });
  }),
);

router.post(
  '/conversations/:id/read',
  asyncHandler(async (req, res) => {
    const data = await markConversationRead(req.params.id, req.user._id);
    res.json({ data });
  }),
);

export default router;

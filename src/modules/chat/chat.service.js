import { AppError } from '../../utils/helpers.js';
import { User } from '../users/user.model.js';
import { ChatConversation, ChatMessage } from './chat.model.js';

const MAX_BODY = 4000;
const DIRECTORY_LIMIT = 200;
const MESSAGE_PAGE_DEFAULT = 50;

export function asId(value) {
  return String(value || '').trim();
}

export function dmParticipantKey(a, b) {
  return [asId(a), asId(b)].filter(Boolean).sort().join('|');
}

export function serializeDirectoryUser(user) {
  if (!user) return null;
  return {
    id: asId(user._id || user.id),
    fullName: String(user.fullName || user.username || user.email || 'User').trim(),
    email: String(user.email || '').trim(),
    designation: String(user.designation || '').trim(),
    isActive: user.isActive !== false,
  };
}

export function serializeMessage(message) {
  if (!message) return null;
  return {
    id: asId(message._id),
    conversationId: asId(message.conversationId),
    senderId: asId(message.senderId),
    body: String(message.body || ''),
    readBy: Array.isArray(message.readBy) ? message.readBy.map(asId) : [],
    createdAt: message.createdAt || null,
    updatedAt: message.updatedAt || null,
  };
}

export function serializeConversation(conversation, { peer = null, unreadCount = 0 } = {}) {
  if (!conversation) return null;
  return {
    id: asId(conversation._id),
    type: conversation.type || 'dm',
    participantIds: (conversation.participantIds || []).map(asId),
    peer,
    lastMessageAt: conversation.lastMessageAt || null,
    lastMessagePreview: String(conversation.lastMessagePreview || ''),
    lastSenderId: conversation.lastSenderId ? asId(conversation.lastSenderId) : null,
    unreadCount: Number(unreadCount) || 0,
    createdAt: conversation.createdAt || null,
    updatedAt: conversation.updatedAt || null,
  };
}

export async function loadUserMap(ids) {
  const unique = [...new Set((ids || []).map(asId).filter(Boolean))];
  if (!unique.length) return new Map();
  const rows = await User.find({
    _id: { $in: unique },
    isDeleted: { $ne: true },
  }).select('fullName email username designation isActive');
  const map = new Map();
  for (const row of rows) map.set(asId(row._id), serializeDirectoryUser(row));
  return map;
}

export async function listDirectory(currentUserId, { q = '' } = {}) {
  const selfId = asId(currentUserId);
  const query = String(q || '').trim().toLowerCase();
  const rows = await User.find({
    isDeleted: { $ne: true },
    isActive: { $ne: false },
  })
    .select('fullName email username designation isActive')
    .sort({ fullName: 1 })
    .limit(DIRECTORY_LIMIT);

  return rows
    .map(serializeDirectoryUser)
    .filter((user) => user && user.id !== selfId)
    .filter((user) => {
      if (!query) return true;
      const hay = `${user.fullName} ${user.email} ${user.designation}`.toLowerCase();
      return hay.includes(query);
    });
}

export async function listConversationsForUser(userId) {
  const selfId = asId(userId);
  const rows = await ChatConversation.find({
    participantIds: { $in: [selfId] },
  })
    .sort({ lastMessageAt: -1, updatedAt: -1 })
    .limit(100);

  const peerIds = rows
    .map((row) => (row.participantIds || []).map(asId).find((id) => id && id !== selfId))
    .filter(Boolean);
  const userMap = await loadUserMap(peerIds);

  const serialized = [];
  for (const row of rows) {
    const peerId = (row.participantIds || []).map(asId).find((id) => id && id !== selfId) || null;
    const unreadCount = await ChatMessage.countDocuments({
      conversationId: asId(row._id),
      senderId: { $ne: selfId },
      readBy: { $nin: [selfId] },
    });
    serialized.push(
      serializeConversation(row, {
        peer: peerId ? userMap.get(peerId) || { id: peerId, fullName: 'Colleague', email: '', designation: '' } : null,
        unreadCount,
      }),
    );
  }
  return serialized;
}

export async function assertParticipant(conversationId, userId) {
  const conversation = await ChatConversation.findById(asId(conversationId));
  if (!conversation) throw new AppError('Conversation not found', 404, 'NOT_FOUND');
  const selfId = asId(userId);
  const participants = (conversation.participantIds || []).map(asId);
  if (!participants.includes(selfId)) {
    throw new AppError('You are not a participant in this conversation', 403, 'FORBIDDEN');
  }
  return conversation;
}

export async function findOrCreateDm(currentUserId, peerUserId) {
  const selfId = asId(currentUserId);
  const peerId = asId(peerUserId);
  if (!peerId) throw new AppError('peerUserId is required', 400, 'VALIDATION_ERROR');
  if (peerId === selfId) throw new AppError('Cannot start a chat with yourself', 400, 'VALIDATION_ERROR');

  const peer = await User.findById(peerId);
  if (!peer || peer.isDeleted || peer.isActive === false) {
    throw new AppError('Colleague not found or inactive', 404, 'NOT_FOUND');
  }

  const participantKey = dmParticipantKey(selfId, peerId);
  let conversation = await ChatConversation.findOne({ participantKey, type: 'dm' });
  if (!conversation) {
    conversation = await ChatConversation.create({
      type: 'dm',
      participantIds: [selfId, peerId].sort(),
      participantKey,
      lastMessageAt: null,
      lastMessagePreview: '',
      lastSenderId: null,
      createdBy: selfId,
    });
  }

  return serializeConversation(conversation, {
    peer: serializeDirectoryUser(peer),
    unreadCount: 0,
  });
}

export async function listMessages(conversationId, userId, { page = 1, limit = MESSAGE_PAGE_DEFAULT } = {}) {
  await assertParticipant(conversationId, userId);
  const safeLimit = Math.min(100, Math.max(1, Number(limit) || MESSAGE_PAGE_DEFAULT));
  const safePage = Math.max(1, Number(page) || 1);
  const filter = { conversationId: asId(conversationId) };
  const [rows, total] = await Promise.all([
    ChatMessage.find(filter)
      .sort({ createdAt: -1 })
      .skip((safePage - 1) * safeLimit)
      .limit(safeLimit),
    ChatMessage.countDocuments(filter),
  ]);
  return {
    data: rows.map(serializeMessage).reverse(),
    total,
    page: safePage,
    limit: safeLimit,
  };
}

export async function sendMessage(conversationId, userId, body) {
  const conversation = await assertParticipant(conversationId, userId);
  const text = String(body || '').trim();
  if (!text) throw new AppError('Message body is required', 400, 'VALIDATION_ERROR');
  if (text.length > MAX_BODY) {
    throw new AppError(`Message must be ${MAX_BODY} characters or fewer`, 400, 'VALIDATION_ERROR');
  }

  const selfId = asId(userId);
  const message = await ChatMessage.create({
    conversationId: asId(conversation._id),
    senderId: selfId,
    body: text,
    readBy: [selfId],
  });

  conversation.lastMessageAt = message.createdAt || new Date().toISOString();
  conversation.lastMessagePreview = text.slice(0, 160);
  conversation.lastSenderId = selfId;
  await conversation.save();

  return serializeMessage(message);
}

export async function markConversationRead(conversationId, userId) {
  const conversation = await assertParticipant(conversationId, userId);
  const selfId = asId(userId);
  const unread = await ChatMessage.find({
    conversationId: asId(conversation._id),
    senderId: { $ne: selfId },
    readBy: { $nin: [selfId] },
  }).limit(500);

  for (const message of unread) {
    const readBy = Array.isArray(message.readBy) ? message.readBy.map(asId) : [];
    if (!readBy.includes(selfId)) {
      message.readBy = [...readBy, selfId];
      await message.save();
    }
  }

  return { updated: unread.length };
}

export async function unreadTotalForUser(userId) {
  const selfId = asId(userId);
  const conversations = await ChatConversation.find({ participantIds: { $in: [selfId] } }).select('_id');
  if (!conversations.length) return 0;
  const ids = conversations.map((row) => asId(row._id));
  return ChatMessage.countDocuments({
    conversationId: { $in: ids },
    senderId: { $ne: selfId },
    readBy: { $nin: [selfId] },
  });
}

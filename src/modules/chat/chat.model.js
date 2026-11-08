import { defineCollection } from '../../store/filedb.js';

/** Direct or small-group conversations between TYLO ONE employees. */
export const ChatConversation = defineCollection('chat_conversations', {
  type: 'dm',
  participantIds: [],
  /** Sorted participant ids joined with `|` for unique DM lookup. */
  participantKey: '',
  lastMessageAt: null,
  lastMessagePreview: '',
  lastSenderId: null,
  /** Monotonic per-conversation counter used for stable message ordering. */
  messageSeq: 0,
  createdBy: null,
});

/** Individual chat messages within a conversation. */
export const ChatMessage = defineCollection('chat_messages', {
  conversationId: null,
  senderId: null,
  body: '',
  /** Per-conversation sequence (1..n) for stable chronological ordering. */
  seq: 0,
  /** Array of user ids who have read this message. */
  readBy: [],
});

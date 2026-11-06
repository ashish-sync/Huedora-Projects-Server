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
  createdBy: null,
});

/** Individual chat messages within a conversation. */
export const ChatMessage = defineCollection('chat_messages', {
  conversationId: null,
  senderId: null,
  body: '',
  /** Array of user ids who have read this message. */
  readBy: [],
});

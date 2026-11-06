import test from 'node:test';
import assert from 'node:assert/strict';
import { User } from '../users/user.model.js';
import { ChatConversation, ChatMessage } from './chat.model.js';
import {
  dmParticipantKey,
  findOrCreateDm,
  listConversationsForUser,
  listDirectory,
  listMessages,
  markConversationRead,
  sendMessage,
  unreadTotalForUser,
} from './chat.service.js';

async function seedUser(suffix) {
  return User.create({
    email: `chat.${suffix}@tylo.test`,
    username: `chat_${suffix}`,
    fullName: `Chat User ${suffix}`,
    designation: 'Operations',
    isActive: true,
    isDeleted: false,
    passwordHash: 'x',
  });
}

test('dmParticipantKey is order-independent', () => {
  assert.equal(dmParticipantKey('b', 'a'), dmParticipantKey('a', 'b'));
});

test('internal chat DM flow: directory, start, send, read, unread', async () => {
  const stamp = Date.now();
  const alice = await seedUser(`a_${stamp}`);
  const bob = await seedUser(`b_${stamp}`);
  const aliceId = String(alice._id);
  const bobId = String(bob._id);

  try {
    const directory = await listDirectory(aliceId);
    assert.ok(directory.some((u) => u.id === bobId));
    assert.ok(!directory.some((u) => u.id === aliceId));

    const conversation = await findOrCreateDm(aliceId, bobId);
    assert.ok(conversation.id);
    assert.equal(conversation.peer?.id, bobId);

    const again = await findOrCreateDm(bobId, aliceId);
    assert.equal(again.id, conversation.id);

    const first = await sendMessage(conversation.id, aliceId, 'Hello Bob');
    assert.equal(first.body, 'Hello Bob');
    assert.equal(first.senderId, aliceId);

    await sendMessage(conversation.id, bobId, 'Hi Alice');

    const listed = await listConversationsForUser(aliceId);
    const mine = listed.find((row) => row.id === conversation.id);
    assert.ok(mine);
    assert.match(String(mine.lastMessagePreview), /Hi Alice|Hello Bob/);

    const unreadBefore = await unreadTotalForUser(aliceId);
    assert.ok(unreadBefore >= 1);

    const page = await listMessages(conversation.id, aliceId, { page: 1, limit: 20 });
    assert.equal(page.data.length, 2);
    assert.equal(page.data[0].body, 'Hello Bob');
    assert.equal(page.data[1].body, 'Hi Alice');

    await markConversationRead(conversation.id, aliceId);
    const unreadAfter = await unreadTotalForUser(aliceId);
    assert.ok(unreadAfter < unreadBefore || unreadAfter === 0);

    const conversations = await ChatConversation.find({ _id: conversation.id });
    assert.equal(conversations.length, 1);
    const messages = await ChatMessage.find({ conversationId: conversation.id });
    assert.equal(messages.length, 2);
  } finally {
    // best-effort cleanup for shared filedb test runs
    try {
      alice.isDeleted = true;
      bob.isDeleted = true;
      await alice.save();
      await bob.save();
    } catch {
      /* ignore */
    }
  }
});

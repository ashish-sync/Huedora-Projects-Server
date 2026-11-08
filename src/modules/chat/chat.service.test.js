import test from 'node:test';
import assert from 'node:assert/strict';
import { User } from '../users/user.model.js';
import { ChatConversation, ChatMessage } from './chat.model.js';
import {
  assertConversationAccess,
  authorizeChatSocketAccess,
  dmParticipantKey,
  findOrCreateDm,
  listConversationsForUser,
  listDirectory,
  listMessages,
  markConversationRead,
  nextMessageCreatedAt,
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

test('nextMessageCreatedAt stays strictly increasing under clock ties', () => {
  const stamp = '2026-11-08T01:00:00.000Z';
  const next = nextMessageCreatedAt(stamp, Date.parse(stamp));
  assert.ok(next > stamp);
  assert.equal(nextMessageCreatedAt(null, Date.parse(stamp)), stamp);
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
    assert.ok(Number(page.data[0].seq) < Number(page.data[1].seq));
    assert.ok(String(page.data[0].createdAt) <= String(page.data[1].createdAt));

    // Same createdAt must still return chronological order via seq (prod flake root cause).
    const tiedAt = String(page.data[1].createdAt);
    await ChatMessage.create({
      conversationId: conversation.id,
      senderId: aliceId,
      body: 'Follow up',
      seq: 3,
      readBy: [aliceId],
      createdAt: tiedAt,
    });
    const conversationRow = await ChatConversation.findById(conversation.id);
    conversationRow.messageSeq = 3;
    conversationRow.lastMessageAt = tiedAt;
    conversationRow.lastMessagePreview = 'Follow up';
    conversationRow.lastSenderId = aliceId;
    await conversationRow.save();

    const pageTied = await listMessages(conversation.id, aliceId, { page: 1, limit: 20 });
    assert.deepEqual(
      pageTied.data.map((row) => row.body),
      ['Hello Bob', 'Hi Alice', 'Follow up'],
    );

    await markConversationRead(conversation.id, aliceId);
    const unreadAfter = await unreadTotalForUser(aliceId);
    assert.ok(unreadAfter < unreadBefore || unreadAfter === 0);

    const conversations = await ChatConversation.find({ _id: conversation.id });
    assert.equal(conversations.length, 1);
    const messages = await ChatMessage.find({ conversationId: conversation.id });
    assert.equal(messages.length, 3);
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

test('DM access rejects non-participants and forged conversation ids', async () => {
  const stamp = Date.now();
  const alice = await seedUser(`priv_a_${stamp}`);
  const bob = await seedUser(`priv_b_${stamp}`);
  const eve = await seedUser(`priv_e_${stamp}`);
  const aliceId = String(alice._id);
  const bobId = String(bob._id);
  const eveId = String(eve._id);

  try {
    const conversation = await findOrCreateDm(aliceId, bobId);
    await sendMessage(conversation.id, aliceId, 'Private note');

    await assert.rejects(
      () => listMessages(conversation.id, eveId),
      (err) => err?.status === 404 || err?.code === 'NOT_FOUND',
    );
    await assert.rejects(
      () => sendMessage(conversation.id, eveId, 'Intrusion'),
      (err) => err?.status === 404 || err?.code === 'NOT_FOUND',
    );
    await assert.rejects(
      () => markConversationRead(conversation.id, eveId),
      (err) => err?.status === 404 || err?.code === 'NOT_FOUND',
    );
    await assert.rejects(
      () => assertConversationAccess(conversation.id, eveId),
      (err) => err?.status === 404 || err?.code === 'NOT_FOUND',
    );
    await assert.rejects(
      () => authorizeChatSocketAccess(eveId, conversation.id),
      (err) => err?.status === 404 || err?.code === 'NOT_FOUND',
    );
    await assert.rejects(
      () => listMessages('forged-conversation-id', aliceId),
      (err) => err?.status === 404 || err?.code === 'NOT_FOUND',
    );

    const eveList = await listConversationsForUser(eveId);
    assert.ok(!eveList.some((row) => row.id === conversation.id));

    const allowed = await assertConversationAccess(conversation.id, bobId);
    assert.equal(String(allowed._id), conversation.id);
  } finally {
    try {
      alice.isDeleted = true;
      bob.isDeleted = true;
      eve.isDeleted = true;
      await alice.save();
      await bob.save();
      await eve.save();
    } catch {
      /* ignore */
    }
  }
});

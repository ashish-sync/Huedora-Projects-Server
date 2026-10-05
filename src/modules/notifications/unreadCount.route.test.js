/**
 * Route-level check: same unread badge payload + If-None-Match yields 304.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { Notification } from './notification.model.js';
import { shouldReturnNotModified, weakUnreadEtag } from './unreadCountBadge.js';
import { buildUnreadBadgeFilter } from './notificationQuery.js';

async function seedUnread(userId) {
  const now = new Date().toISOString();
  // Use a real Approvals type (CAMP_REVIEW is FYI / Updates now).
  const row = await Notification.create({
    userId: String(userId),
    type: 'ASSET_REQUEST_APPROVAL',
    title: 'Hiring request HR-1 needs approval',
    body: 'test',
    kind: 'approval',
    priority: 'important',
    module: 'assets',
    readAt: null,
    createdAt: now,
    updatedAt: now,
  });
  return row;
}

test('unread badge ETag flow returns 304 when counts unchanged', async () => {
  const userId = `u-etag-${Date.now()}`;
  const created = await seedUnread(userId);
  try {
    const approvalFilter = buildUnreadBadgeFilter(userId, 'approvals');
    const fyiFilter = buildUnreadBadgeFilter(userId, 'updates', { informational: '1' });

    const [approvals, fyi, sample] = await Promise.all([
      Notification.countDocuments(approvalFilter),
      Notification.countDocuments(fyiFilter),
      Notification.find(approvalFilter).sort({ createdAt: -1 }).limit(8).select('_id'),
    ]);
    const sampleIds = sample.map((n) => String(n._id));
    const etag = weakUnreadEtag(approvals, fyi, sampleIds);

    assert.ok(approvals >= 1);
    assert.equal(shouldReturnNotModified(etag, etag), true);

    // Second identical computation (simulates next poll) must match.
    const [approvals2, fyi2, sample2] = await Promise.all([
      Notification.countDocuments(approvalFilter),
      Notification.countDocuments(fyiFilter),
      Notification.find(approvalFilter).sort({ createdAt: -1 }).limit(8).select('_id'),
    ]);
    const etag2 = weakUnreadEtag(
      approvals2,
      fyi2,
      sample2.map((n) => String(n._id)),
    );
    assert.equal(etag2, etag);
    assert.equal(shouldReturnNotModified(etag, etag2), true);

    // Express smoke: header path returns 304 without body.
    const app = express();
    app.get('/unread-count', (req, res) => {
      res.setHeader('ETag', etag);
      if (shouldReturnNotModified(req.headers['if-none-match'], etag)) {
        return res.status(304).end();
      }
      return res.json({ data: { approvals, fyi, sampleIds } });
    });

    const server = await new Promise((resolve) => {
      const s = app.listen(0, () => resolve(s));
    });
    const { port } = server.address();
    try {
      const first = await fetch(`http://127.0.0.1:${port}/unread-count`);
      assert.equal(first.status, 200);
      const firstEtag = first.headers.get('etag');
      assert.equal(firstEtag, etag);

      const second = await fetch(`http://127.0.0.1:${port}/unread-count`, {
        headers: { 'If-None-Match': firstEtag },
      });
      assert.equal(second.status, 304);
      const body = await second.text();
      assert.equal(body, '');
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  } finally {
    await Notification.deleteOne({ _id: created._id });
  }
});

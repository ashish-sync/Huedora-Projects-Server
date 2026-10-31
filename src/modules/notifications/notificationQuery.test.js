import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  applyInformationalFilter,
  buildBadgeApprovalClause,
  buildCategoryClause,
  buildListFilter,
  buildUnreadBadgeFilter,
  passesCategorySafety,
  resolveNotificationKind,
} from './notificationQuery.js';

describe('notificationQuery', () => {
  it('resolves approval vs update kinds', () => {
    assert.equal(
      resolveNotificationKind({ type: 'CAMP_REVIEW', title: 'Camp 26-08-0012 needs approval' }),
      'update'
    );
    assert.equal(
      resolveNotificationKind({ type: 'CAMP_APPROVED', title: 'Camp approved', meta: { kind: 'update' } }),
      'update'
    );
    assert.equal(
      resolveNotificationKind({
        type: 'ASSET_REQUEST_APPROVAL',
        title: 'Request X needs approval',
      }),
      'approval'
    );
  });

  it('builds approvals category with kind/type/title fallbacks and excludes camp FYI', () => {
    const clause = buildCategoryClause('approvals');
    assert.ok(clause.$and?.some((part) => part.type?.$nin?.includes('CAMP_REVIEW')));
    const or = clause.$and.find((part) => Array.isArray(part.$or))?.$or || [];
    assert.ok(or.some((part) => part.kind === 'approval'));
    assert.ok(or.some((part) => part.type?.$in?.includes('PICKLIST_SUGGESTION')));
    assert.ok(or.some((part) => part.type?.$in?.includes('CAMP_HCW_GAP_APPROVAL')));
    assert.ok(or.some((part) => part.type?.$in?.includes('CAMP_T2_APPROVAL')));
    assert.ok(or.some((part) => part.type?.$in?.includes('ASSET_CREATE_APPROVAL')));
    assert.ok(!or.some((part) => part.type?.$in?.includes('CAMP_REVIEW')));
  });

  it('hides informational FYI on Updates unless opted in', () => {
    const hidden = applyInformationalFilter({ $and: [] }, {}, 'updates');
    assert.deepEqual(hidden.$and.at(-1), { priority: { $in: ['important', 'critical'] } });

    const shown = applyInformationalFilter({ $and: [] }, { informational: '1' }, 'updates');
    assert.equal(shown.$and.length, 0);
  });

  it('builds list filter with unread + category', () => {
    const filter = buildListFilter('user-1', {
      unread: 'true',
      category: 'approvals',
    });
    assert.equal(filter.userId, 'user-1');
    assert.equal(filter.readAt, null);
    assert.ok(Array.isArray(filter.$and));
    assert.ok(
      filter.$and.some((part) => part.$and?.some((inner) => inner.$or?.some((o) => o.kind === 'approval')))
        || filter.$and.some((part) => part.$or?.some((o) => o.kind === 'approval')),
    );
  });

  it('badge approval clause omits title regex for index use', () => {
    const clause = buildBadgeApprovalClause();
    const or = clause.$and.find((part) => Array.isArray(part.$or))?.$or || [];
    assert.ok(or.some((part) => part.kind === 'approval'));
    assert.ok(or.every((part) => !part.title));
    const listClause = buildCategoryClause('approvals');
    const listOr = listClause.$and.find((part) => Array.isArray(part.$or))?.$or || [];
    assert.ok(listOr.some((part) => part.title?.$regex));
  });

  it('builds unread badge filter with kind/type only', () => {
    const filter = buildUnreadBadgeFilter('user-1', 'approvals');
    assert.equal(filter.userId, 'user-1');
    assert.equal(filter.readAt, null);
    assert.ok(
      filter.$and.some((part) => part.$and?.some((inner) => inner.$or?.some((o) => o.kind === 'approval')))
        || filter.$and.some((part) => part.$or?.some((o) => o.kind === 'approval')),
    );
  });

  it('safety-filters title-based approvals out of Updates', () => {
    assert.equal(
      passesCategorySafety(
        { type: 'ASSET_REQUEST_APPROVAL', title: 'Request X needs approval' },
        'updates'
      ),
      false
    );
    assert.equal(
      passesCategorySafety(
        { type: 'ASSET_REQUEST_APPROVAL', title: 'Request X needs approval' },
        'approvals'
      ),
      true
    );
    assert.equal(
      passesCategorySafety(
        { type: 'CAMP_REVIEW', title: 'Camp 26-08-0012 needs approval', meta: { kind: 'approval' } },
        'approvals'
      ),
      false
    );
    assert.equal(
      passesCategorySafety(
        { type: 'CAMP_REVIEW', title: 'Camp 26-08-0012 needs approval' },
        'updates'
      ),
      true
    );
  });

  it('builds reviews and team category clauses', () => {
    const reviews = buildCategoryClause('reviews');
    assert.ok(reviews.$or.some((part) => part.kind === 'review'));

    const team = buildCategoryClause('team', { userId: 'mgr-1' });
    assert.ok(team.$and.some((part) => part['meta.involvement'] === 'inform'));
    assert.ok(team.$and.some((part) => part.$or?.some((inner) => inner['meta.managerId'] === 'mgr-1')));
  });

  it('resolves review kind from involvement', () => {
    assert.equal(
      resolveNotificationKind({ type: 'CAMP_OFF_HOURS', meta: { kind: 'review', involvement: 'review' } }),
      'review'
    );
    assert.equal(
      resolveNotificationKind({ type: 'COMMERCIAL_SUBMIT', meta: { kind: 'approval', involvement: 'approve' } }),
      'approval'
    );
  });

  it('safety-filters reviews out of Approvals and Updates', () => {
    const review = {
      type: 'CAMP_REVIEW_OVERDUE',
      kind: 'review',
      meta: { kind: 'review', involvement: 'review' },
    };
    assert.equal(passesCategorySafety(review, 'reviews'), true);
    assert.equal(passesCategorySafety(review, 'approvals'), false);
    assert.equal(passesCategorySafety(review, 'updates'), false);
    assert.equal(
      passesCategorySafety(
        { type: 'CAMP_REVIEW', kind: 'update', meta: { involvement: 'inform', managerId: 'mgr-1' } },
        'team'
      ),
      true
    );
  });
});

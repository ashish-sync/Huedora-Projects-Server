import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  applyInformationalFilter,
  buildCategoryClause,
  buildListFilter,
  passesCategorySafety,
  resolveNotificationKind,
} from './notificationQuery.js';

describe('notificationQuery', () => {
  it('resolves approval vs update kinds', () => {
    assert.equal(
      resolveNotificationKind({ type: 'CAMP_REVIEW', title: 'Camp needs review' }),
      'approval'
    );
    assert.equal(
      resolveNotificationKind({ type: 'CAMP_APPROVED', title: 'Camp approved', meta: { kind: 'update' } }),
      'update'
    );
  });

  it('builds approvals category with kind/type/title fallbacks', () => {
    const clause = buildCategoryClause('approvals');
    assert.ok(clause.$or.some((part) => part.kind === 'approval'));
    assert.ok(clause.$or.some((part) => part.type?.$in?.includes('CAMP_REVIEW')));
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
    assert.ok(filter.$and.some((part) => part.$or?.some((o) => o.kind === 'approval')));
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
  });
});

/**
 * Cross-collection atomic writes for Mongo (transactions) and file mode (serialize + rollback).
 */
import {
  getPersistenceMode,
  getMongoDb,
  bulkUpsertDocuments,
} from './persistence.js';

const globalAtomic = { chain: Promise.resolve() };

function withGlobalAtomicLock(fn) {
  const run = globalAtomic.chain.then(fn, fn);
  globalAtomic.chain = run.then(
    () => undefined,
    () => undefined
  );
  return run;
}

/**
 * @param {(ctx: { mode: string, session: import('mongodb').ClientSession|null }) => Promise<{
 *   upserts?: Array<{ collection: string, docs: object[] }>,
 *   result?: any
 * }>} prepare
 */
export async function runAtomic(prepare) {
  const mode = getPersistenceMode();

  if (mode === 'mongo') {
    const db = getMongoDb();
    if (!db?.client) {
      // Fallback: still serialize writes in-process
      return withGlobalAtomicLock(async () => {
        const plan = await prepare({ mode: 'mongo', session: null });
        await applyUpserts(plan?.upserts || [], null);
        return plan?.result;
      });
    }
    const session = db.client.startSession();
    try {
      let result;
      await session.withTransaction(async () => {
        const plan = await prepare({ mode: 'mongo', session });
        await applyUpserts(plan?.upserts || [], session);
        result = plan?.result;
      });
      return result;
    } catch (err) {
      // Standalone / memory Mongo without replica-set transactions
      if (/Transaction numbers|replica set|transactions are not supported/i.test(String(err?.message || ''))) {
        return withGlobalAtomicLock(async () => {
          const plan = await prepare({ mode: 'mongo', session: null });
          await applyUpserts(plan?.upserts || [], null);
          return plan?.result;
        });
      }
      throw err;
    } finally {
      await session.endSession().catch(() => undefined);
    }
  }

  return withGlobalAtomicLock(async () => {
    const plan = await prepare({ mode: 'file', session: null });
    const upserts = plan?.upserts || [];
    const snapshots = [];
    try {
      for (const group of upserts) {
        for (const doc of group.docs || []) {
          snapshots.push({
            collection: group.collection,
            before: await loadDocSnapshot(group.collection, doc._id),
            afterId: doc._id,
          });
        }
        await applyUpserts([group], null);
      }
      return plan?.result;
    } catch (err) {
      for (const snap of snapshots.reverse()) {
        try {
          if (snap.before) {
            await bulkUpsertDocuments(snap.collection, [snap.before], { replace: true });
          }
        } catch {
          /* best-effort rollback */
        }
      }
      throw err;
    }
  });
}

async function loadDocSnapshot(collection, id) {
  const { loadCollection } = await import('./persistence.js');
  const { idsEqual } = await import('../utils/entityIds.js');
  const rows = await loadCollection(collection);
  const hit = rows.find((r) => idsEqual(r._id, id));
  return hit ? JSON.parse(JSON.stringify(hit)) : null;
}

async function applyUpserts(groups, session) {
  for (const group of groups) {
    if (!group?.docs?.length) continue;
    await bulkUpsertDocuments(group.collection, group.docs, {
      session,
      replace: group.replace !== false,
    });
  }
}

/**
 * Optional background worker entrypoint.
 * On Render free plan the web dyno still runs heavy jobs in-process via gates;
 * set SERVICE_ROLE=worker on a separate paid Background Worker to isolate load.
 *
 * Usage: node src/worker.js
 */
import { connectDb } from './config/db.js';
import { heavyJobGateStats } from './jobs/heavyJobGate.js';
import { mediaQueueStats, requeueStuckMediaJobs } from './storage/media/mediaQueue.js';
import { imageProcessGateStats } from './storage/media/imageProcessGate.js';

async function main() {
  process.env.SERVICE_ROLE = process.env.SERVICE_ROLE || 'worker';
  console.log('[worker] starting background worker');
  await connectDb();

  try {
    const r = await requeueStuckMediaJobs();
    console.log('[worker] media requeue', r);
  } catch (err) {
    console.error('[worker] media requeue failed:', err?.message || err);
  }

  const tick = () => {
    console.log(
      '[worker] heartbeat',
      JSON.stringify({
        heavy: heavyJobGateStats(),
        media: mediaQueueStats(),
        image: imageProcessGateStats(),
        rssMb: Math.round(process.memoryUsage().rss / (1024 * 1024)),
      }),
    );
  };
  tick();
  setInterval(tick, 60_000);

  // Keep process alive; media queue pumps itself when jobs are enqueued.
  // Shared Mongo + R2; web can enqueue, worker drains if ROLE split is enabled later.
  console.log('[worker] ready (in-process media + heavy job gates)');
}

main().catch((err) => {
  console.error('[worker] fatal:', err);
  process.exit(1);
});

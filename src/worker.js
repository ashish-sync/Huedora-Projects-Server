/**
 * Optional background worker entrypoint.
 * Drains durable media + heavy job queues so the web process stays responsive.
 *
 * Usage: node src/worker.js
 * Render: uncomment worker service in render.yaml (paid plan).
 */
import { connectDb } from './config/db.js';
import { heavyJobGateStats } from './jobs/heavyJobGate.js';
import {
  ensureHeavyJobPump,
  drainHeavyJobs,
  heavyJobQueueStats,
} from './jobs/heavyJobQueue.js';
import { mediaQueueStats, requeueStuckMediaJobs } from './storage/media/mediaQueue.js';
import { imageProcessGateStats } from './storage/media/imageProcessGate.js';

async function main() {
  process.env.SERVICE_ROLE = process.env.SERVICE_ROLE || 'worker';
  console.log('[worker] starting background worker');
  await connectDb();

  try {
    const { registerCollection } = await import('./store/persistence.js');
    registerCollection('heavy_jobs');
  } catch {
    /* ignore */
  }

  try {
    const r = await requeueStuckMediaJobs();
    console.log('[worker] media requeue', r);
  } catch (err) {
    console.error('[worker] media requeue failed:', err?.message || err);
  }

  ensureHeavyJobPump();
  await drainHeavyJobs({ limit: 5 });

  const tick = () => {
    console.log(
      '[worker] heartbeat',
      JSON.stringify({
        heavyGate: heavyJobGateStats(),
        heavyQueue: heavyJobQueueStats(),
        media: mediaQueueStats(),
        image: imageProcessGateStats(),
        eventLoopLagHintMs: Math.round(process.uptime() * 0) || 0,
        rssMb: Math.round(process.memoryUsage().rss / (1024 * 1024)),
      }),
    );
    void drainHeavyJobs({ limit: 3 });
  };
  tick();
  setInterval(tick, 30_000);

  console.log('[worker] ready — draining media + heavy_jobs');
}

main().catch((err) => {
  console.error('[worker] fatal:', err);
  process.exit(1);
});

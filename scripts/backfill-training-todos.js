/**
 * One-shot: create calendar To-Dos for completed TRAINING schedules missing calendarEventId.
 * Usage: node scripts/backfill-training-todos.js
 */
import { connectDb, disconnectDb } from '../src/config/db.js';
import { AssetRequest } from '../src/modules/assetRequests/assetRequest.model.js';
import { createEvent } from '../src/modules/calendar/calendar.service.js';
import {
  createTrainingTodoForScheduler,
  schedulerIdFromRow,
} from '../src/modules/assetRequests/scheduleTrainingTodo.js';

async function main() {
  await connectDb();
  const rows = await AssetRequest.find({
    isDeleted: { $ne: true },
    requestType: 'TRAINING',
    status: 'COMPLETED',
    scheduledAt: { $ne: null },
  });
  const pending = (rows || []).filter((row) => {
    const scheduledAt = String(row.scheduledAt || '').trim();
    const calendarEventId = String(row.calendarEventId || '').trim();
    return scheduledAt && !calendarEventId;
  });

  console.log(`[backfill-training-todos] candidates=${pending.length}`);
  let created = 0;
  for (const row of pending) {
    const ownerId = schedulerIdFromRow(row);
    if (!ownerId) {
      console.warn(`  skip ${row.requestNumber || row._id}: no scheduler id`);
      continue;
    }
    const calendarEventId = await createTrainingTodoForScheduler({
      row,
      schedule: {
        scheduledAt: row.scheduledAt,
        scheduleVenue: row.scheduleVenue,
      },
      ownerId,
      actor: { _id: ownerId },
      createEvent,
    });
    if (!calendarEventId) {
      console.warn(`  fail ${row.requestNumber || row._id}`);
      continue;
    }
    await AssetRequest.findOneAndUpdate(
      { _id: row._id },
      { $set: { calendarEventId } }
    );
    created += 1;
    console.log(
      `  ok ${row.requestNumber || row._id} → ${calendarEventId} @ ${row.scheduledAt}`
    );
  }
  console.log(`[backfill-training-todos] created=${created}`);
  await disconnectDb();
}

main().catch(async (err) => {
  console.error(err);
  try {
    await disconnectDb();
  } catch {
    /* ignore */
  }
  process.exit(1);
});

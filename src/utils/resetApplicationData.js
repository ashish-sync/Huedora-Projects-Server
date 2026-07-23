import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { resetAllData } from '../store/filedb.js';
import { env } from '../config/env.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const uploadsRoot = path.resolve(__dirname, '../../uploads');

function clearDirectory(dir) {
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (fs.statSync(full).isDirectory()) {
      clearDirectory(full);
      fs.rmdirSync(full);
    } else {
      fs.unlinkSync(full);
    }
  }
}

async function resetMongooseData() {
  if (!env.useMongoose) return;
  const mongoose = (await import('mongoose')).default;
  if (mongoose.connection.readyState !== 1) return;
  const db = mongoose.connection.db;
  if (!db) return;
  const collections = await db.listCollections().toArray();
  for (const { name } of collections) {
    await db.dropCollection(name);
  }
}

/** Wipe all persisted application data and uploaded files. */
export async function resetApplicationData() {
  resetAllData();
  await resetMongooseData();
  fs.mkdirSync(uploadsRoot, { recursive: true });
  clearDirectory(uploadsRoot);
  console.warn('[reset] All application data and uploads cleared');
}

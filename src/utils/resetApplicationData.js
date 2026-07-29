import fs from 'fs';
import path from 'path';
import { resetAllData } from '../store/filedb.js';
import { uploadsRoot } from '../config/paths.js';

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

/** Wipe all persisted application data and uploaded files. */
export async function resetApplicationData() {
  await resetAllData();
  fs.mkdirSync(uploadsRoot, { recursive: true });
  clearDirectory(uploadsRoot);
  console.warn('[reset] All application data and uploads cleared');
}

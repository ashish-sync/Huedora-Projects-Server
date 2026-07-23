import { createApp } from './app.js';
import { connectDb } from './config/db.js';
import { env } from './config/env.js';
import { ensureSeed } from './seed.js';
import { resetApplicationData } from './utils/resetApplicationData.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const freshStartTrigger = path.resolve(__dirname, '../.fresh-start');

async function maybeFreshStart() {
  const fromEnv = String(process.env.RESET_ALL_DATA_ON_BOOT || '').toLowerCase() === 'true';
  const fromMarker = fs.existsSync(freshStartTrigger);
  if (!fromEnv && !fromMarker) return;

  await resetApplicationData();
  if (fromMarker) {
    fs.unlinkSync(freshStartTrigger);
    console.warn('[reset] Fresh-start marker consumed (.fresh-start removed)');
  }
  if (fromEnv) {
    console.warn('[reset] RESET_ALL_DATA_ON_BOOT=true — set it back to false after this deploy');
  }
}

async function main() {
  await connectDb();
  await maybeFreshStart();
  await ensureSeed();
  const app = createApp();
  app.listen(env.port, () => {
    console.log(`[api] TYLO One listening on http://localhost:${env.port}`);
  });
}

main().catch((err) => {
  console.error('Failed to start API', err);
  process.exit(1);
});

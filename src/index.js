import { createApp } from './app.js';
import { connectDb } from './config/db.js';
import { env } from './config/env.js';
import { ensureSeed } from './seed.js';

async function main() {
  await connectDb();
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

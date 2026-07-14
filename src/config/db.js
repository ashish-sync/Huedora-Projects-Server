import { env } from './env.js';

/**
 * Persistence:
 * - Default: JSON file store under server/data (no MongoDB install required)
 * - Optional: set USE_MONGOOSE=true and MONGODB_URI for real MongoDB / Atlas
 */
export async function connectDb() {
  if (String(process.env.USE_MONGOOSE || '').toLowerCase() === 'true') {
    const mongoose = (await import('mongoose')).default;
    const { MongoMemoryServer } = await import('mongodb-memory-server');
    let uri = env.mongoUri;
    if (env.useMemoryDb) {
      const memoryServer = await MongoMemoryServer.create();
      uri = memoryServer.getUri('dhub');
      console.log('[db] Using in-memory MongoDB');
    }
    mongoose.set('strictQuery', true);
    await mongoose.connect(uri);
    console.log('[db] Connected via Mongoose');
    return;
  }

  console.log('[db] Using JSON file store at server/data (dev-friendly, Mongo-compatible API)');
  console.log('[db] For production MongoDB/Atlas: set USE_MONGOOSE=true and MONGODB_URI');
}

export async function disconnectDb() {
  if (String(process.env.USE_MONGOOSE || '').toLowerCase() === 'true') {
    const mongoose = (await import('mongoose')).default;
    await mongoose.disconnect();
  }
}

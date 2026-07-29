import { env } from './env.js';
import { dataDir } from './paths.js';
import {
  configurePersistence,
  getPersistenceMode,
  hydratePersistence,
} from '../store/persistence.js';

/**
 * Persistence backends:
 * - file: JSON under DATA_DIR (local dev only — ephemeral on Render)
 * - mongo: MongoDB Atlas via Mongoose connection (required in production)
 */
export async function connectDb() {
  if (env.isProd && !env.useMongoose) {
    throw new Error(
      '[config] Production requires USE_MONGOOSE=true and MONGODB_URI pointing to MongoDB Atlas. '
        + 'JSON file storage is wiped on every Render deploy/restart.',
    );
  }

  if (env.isProd && env.useMemoryDb) {
    throw new Error('[config] USE_MEMORY_DB is not allowed in production');
  }

  if (env.useMongoose) {
    const mongoose = (await import('mongoose')).default;
    let uri = env.mongoUri;

    if (env.useMemoryDb) {
      const { MongoMemoryServer } = await import('mongodb-memory-server');
      const memoryServer = await MongoMemoryServer.create();
      uri = memoryServer.getUri('tylo-one');
      console.log('[db] Using in-memory MongoDB (development only)');
    } else if (env.isProd && !String(uri || '').trim()) {
      throw new Error('[config] MONGODB_URI must be set in production when USE_MONGOOSE=true');
    }

    mongoose.set('strictQuery', true);
    await mongoose.connect(uri);
    configurePersistence({ backend: 'mongo', dataDirectory: dataDir, db: mongoose.connection.db });
    await hydratePersistence();
    console.log(`[db] Connected to MongoDB (${getPersistenceMode()} persistence, database: ${mongoose.connection.name})`);
    return;
  }

  configurePersistence({ backend: 'file', dataDirectory: dataDir });
  await hydratePersistence();
  console.log(`[db] Using JSON file store at ${dataDir} (development only)`);
}

export async function disconnectDb() {
  if (env.useMongoose) {
    const mongoose = (await import('mongoose')).default;
    await mongoose.disconnect();
  }
}

export function getDbInfo() {
  return {
    mode: getPersistenceMode(),
    dataDir,
    useMongoose: env.useMongoose,
    mongoConfigured: Boolean(env.mongoUri),
  };
}

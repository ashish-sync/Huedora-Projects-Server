import { env } from './env.js';
import { dataDir } from './paths.js';
import {
  configurePersistence,
  getPersistenceMode,
  hydratePersistence,
} from '../store/persistence.js';
import { describeMongoTarget, formatMongoConnectError, prepareMongoUri } from './mongoUri.js';

let connectedMongoUri = null;

/**
 * Persistence backends:
 * - file: JSON under DATA_DIR (local dev only — ephemeral on Render)
 * - mongo: MongoDB Atlas via Mongoose connection (required in production)
 */
export async function connectDb() {
  if (env.isProd && !env.useMongoose) {
    throw new Error(
      '[config] Production requires MONGODB_URI (mongodb+srv://...) pointing to MongoDB Atlas. '
        + 'JSON file storage is wiped on every Render deploy/restart.',
    );
  }

  if (env.isProd && env.useMemoryDb) {
    throw new Error('[config] USE_MEMORY_DB is not allowed in production');
  }

  if (env.useMongoose) {
    const mongoose = (await import('mongoose')).default;
    let uri = env.mongoUriRaw || env.mongoUri;

    if (env.useMemoryDb) {
      const { MongoMemoryServer } = await import('mongodb-memory-server');
      const memoryServer = await MongoMemoryServer.create();
      uri = memoryServer.getUri('tylo-one');
      console.log('[db] Using in-memory MongoDB (development only)');
    } else {
      uri = prepareMongoUri(uri, { isProd: env.isProd });
      const target = describeMongoTarget(uri);
      console.log(
        `[db] Connecting to MongoDB (${target.mode}) host=${target.host} database=${target.database}`,
      );
    }

    connectedMongoUri = uri;
    mongoose.set('strictQuery', true);
    try {
      await mongoose.connect(uri, { serverSelectionTimeoutMS: 15000 });
    } catch (err) {
      throw formatMongoConnectError(err, uri);
    }
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
  connectedMongoUri = null;
}

export function getDbInfo() {
  let mongoHost = null;
  if (env.useMongoose) {
    try {
      const uri = connectedMongoUri
        || prepareMongoUri(env.mongoUriRaw || env.mongoUri, { isProd: env.isProd });
      mongoHost = describeMongoTarget(uri).host;
    } catch {
      mongoHost = null;
    }
  }
  return {
    mode: getPersistenceMode(),
    dataDir,
    useMongoose: env.useMongoose,
    mongoConfigured: Boolean(env.mongoUriRaw || env.mongoUri),
    mongoHost,
  };
}

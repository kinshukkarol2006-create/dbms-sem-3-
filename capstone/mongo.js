const fs = require('node:fs');
const path = require('node:path');
const dotenv = require('dotenv');
const { MongoClient } = require('mongodb');

for (const envPath of [path.join(__dirname, '.env'), path.resolve(__dirname, '..', '.env')]) {
  if (fs.existsSync(envPath)) {
    dotenv.config({ path: envPath });
  }
}

let client;
let clientPromise;

async function getDatabase() {
  const uri = (process.env.MONGODB_URI || '').trim();
  if (!uri) {
    const error = new Error('MONGODB_URI is not configured.');
    error.code = 'MONGODB_URI_MISSING';
    throw error;
  }

  if (!clientPromise) {
    client = new MongoClient(uri, {
      maxPoolSize: 10,
      minPoolSize: 0,
      maxIdleTimeMS: 60000,
      serverSelectionTimeoutMS: 10000,
    });
    clientPromise = client.connect().catch((error) => {
      client = undefined;
      clientPromise = undefined;
      throw error;
    });
  }

  const connectedClient = await clientPromise;
  const dbName = (process.env.MONGODB_DB || '').trim() || undefined;
  return connectedClient.db(dbName);
}

async function closeMongoClient() {
  if (!client) return;
  const closingClient = client;
  client = undefined;
  clientPromise = undefined;
  await closingClient.close();
}

module.exports = { closeMongoClient, getDatabase };

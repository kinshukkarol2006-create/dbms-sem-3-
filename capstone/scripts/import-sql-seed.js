const { closeMongoClient, getDatabase } = require('../mongo');
const { applySqlSeed, loadSqlSeedData } = require('../seed');

async function importSqlSeed() {
  const { documents, childCounts } = loadSqlSeedData();
  const counts = Object.fromEntries(Object.entries(documents).map(([name, rows]) => [name, rows.length]));

  if (process.argv.includes('--dry-run')) {
    console.log(JSON.stringify({ documents: counts, embeddedEntries: childCounts }, null, 2));
    return;
  }

  const db = await getDatabase();
  await applySqlSeed(db, { log: true });
}

importSqlSeed()
  .catch((error) => {
    console.error('SQL seed import failed:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closeMongoClient();
  });

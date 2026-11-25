require('dotenv').config();

const fs = require('node:fs');
const path = require('node:path');
const { closeMongoClient, getDatabase } = require('../mongo');

const dateTimeFields = new Set([
  'arrived_at',
  'collected_at',
  'completed_at',
  'created_at',
  'read_at',
  'received_at',
  'requested_at',
  'updated_at',
]);

function splitSqlTuple(tuple) {
  const values = [];
  let start = 0;
  let quoted = false;
  let depth = 0;
  for (let index = 0; index < tuple.length; index += 1) {
    const character = tuple[index];
    if (quoted) {
      if (character === "'" && tuple[index + 1] === "'") {
        index += 1;
      } else if (character === '\\') {
        index += 1;
      } else if (character === "'") {
        quoted = false;
      }
    } else if (character === "'") {
      quoted = true;
    } else if (character === '(') {
      depth += 1;
    } else if (character === ')') {
      depth -= 1;
    } else if (character === ',' && depth === 0) {
      values.push(tuple.slice(start, index).trim());
      start = index + 1;
    }
  }
  values.push(tuple.slice(start).trim());
  return values;
}

function parseSqlValue(value) {
  if (/^NULL$/i.test(value)) return null;
  if (/^TRUE$/i.test(value)) return true;
  if (/^FALSE$/i.test(value)) return false;
  if (value.startsWith("'") && value.endsWith("'")) {
    return value.slice(1, -1)
      .replace(/''/g, "'")
      .replace(/\\'/g, "'")
      .replace(/\\\\/g, '\\');
  }
  const number = Number(value);
  if (Number.isFinite(number)) return number;
  throw new Error(`Unsupported SQL seed value: ${value}`);
}

function parseValueTuples(source) {
  const tuples = [];
  let index = 0;
  while (index < source.length) {
    if (source[index] !== '(') {
      index += 1;
      continue;
    }
    const start = ++index;
    let quoted = false;
    let depth = 1;
    while (index < source.length && depth > 0) {
      const character = source[index];
      if (quoted) {
        if (character === "'" && source[index + 1] === "'") {
          index += 2;
          continue;
        }
        if (character === '\\') {
          index += 2;
          continue;
        }
        if (character === "'") quoted = false;
      } else if (character === "'") {
        quoted = true;
      } else if (character === '(') {
        depth += 1;
      } else if (character === ')') {
        depth -= 1;
      }
      index += 1;
    }
    if (depth !== 0 || quoted) throw new Error('Unterminated SQL seed tuple.');
    tuples.push(splitSqlTuple(source.slice(start, index - 1)).map(parseSqlValue));
  }
  return tuples;
}

function parseSqlInserts(source) {
  const tables = new Map();
  const insertPattern = /INSERT INTO\s+([a-z_]+)\s*\(([\s\S]*?)\)\s*VALUES\s*([\s\S]*?);/gi;
  for (const match of source.matchAll(insertPattern)) {
    const tableName = match[1];
    const columns = match[2].split(',').map((column) => column.trim().replaceAll('`', ''));
    const valueSource = match[3].split(/\bON DUPLICATE KEY UPDATE\b/i, 1)[0];
    const rows = parseValueTuples(valueSource).map((values) => {
      if (values.length !== columns.length) {
        throw new Error(`Column/value count mismatch in ${tableName}: ${columns.length} columns, ${values.length} values.`);
      }
      return Object.fromEntries(columns.map((column, index) => {
        const value = values[index];
        return [column, dateTimeFields.has(column) && typeof value === 'string' ? new Date(`${value.replace(' ', 'T')}Z`) : value];
      }));
    });
    tables.set(tableName, [...(tables.get(tableName) || []), ...rows]);
  }
  return tables;
}

function groupBy(rows, key) {
  const grouped = new Map();
  for (const row of rows) {
    const group = grouped.get(row[key]) || [];
    group.push(row);
    grouped.set(row[key], group);
  }
  return grouped;
}

function buildDocuments(tables) {
  const pickupItems = groupBy(tables.get('pickup_request_items') || [], 'pickup_request_id');
  const routeStops = groupBy(tables.get('route_stops') || [], 'route_id');
  const recyclingItems = groupBy(tables.get('recycling_batch_items') || [], 'batch_id');
  const pickups = (tables.get('pickup_requests') || []).map((pickup) => ({
    ...pickup,
    items: (pickupItems.get(pickup.id) || []).map(({ pickup_request_id, ...item }) => item),
  }));
  const pickupById = new Map(pickups.map((pickup) => [pickup.id, pickup]));
  const collections = (tables.get('collections') || []).map((collection) => {
    const pickup = pickupById.get(collection.pickup_request_id);
    if (!pickup) throw new Error(`Collection ${collection.id} references missing pickup ${collection.pickup_request_id}.`);
    return { ...collection, workspace_id: pickup.workspace_id };
  });
  const routes = (tables.get('collection_routes') || []).map((route) => ({
    ...route,
    stops: (routeStops.get(route.id) || [])
      .sort((left, right) => left.stop_order - right.stop_order)
      .map(({ route_id, ...stop }) => stop),
  }));
  const batches = (tables.get('recycling_batches') || []).map((batch) => ({
    ...batch,
    items: (recyclingItems.get(batch.id) || []).map(({ batch_id, ...item }) => item),
  }));
  const notifications = (tables.get('notifications') || []).map((notification) => ({
    ...notification,
    read_at: null,
  }));

  return {
    organizations: tables.get('organizations') || [],
    users: tables.get('users') || [],
    districts: tables.get('districts') || [],
    device_categories: tables.get('device_categories') || [],
    pickup_requests: pickups,
    collections,
    collection_routes: routes,
    recycling_batches: batches,
    impact_goals: tables.get('impact_goals') || [],
    notifications,
  };
}

async function importSqlSeed() {
  const sqlPath = path.join(__dirname, '..', 'database.sql');
  const tables = parseSqlInserts(fs.readFileSync(sqlPath, 'utf8'));
  const documents = buildDocuments(tables);
  const counts = Object.fromEntries(Object.entries(documents).map(([name, rows]) => [name, rows.length]));
  const childCounts = {
    pickup_request_items: (tables.get('pickup_request_items') || []).length,
    route_stops: (tables.get('route_stops') || []).length,
    recycling_batch_items: (tables.get('recycling_batch_items') || []).length,
  };

  if (process.argv.includes('--dry-run')) {
    console.log(JSON.stringify({ documents: counts, embeddedEntries: childCounts }, null, 2));
    return;
  }

  const db = await getDatabase();
  for (const [collectionName, rows] of Object.entries(documents)) {
    if (!rows.length) continue;
    const collection = db.collection(collectionName);
    const operations = rows.map((row) => ({
      replaceOne: {
        filter: { id: row.id },
        replacement: row,
        upsert: true,
      },
    }));
    const result = await collection.bulkWrite(operations, { ordered: true });
    console.log(`${collectionName}: imported ${rows.length} SQL rows (${result.upsertedCount} added, ${result.modifiedCount} updated).`);
  }

  const counterMaxima = {
    pickup_requests: Math.max(...documents.pickup_requests.map((row) => row.id)),
    collections: Math.max(...documents.collections.map((row) => row.id)),
    notifications: Math.max(...documents.notifications.map((row) => row.id)),
  };
  for (const [name, value] of Object.entries(counterMaxima)) {
    await db.collection('counters').updateOne({ _id: name }, { $max: { sequence_value: value } }, { upsert: true });
  }
  console.log(`Embedded entries: ${JSON.stringify(childCounts)}`);
}

importSqlSeed()
  .catch((error) => {
    console.error('SQL seed import failed:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closeMongoClient();
  });

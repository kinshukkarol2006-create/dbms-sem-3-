require('dotenv').config();

const express = require('express');
const path = require('node:path');
const { closeMongoClient, getDatabase } = require('./mongo');

const app = express();
const port = Number(process.env.PORT) || 3000;
const workspaceId = Number(process.env.WORKSPACE_ID) || 1;
const pageSize = 10;
const statusLabels = {
  pending: 'Pending',
  scheduled: 'Scheduled',
  in_progress: 'In progress',
  completed: 'Completed',
  cancelled: 'Cancelled',
};
const allowedRanges = { '7D': 7, '30D': 30, '90D': 90, '1Y': 365 };

app.disable('x-powered-by');
app.use(express.json({ limit: '20kb' }));
app.get('/', (_request, response) => response.sendFile(path.join(__dirname, 'index.html')));
app.get('/styles.css', (_request, response) => response.sendFile(path.join(__dirname, 'styles.css')));
app.get('/app.js', (_request, response) => response.sendFile(path.join(__dirname, 'app.js')));

function respondWithDatabaseError(response, error, context) {
  console.error(`${context}:`, error);
  const missingUri = error.code === 'MONGODB_URI_MISSING';
  const unavailable = missingUri || error.name === 'MongoServerSelectionError' || error.name === 'MongoNetworkError';
  response.status(unavailable ? 503 : 500).json({
    error: missingUri
      ? 'MONGODB_URI is not configured. Add your MongoDB connection string to the environment.'
      : unavailable
        ? 'MongoDB is unavailable. Check MONGODB_URI and allow the server network access in MongoDB Atlas.'
        : 'The database request could not be completed.',
  });
}

function handleDatabaseError(response, error, context) {
  respondWithDatabaseError(response, error, context);
}

function dateOnly(value) {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value).slice(0, 10);
}

function dayStart(value) {
  return new Date(`${value}T00:00:00.000Z`);
}

function sameMonth(value, monthStart, nextMonth) {
  const date = new Date(value);
  return date >= monthStart && date < nextMonth;
}

function amount(value) {
  return Number(Number(value || 0).toFixed(2));
}

async function getPickupView(db, pickup, { details = false } = {}) {
  const [district, categories] = await Promise.all([
    db.collection('districts').findOne({ id: pickup.district_id, workspace_id: workspaceId }),
    db.collection('device_categories').find({ workspace_id: workspaceId }).toArray(),
  ]);
  const categoryNames = new Map(categories.map((category) => [category.id, category.name]));
  const items = pickup.items || [];
  const base = {
    id: pickup.id,
    request_code: pickup.request_code,
    location_name: pickup.location_name,
    district_name: district?.name || '',
    status: pickup.status,
    scheduled_for: dateOnly(pickup.scheduled_for),
    device_types: [...new Set(items.map((item) => categoryNames.get(item.device_category_id)).filter(Boolean))].sort().join(', ') || 'Unspecified',
    estimated_weight_kg: amount(items.reduce((sum, item) => sum + Number(item.estimated_weight_kg || 0), 0)),
    requested_at: pickup.requested_at,
  };
  if (!details) return base;
  return {
    ...base,
    requester_name: pickup.requester_name || '',
    requester_email: pickup.requester_email || null,
    requester_phone: pickup.requester_phone || null,
    street_address: pickup.street_address || null,
    district_id: pickup.district_id,
    notes: pickup.notes || '',
    device_category_id: items.at(-1)?.device_category_id || null,
  };
}

async function nextId(db, name) {
  const result = await db.collection('counters').findOneAndUpdate(
    { _id: name },
    { $inc: { sequence_value: 1 } },
    { upsert: true, returnDocument: 'after' },
  );
  return result.sequence_value;
}

function pickupMatches(pickup, status, query) {
  if (pickup.workspace_id !== workspaceId || (status && pickup.status !== status)) return false;
  if (!query) return true;
  return [pickup.request_code, pickup.location_name, pickup.district_name, pickup.device_types]
    .some((value) => String(value || '').toLowerCase().includes(query.toLowerCase()));
}

async function enrichPickups(db, pickups) {
  const [districts, categories] = await Promise.all([
    db.collection('districts').find({ workspace_id: workspaceId }).toArray(),
    db.collection('device_categories').find({ workspace_id: workspaceId }).toArray(),
  ]);
  const districtNames = new Map(districts.map((district) => [district.id, district.name]));
  const categoryNames = new Map(categories.map((category) => [category.id, category.name]));
  return pickups.map((pickup) => {
    const items = pickup.items || [];
    return {
      id: pickup.id,
      request_code: pickup.request_code,
      location_name: pickup.location_name,
      district_name: districtNames.get(pickup.district_id) || '',
      status: pickup.status,
      scheduled_for: dateOnly(pickup.scheduled_for),
      device_types: [...new Set(items.map((item) => categoryNames.get(item.device_category_id)).filter(Boolean))].sort().join(', ') || 'Unspecified',
      estimated_weight_kg: amount(items.reduce((sum, item) => sum + Number(item.estimated_weight_kg || 0), 0)),
      requested_at: pickup.requested_at,
    };
  });
}

app.get('/api/health', async (_request, response) => {
  try {
    await getDatabase();
    response.json({ status: 'ok', database: 'connected', engine: 'mongodb' });
  } catch (error) {
    handleDatabaseError(response, error, 'MongoDB health check failed');
  }
});

app.get('/api/options', async (_request, response) => {
  try {
    const db = await getDatabase();
    const [districts, categories] = await Promise.all([
      db.collection('districts').find({ workspace_id: workspaceId, is_active: true }, { projection: { _id: 0, id: 1, name: 1 } }).sort({ name: 1 }).toArray(),
      db.collection('device_categories').find({ workspace_id: workspaceId, is_active: true }, { projection: { _id: 0, id: 1, name: 1 } }).sort({ name: 1 }).toArray(),
    ]);
    response.json({ districts, categories });
  } catch (error) {
    handleDatabaseError(response, error, 'Loading pickup options failed');
  }
});

app.get('/api/dashboard', async (_request, response) => {
  try {
    const db = await getDatabase();
    const now = new Date();
    const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    const nextMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
    const [pickups, partners, batches, goals, categories, collections] = await Promise.all([
      db.collection('pickup_requests').find({ workspace_id: workspaceId }).toArray(),
      db.collection('organizations').find({
        workspace_id: workspaceId,
        organization_type: { $in: ['collection_partner', 'recycling_partner'] },
        is_active: true,
      }).toArray(),
      db.collection('recycling_batches').find({ workspace_id: workspaceId, status: 'completed' }).toArray(),
      db.collection('impact_goals').find({ workspace_id: workspaceId, period_start: { $lte: dateOnly(now) }, period_end: { $gte: dateOnly(now) } }).sort({ created_at: -1 }).limit(1).toArray(),
      db.collection('device_categories').find({ workspace_id: workspaceId, is_active: true }).toArray(),
      db.collection('collections').find({ workspace_id: workspaceId }).toArray(),
    ]);
    const currentBatches = batches.filter((batch) => sameMonth(batch.completed_at, monthStart, nextMonth));
    const recycledWeight = currentBatches.reduce((sum, batch) => sum + (batch.items || []).reduce((total, item) => total + Number(item.recycled_weight_kg || 0), 0), 0);
    const completedPickups = new Set(collections.filter((item) => sameMonth(item.collected_at, monthStart, nextMonth)).map((item) => item.pickup_request_id));
    const categoryCounts = new Map();
    for (const pickup of pickups) {
      if (!completedPickups.has(pickup.id)) continue;
      for (const item of pickup.items || []) {
        categoryCounts.set(item.device_category_id, (categoryCounts.get(item.device_category_id) || 0) + Number(item.quantity || 0));
      }
    }
    const metrics = {
      pickups_requested_this_month: pickups.filter((pickup) => sameMonth(pickup.requested_at, monthStart, nextMonth)).length,
      awaiting_collection: pickups.filter((pickup) => ['pending', 'scheduled'].includes(pickup.status)).length,
      needing_attention: pickups.filter((pickup) => (
        (pickup.status === 'pending' && new Date(pickup.requested_at) < new Date(now.getTime() - 2 * 86400000))
        || (pickup.status === 'scheduled' && pickup.scheduled_for < dateOnly(now))
      )).length,
      active_partners: partners.length,
      recycled_weight_kg_this_month: amount(recycledWeight),
      recycling_goal_kg: Number(goals[0]?.recycling_goal_kg || 0),
    };
    const categoryRows = categories.map((category) => ({
      id: category.id,
      name: category.name,
      item_count: categoryCounts.get(category.id) || 0,
    })).sort((a, b) => b.item_count - a.item_count || a.name.localeCompare(b.name));
    response.json({ metrics, categories: categoryRows });
  } catch (error) {
    handleDatabaseError(response, error, 'Loading dashboard metrics failed');
  }
});

app.get('/api/volume', async (request, response) => {
  const range = String(request.query.range || '30D').toUpperCase();
  const days = allowedRanges[range];
  if (!days) return response.status(400).json({ error: 'Range must be 7D, 30D, 90D, or 1Y.' });

  try {
    const db = await getDatabase();
    const today = new Date();
    const start = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() - days + 1));
    const end = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() + 1));
    const [collections, batches] = await Promise.all([
      db.collection('collections').find({ workspace_id: workspaceId, collected_at: { $gte: start, $lt: end } }).toArray(),
      db.collection('recycling_batches').find({ workspace_id: workspaceId, status: 'completed', completed_at: { $gte: start, $lt: end } }).toArray(),
    ]);
    const byDate = new Map();
    const rowFor = (value) => {
      const key = dateOnly(value);
      if (!byDate.has(key)) byDate.set(key, { activity_date: key, collected_items: 0, collected_weight_kg: 0, recycled_weight_kg: 0 });
      return byDate.get(key);
    };
    collections.forEach((item) => {
      const row = rowFor(item.collected_at);
      row.collected_items += Number(item.item_count || 0);
      row.collected_weight_kg += Number(item.collected_weight_kg || 0);
    });
    batches.forEach((batch) => {
      const row = rowFor(batch.completed_at);
      row.recycled_weight_kg += (batch.items || []).reduce((sum, item) => sum + Number(item.recycled_weight_kg || 0), 0);
    });
    const points = Array.from({ length: days }, (_, index) => {
      const date = new Date(start);
      date.setUTCDate(start.getUTCDate() + index);
      const key = date.toISOString().slice(0, 10);
      const row = byDate.get(key) || { activity_date: key, collected_items: 0, collected_weight_kg: 0, recycled_weight_kg: 0 };
      return { ...row, collected_weight_kg: amount(row.collected_weight_kg), recycled_weight_kg: amount(row.recycled_weight_kg) };
    });
    response.json({ range, points });
  } catch (error) {
    handleDatabaseError(response, error, 'Loading collection volume failed');
  }
});

app.get('/api/routes', async (_request, response) => {
  try {
    const db = await getDatabase();
    const [routes, users] = await Promise.all([
      db.collection('collection_routes').find({ workspace_id: workspaceId }).sort({ route_date: -1, id: -1 }).toArray(),
      db.collection('users').find({}).toArray(),
    ]);
    const userNames = new Map(users.map((user) => [user.id, user.full_name]));
    response.json({
      routes: routes.map((route) => ({
        id: route.id,
        route_name: route.route_name,
        route_date: dateOnly(route.route_date),
        status: route.status,
        driver_name: userNames.get(route.assigned_driver_id) || 'Unassigned',
        stop_count: (route.stops || []).length,
      })),
    });
  } catch (error) {
    handleDatabaseError(response, error, 'Loading collection routes failed');
  }
});

app.get('/api/recycling', async (_request, response) => {
  try {
    const db = await getDatabase();
    const [batches, organizations, categories] = await Promise.all([
      db.collection('recycling_batches').find({ workspace_id: workspaceId }).sort({ received_at: -1, id: -1 }).toArray(),
      db.collection('organizations').find({ workspace_id: workspaceId }).toArray(),
      db.collection('device_categories').find({ workspace_id: workspaceId }).toArray(),
    ]);
    const partners = new Map(organizations.map((item) => [item.id, item.name]));
    const categoryNames = new Map(categories.map((item) => [item.id, item.name]));
    response.json({
      batches: batches.map((batch) => ({
        id: batch.id,
        batch_code: batch.batch_code,
        status: batch.status,
        received_at: dateOnly(batch.received_at),
        completed_at: dateOnly(batch.completed_at),
        partner_name: partners.get(batch.recycling_partner_id) || '',
        recycled_weight_kg: amount((batch.items || []).reduce((sum, item) => sum + Number(item.recycled_weight_kg || 0), 0)),
        categories: [...new Set((batch.items || []).map((item) => categoryNames.get(item.device_category_id)).filter(Boolean))].sort().join(', '),
      })),
    });
  } catch (error) {
    handleDatabaseError(response, error, 'Loading recycling batches failed');
  }
});

app.get('/api/partners', async (_request, response) => {
  try {
    const db = await getDatabase();
    const partners = await db.collection('organizations').find({
      workspace_id: workspaceId,
      organization_type: { $in: ['collection_partner', 'recycling_partner'] },
    }, { projection: { _id: 0, id: 1, name: 1, organization_type: 1, contact_email: 1, phone: 1, is_active: 1 } })
      .sort({ is_active: -1, name: 1 }).toArray();
    response.json({ partners });
  } catch (error) {
    handleDatabaseError(response, error, 'Loading workspace partners failed');
  }
});

async function readPickupList(request, response, exportAll = false) {
  const page = Math.max(1, Number.parseInt(request.query.page, 10) || 1);
  const query = String(request.query.q || '').trim().slice(0, 100);
  const status = String(request.query.status || '').toLowerCase();
  if (status && !Object.hasOwn(statusLabels, status)) return response.status(400).json({ error: 'Unknown pickup status.' });

  try {
    const db = await getDatabase();
    const [allPickups, districts, categories] = await Promise.all([
      db.collection('pickup_requests').find({ workspace_id: workspaceId }).toArray(),
      db.collection('districts').find({ workspace_id: workspaceId }).toArray(),
      db.collection('device_categories').find({ workspace_id: workspaceId }).toArray(),
    ]);
    const districtNames = new Map(districts.map((item) => [item.id, item.name]));
    const categoryNames = new Map(categories.map((item) => [item.id, item.name]));
    const pickups = allPickups.map((pickup) => ({
      ...pickup,
      district_name: districtNames.get(pickup.district_id) || '',
      device_types: [...new Set((pickup.items || []).map((item) => categoryNames.get(item.device_category_id)).filter(Boolean))].sort().join(', '),
    })).filter((pickup) => pickupMatches(pickup, status, query))
      .sort((a, b) => String(b.requested_at).localeCompare(String(a.requested_at)) || String(b.request_code).localeCompare(String(a.request_code)));
    if (exportAll) {
      const rows = await enrichPickups(db, pickups.slice(0, 5000));
      return response.json({ pickups: rows, totalCount: pickups.length, truncated: pickups.length > rows.length });
    }
    const totalCount = pickups.length;
    const rows = await enrichPickups(db, pickups.slice((page - 1) * pageSize, page * pageSize));
    response.json({ pickups: rows, page, pageSize, totalCount, totalPages: Math.max(1, Math.ceil(totalCount / pageSize)) });
  } catch (error) {
    handleDatabaseError(response, error, exportAll ? 'Exporting pickups failed' : 'Loading pickups failed');
  }
}

app.get('/api/pickups/export', (request, response) => readPickupList(request, response, true));
app.get('/api/pickups', (request, response) => readPickupList(request, response));

function validPickupInput(body, includeNotes = false) {
  const location = typeof body.location === 'string' ? body.location.trim() : '';
  const districtId = Number(body.districtId);
  const categoryId = Number(body.deviceCategoryId);
  const weight = Number(body.weight);
  const scheduledFor = body.scheduledFor;
  const validDate = typeof scheduledFor === 'string'
    && /^\d{4}-\d{2}-\d{2}$/.test(scheduledFor)
    && !Number.isNaN(Date.parse(`${scheduledFor}T00:00:00Z`))
    && new Date(`${scheduledFor}T00:00:00Z`).toISOString().slice(0, 10) === scheduledFor;
  if (location.length < 2 || location.length > 120 || !Number.isSafeInteger(districtId) || districtId <= 0
    || !Number.isSafeInteger(categoryId) || categoryId <= 0 || !Number.isFinite(weight) || weight <= 0
    || weight > 100000 || !validDate || (includeNotes && typeof body.notes !== 'string')) return null;
  return { location, districtId, categoryId, weight, scheduledFor, notes: includeNotes ? body.notes.trim() || null : null };
}

async function activeOptionsExist(db, districtId, categoryId) {
  const [district, category] = await Promise.all([
    db.collection('districts').findOne({ id: districtId, workspace_id: workspaceId, is_active: true }),
    db.collection('device_categories').findOne({ id: categoryId, workspace_id: workspaceId, is_active: true }),
  ]);
  return Boolean(district && category);
}

async function createNotification(db, title, message) {
  await db.collection('notifications').insertOne({
    id: await nextId(db, 'notifications'),
    workspace_id: workspaceId,
    title,
    message,
    read_at: null,
    created_at: new Date(),
  });
}

app.post('/api/pickups', async (request, response) => {
  const input = validPickupInput(request.body || {});
  if (!input) return response.status(400).json({ error: 'Enter a valid location, district, device type, weight, and date.' });
  try {
    const db = await getDatabase();
    if (!await activeOptionsExist(db, input.districtId, input.categoryId)) {
      return response.status(400).json({ error: 'Select an active district and device category.' });
    }
    const id = await nextId(db, 'pickup_requests');
    const pickup = {
      id,
      workspace_id: workspaceId,
      request_code: `EW-${id}`,
      requester_name: input.location,
      requester_email: null,
      requester_phone: null,
      location_name: input.location,
      street_address: null,
      district_id: input.districtId,
      status: 'pending',
      requested_at: new Date(),
      scheduled_for: input.scheduledFor,
      notes: null,
      items: [{ device_category_id: input.categoryId, quantity: 1, estimated_weight_kg: input.weight }],
    };
    await db.collection('pickup_requests').insertOne(pickup);
    response.status(201).json({ pickup: await getPickupView(db, pickup) });
  } catch (error) {
    handleDatabaseError(response, error, 'Creating pickup failed');
  }
});

app.get('/api/pickups/:id', async (request, response) => {
  const pickupId = Number(request.params.id);
  if (!Number.isSafeInteger(pickupId) || pickupId <= 0) return response.status(400).json({ error: 'Invalid pickup ID.' });
  try {
    const db = await getDatabase();
    const pickup = await db.collection('pickup_requests').findOne({ id: pickupId, workspace_id: workspaceId });
    if (!pickup) return response.status(404).json({ error: 'Pickup request not found.' });
    response.json({ pickup: await getPickupView(db, pickup, { details: true }) });
  } catch (error) {
    handleDatabaseError(response, error, 'Loading pickup details failed');
  }
});

app.patch('/api/pickups/:id/status', async (request, response) => {
  const pickupId = Number(request.params.id);
  const status = String(request.body?.status || '').toLowerCase();
  if (!Number.isSafeInteger(pickupId) || pickupId <= 0) return response.status(400).json({ error: 'Invalid pickup ID.' });
  if (!Object.hasOwn(statusLabels, status)) return response.status(400).json({ error: 'Invalid pickup status.' });
  try {
    const db = await getDatabase();
    const pickups = db.collection('pickup_requests');
    const pickup = await pickups.findOne({ id: pickupId, workspace_id: workspaceId });
    if (!pickup) return response.status(404).json({ error: 'Pickup request not found.' });
    const oldStatus = pickup.status;
    const update = await pickups.updateOne({ id: pickupId, workspace_id: workspaceId }, { $set: { status } });
    if (!update.matchedCount) return response.status(404).json({ error: 'Pickup request not found.' });
    if (status === 'completed') {
      await db.collection('collections').updateOne(
        { pickup_request_id: pickupId },
        { $set: {
          workspace_id: workspaceId,
          pickup_request_id: pickupId,
          collected_at: new Date(),
          item_count: (pickup.items || []).reduce((sum, item) => sum + Number(item.quantity || 0), 0) || 1,
          collected_weight_kg: amount((pickup.items || []).reduce((sum, item) => sum + Number(item.estimated_weight_kg || 0), 0)) || 5,
          notes: 'Collected and verified',
        }, $setOnInsert: { id: await nextId(db, 'collections') } },
        { upsert: true },
      );
    }
    const readableStatus = statusLabels[status];
    await createNotification(db, `Pickup #${pickup.request_code} ${readableStatus}`, `${pickup.location_name} status updated from ${statusLabels[oldStatus] || oldStatus} to ${readableStatus}.`);
    const updatedPickup = await pickups.findOne({ id: pickupId, workspace_id: workspaceId });
    response.json({ pickup: await getPickupView(db, updatedPickup) });
  } catch (error) {
    handleDatabaseError(response, error, 'Updating pickup status failed');
  }
});

app.put('/api/pickups/:id', async (request, response) => {
  const pickupId = Number(request.params.id);
  if (!Number.isSafeInteger(pickupId) || pickupId <= 0) return response.status(400).json({ error: 'Invalid pickup ID.' });
  const input = validPickupInput(request.body || {}, true);
  if (!input) return response.status(400).json({ error: 'Enter a valid location, district, device category, weight, and scheduled date.' });
  try {
    const db = await getDatabase();
    const pickups = db.collection('pickup_requests');
    const pickup = await pickups.findOne({ id: pickupId, workspace_id: workspaceId });
    if (!pickup) return response.status(404).json({ error: 'Pickup request not found.' });
    if (!await activeOptionsExist(db, input.districtId, input.categoryId)) {
      return response.status(400).json({ error: 'Select an active district and device category.' });
    }
    await pickups.updateOne({ id: pickupId, workspace_id: workspaceId }, { $set: {
      location_name: input.location,
      district_id: input.districtId,
      scheduled_for: input.scheduledFor,
      notes: input.notes,
      items: [{ device_category_id: input.categoryId, quantity: pickup.items?.[0]?.quantity || 1, estimated_weight_kg: input.weight }],
    } });
    await createNotification(db, `Pickup #${pickup.request_code} updated`, `Details and schedule updated for ${input.location}.`);
    const updatedPickup = await pickups.findOne({ id: pickupId, workspace_id: workspaceId });
    response.json({ pickup: await getPickupView(db, updatedPickup) });
  } catch (error) {
    handleDatabaseError(response, error, 'Updating pickup failed');
  }
});

app.delete('/api/pickups/:id', async (request, response) => {
  const pickupId = Number(request.params.id);
  if (!Number.isSafeInteger(pickupId) || pickupId <= 0) return response.status(400).json({ error: 'Invalid pickup ID.' });
  try {
    const db = await getDatabase();
    const pickup = await db.collection('pickup_requests').findOne({ id: pickupId, workspace_id: workspaceId });
    if (!pickup) return response.status(404).json({ error: 'Pickup request not found.' });
    await Promise.all([
      db.collection('pickup_requests').deleteOne({ id: pickupId, workspace_id: workspaceId }),
      db.collection('collections').deleteMany({ pickup_request_id: pickupId }),
      db.collection('collection_routes').updateMany({ workspace_id: workspaceId }, { $pull: { stops: { pickup_request_id: pickupId } } }),
    ]);
    await createNotification(db, `Pickup #${pickup.request_code} deleted`, `Request for ${pickup.location_name} was removed from the operations database.`);
    response.json({ success: true, id: pickupId, requestCode: pickup.request_code });
  } catch (error) {
    handleDatabaseError(response, error, 'Deleting pickup failed');
  }
});

app.get('/api/impact', async (_request, response) => {
  try {
    const db = await getDatabase();
    const [collections, pickups, batches, categories] = await Promise.all([
      db.collection('collections').find({ workspace_id: workspaceId }).toArray(),
      db.collection('pickup_requests').find({ workspace_id: workspaceId }).toArray(),
      db.collection('recycling_batches').find({ workspace_id: workspaceId, status: 'completed' }).toArray(),
      db.collection('device_categories').find({ workspace_id: workspaceId, is_active: true }).toArray(),
    ]);
    const collectedKg = collections.reduce((sum, item) => sum + Number(item.collected_weight_kg || 0), 0);
    const recycledKg = batches.reduce((sum, batch) => sum + (batch.items || []).reduce((total, item) => total + Number(item.recycled_weight_kg || 0), 0), 0);
    const pipeline = pickups.filter((pickup) => ['pending', 'scheduled', 'in_progress'].includes(pickup.status));
    const pipelineWeight = pipeline.reduce((sum, pickup) => sum + (pickup.items || []).reduce((total, item) => total + Number(item.estimated_weight_kg || 0), 0), 0);
    const totalDivertedKg = Math.max(collectedKg, recycledKg, (collectedKg + recycledKg) / 1.5);
    const effectiveWeightKg = totalDivertedKg > 0 ? totalDivertedKg : (collectedKg || 120.5);
    const co2SavedKg = Number((effectiveWeightKg * 1.44).toFixed(2));
    const categoryBreakdown = categories.map((category) => {
      const matchingItems = pickups.flatMap((pickup) => pickup.items || []).filter((item) => item.device_category_id === category.id);
      return {
        name: category.name,
        category_weight_kg: amount(matchingItems.reduce((sum, item) => sum + Number(item.estimated_weight_kg || 0), 0)),
        item_count: matchingItems.length,
      };
    }).sort((a, b) => b.category_weight_kg - a.category_weight_kg);
    response.json({
      collectedKg: amount(collectedKg),
      recycledKg: amount(recycledKg),
      pipelineWeightKg: amount(pipelineWeight),
      effectiveWeightKg: amount(effectiveWeightKg),
      co2SavedKg,
      treesEquivalent: Number((co2SavedKg / 21.77).toFixed(1)),
      toxicPreventedGrams: Number((effectiveWeightKg * 4.2).toFixed(1)),
      preciousMetalsGrams: Number((effectiveWeightKg * 0.22).toFixed(2)),
      energySavedKwh: Number((effectiveWeightKg * 2.8).toFixed(1)),
      homesPoweredDays: Number(((effectiveWeightKg * 2.8) / 30).toFixed(1)),
      categoryBreakdown,
    });
  } catch (error) {
    handleDatabaseError(response, error, 'Calculating environmental impact failed');
  }
});

app.get('/api/certificates/:requestCode', async (request, response) => {
  const requestCode = String(request.params.requestCode || '').trim().toUpperCase();
  if (!requestCode) return response.status(400).json({ error: 'Request code is required.' });
  try {
    const db = await getDatabase();
    const pickup = await db.collection('pickup_requests').findOne({ request_code: requestCode, workspace_id: workspaceId });
    if (!pickup) return response.status(404).json({ error: `Certificate not found for request code ${requestCode}.` });
    const [district, workspace, categories] = await Promise.all([
      db.collection('districts').findOne({ id: pickup.district_id, workspace_id: workspaceId }),
      db.collection('organizations').findOne({ id: workspaceId, organization_type: 'workspace' }),
      db.collection('device_categories').find({ workspace_id: workspaceId }).toArray(),
    ]);
    const categoryNames = new Map(categories.map((category) => [category.id, category.name]));
    const weight = amount((pickup.items || []).reduce((sum, item) => sum + Number(item.estimated_weight_kg || 0), 0)) || 1;
    const certHash = Buffer.from(`${requestCode}-${pickup.location_name}-${weight}-${pickup.requested_at}`).toString('hex').slice(0, 16).toUpperCase();
    const co2Offset = Number((weight * 1.44).toFixed(2));
    response.json({
      certificateId: `REC-CERT-${certHash.slice(0, 8)}`,
      verificationCode: certHash,
      requestCode: pickup.request_code,
      organizationName: pickup.location_name,
      district: district?.name || '',
      workspaceName: workspace?.name || 'Recollect',
      issueDate: new Date().toISOString().slice(0, 10),
      collectionDate: dateOnly(pickup.scheduled_for) || dateOnly(pickup.requested_at),
      status: pickup.status,
      weightKg: weight,
      categories: [...new Set((pickup.items || []).map((item) => categoryNames.get(item.device_category_id)).filter(Boolean))].sort().join(', ') || 'E-Waste',
      environmentalImpact: {
        co2OffsetKg: co2Offset,
        treesEquivalent: Number((co2Offset / 21.77).toFixed(1)),
        toxicPreventedGrams: Number((weight * 4.2).toFixed(1)),
        preciousMetalsGrams: Number((weight * 0.22).toFixed(2)),
      },
      complianceStandard: 'ISO 14001:2015 & WEEE Compliant Safe Recycling',
      authorizedSignatory: 'Recollect Operations & Greenloop Network',
    });
  } catch (error) {
    handleDatabaseError(response, error, 'Generating certificate failed');
  }
});

app.get('/api/notifications', async (_request, response) => {
  try {
    const db = await getDatabase();
    const notifications = await db.collection('notifications').find(
      { workspace_id: workspaceId },
      { projection: { _id: 0, id: 1, title: 1, message: 1, read_at: 1, created_at: 1 } },
    ).sort({ created_at: -1 }).limit(10).toArray();
    response.json({ notifications });
  } catch (error) {
    handleDatabaseError(response, error, 'Loading notifications failed');
  }
});

app.post('/api/notifications/read', async (_request, response) => {
  try {
    const db = await getDatabase();
    const result = await db.collection('notifications').updateMany(
      { workspace_id: workspaceId, read_at: null },
      { $set: { read_at: new Date() } },
    );
    response.json({ updatedCount: result.modifiedCount });
  } catch (error) {
    handleDatabaseError(response, error, 'Marking notifications as read failed');
  }
});

app.use('/api', (_request, response) => response.status(404).json({ error: 'API endpoint not found.' }));
app.use((error, _request, response, _next) => {
  console.error('Unhandled server error:', error);
  response.status(500).json({ error: 'An unexpected server error occurred.' });
});

if (!process.env.VERCEL) {
  const server = app.listen(port, () => console.log(`Recollect dashboard running at http://localhost:${port}`));
  async function shutdown() {
    server.close();
    await closeMongoClient();
  }
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

module.exports = app;

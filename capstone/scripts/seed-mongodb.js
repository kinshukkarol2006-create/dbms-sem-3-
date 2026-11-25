require('dotenv').config();

const { closeMongoClient, getDatabase } = require('../mongo');

const workspaceId = Number(process.env.WORKSPACE_ID) || 1;
const daysAgo = (days, hour = 12) => {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() - days);
  date.setUTCHours(hour, 0, 0, 0);
  return date;
};
const dateString = (daysAhead) => {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + daysAhead);
  return date.toISOString().slice(0, 10);
};

async function seed() {
  const db = await getDatabase();
  const now = new Date();
  const documents = {
    organizations: [
      { id: workspaceId, workspace_id: null, name: 'Greenloop Co.', organization_type: 'workspace', contact_email: 'ops@greenloop.example', phone: '+1-800-555-0100', is_active: true },
      { id: workspaceId + 1, workspace_id: workspaceId, name: 'Loop Logistics', organization_type: 'collection_partner', contact_email: 'dispatch@looplogistics.example', phone: '+1-800-555-0110', is_active: true },
      { id: workspaceId + 2, workspace_id: workspaceId, name: 'Renew Recycling', organization_type: 'recycling_partner', contact_email: 'hello@renewrecycling.example', phone: '+1-800-555-0120', is_active: true },
      { id: workspaceId + 3, workspace_id: workspaceId, name: 'Circular City Co-op', organization_type: 'collection_partner', contact_email: 'team@circularcity.example', phone: '+1-800-555-0130', is_active: true },
      { id: workspaceId + 4, workspace_id: workspaceId, name: 'Apex Material Recovery', organization_type: 'recycling_partner', contact_email: 'contact@apexrecovery.example', phone: '+1-800-555-0140', is_active: true },
    ],
    users: [
      { id: 1, organization_id: workspaceId, full_name: 'Alex Morgan', role: 'manager', is_active: true },
      { id: 2, organization_id: workspaceId, full_name: 'Sam Rivera', role: 'driver', is_active: true },
      { id: 3, organization_id: workspaceId, full_name: 'Priya Sharma', role: 'dispatcher', is_active: true },
    ],
    districts: ['North District', 'East District', 'Central District', 'West District', 'South District', 'Tech Corridor', 'Industrial Zone', 'University Heights']
      .map((name, index) => ({ id: index + 1, workspace_id: workspaceId, name, is_active: true })),
    device_categories: ['Laptops', 'Mobile phones', 'Monitors', 'Mixed devices', 'Desktops', 'Appliances', 'Network & Servers', 'Lithium Batteries']
      .map((name, index) => ({ id: index + 1, workspace_id: workspaceId, name, is_active: true })),
    pickup_requests: [
      ['Greenfield College', 5, 5, 32.4, 'completed', 12],
      ['Arbor & Co.', 4, 4, 16.8, 'completed', 10],
      ['Pixel Labs', 3, 3, 41, 'completed', 8],
      ['Sunrise Community', 2, 2, 8.2, 'completed', 6],
      ['Brightway Office', 1, 1, 24.5, 'completed', 4],
      ['Apex Tech Hub', 6, 7, 120, 'in_progress', 2],
      ['Horizon Public School', 2, 5, 68, 'scheduled', 1],
      ['FutureWave Robotics', 8, 8, 19.5, 'pending', 0],
      ['Lotus Valley Apartments', 1, 2, 9.8, 'pending', 0],
      ['Cloud9 Coworking', 6, 3, 29, 'cancelled', 3],
    ].map(([location, districtId, categoryId, weight, status, age], index) => {
      const id = 1001 + index;
      return {
        id,
        workspace_id: workspaceId,
        request_code: `EW-${id}`,
        requester_name: location,
        requester_email: null,
        requester_phone: null,
        location_name: location,
        street_address: null,
        district_id: districtId,
        status,
        requested_at: daysAgo(age),
        scheduled_for: dateString(status === 'completed' ? -Math.max(1, age - 1) : 1 + index),
        notes: `Sample e-waste collection request for ${location}.`,
        items: [{ device_category_id: categoryId, quantity: [7, 9, 10, 18, 12, 8, 22, 8, 20, 8][index], estimated_weight_kg: weight }],
      };
    }),
    collections: [
      [1001, 7, 32.4, 12],
      [1002, 9, 16.8, 10],
      [1003, 10, 41, 8],
      [1004, 18, 8.2, 6],
      [1005, 12, 24.5, 4],
    ].map(([pickupId, itemCount, weight, age], index) => ({
      id: index + 1,
      workspace_id: workspaceId,
      pickup_request_id: pickupId,
      collected_at: daysAgo(age),
      item_count: itemCount,
      collected_weight_kg: weight,
      notes: 'Collected and verified',
    })),
    collection_routes: [
      { id: 1, workspace_id: workspaceId, route_name: 'North District AM', route_date: dateString(-2), status: 'completed', assigned_driver_id: 2, stops: [{ pickup_request_id: 1001 }, { pickup_request_id: 1002 }] },
      { id: 2, workspace_id: workspaceId, route_name: 'Central Live Dispatch', route_date: dateString(0), status: 'in_progress', assigned_driver_id: 2, stops: [{ pickup_request_id: 1003 }, { pickup_request_id: 1006 }] },
      { id: 3, workspace_id: workspaceId, route_name: 'East District Sweep', route_date: dateString(2), status: 'planned', assigned_driver_id: 3, stops: [{ pickup_request_id: 1007 }] },
    ],
    recycling_batches: [
      { id: 1, workspace_id: workspaceId, recycling_partner_id: workspaceId + 2, batch_code: 'RB-SAMPLE-001', status: 'completed', received_at: daysAgo(5), completed_at: daysAgo(3), items: [{ device_category_id: 3, recycled_weight_kg: 41 }, { device_category_id: 5, recycled_weight_kg: 32.4 }] },
      { id: 2, workspace_id: workspaceId, recycling_partner_id: workspaceId + 4, batch_code: 'RB-SAMPLE-002', status: 'processing', received_at: daysAgo(1), completed_at: null, items: [{ device_category_id: 1, recycled_weight_kg: 24.5 }] },
    ],
    impact_goals: [{
      id: 1,
      workspace_id: workspaceId,
      period_start: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString().slice(0, 10),
      period_end: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0)).toISOString().slice(0, 10),
      recycling_goal_kg: 500,
      created_at: now,
    }],
    notifications: [
      { id: 1, workspace_id: workspaceId, title: 'Welcome to Recollect', message: 'Your sample operations workspace is ready.', read_at: null, created_at: now },
      { id: 2, workspace_id: workspaceId, title: 'Collection route updated', message: 'Central Live Dispatch is in progress.', read_at: null, created_at: daysAgo(1) },
    ],
  };

  for (const [collectionName, rows] of Object.entries(documents)) {
    const collection = db.collection(collectionName);
    if (await collection.estimatedDocumentCount() > 0) {
      console.log(`Skipping ${collectionName}: collection already has documents.`);
      continue;
    }
    if (rows.length) await collection.insertMany(rows);
    console.log(`Seeded ${rows.length} ${collectionName}.`);
  }

  const counters = db.collection('counters');
  for (const [name, value] of Object.entries({ pickup_requests: 1010, collections: 5, notifications: 2 })) {
    await counters.updateOne({ _id: name }, { $max: { sequence_value: value } }, { upsert: true });
  }
  await Promise.all([
    db.collection('pickup_requests').createIndex({ workspace_id: 1, requested_at: -1 }),
    db.collection('pickup_requests').createIndex({ workspace_id: 1, request_code: 1 }, { unique: true }),
    db.collection('notifications').createIndex({ workspace_id: 1, created_at: -1 }),
    db.collection('recycling_batches').createIndex({ workspace_id: 1, received_at: -1 }),
  ]);
}

seed()
  .catch((error) => {
    console.error('MongoDB seed failed:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closeMongoClient();
  });

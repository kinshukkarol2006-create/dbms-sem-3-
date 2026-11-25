-- Recollect e-waste operations database
-- Target: MySQL 8.0.16+
-- Create the database first, select it in MySQL Workbench, then run this file.

CREATE TABLE IF NOT EXISTS organizations (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    workspace_id BIGINT UNSIGNED NULL,
    name VARCHAR(160) NOT NULL,
    organization_type ENUM('workspace', 'collection_partner', 'recycling_partner') NOT NULL,
    contact_email VARCHAR(254) NULL,
    phone VARCHAR(40) NULL,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uq_organizations_workspace_name (workspace_id, name),
    CONSTRAINT fk_organizations_workspace
        FOREIGN KEY (workspace_id) REFERENCES organizations(id) ON DELETE CASCADE,
    CONSTRAINT chk_organizations_type
        CHECK (
            (organization_type = 'workspace' AND workspace_id IS NULL)
            OR (organization_type <> 'workspace' AND workspace_id IS NOT NULL)
        )
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS users (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    organization_id BIGINT UNSIGNED NOT NULL,
    full_name VARCHAR(160) NOT NULL,
    email VARCHAR(254) NOT NULL,
    role ENUM('owner', 'manager', 'dispatcher', 'driver', 'viewer') NOT NULL,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uq_users_email (email),
    CONSTRAINT fk_users_organization
        FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS districts (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    workspace_id BIGINT UNSIGNED NOT NULL,
    name VARCHAR(120) NOT NULL,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    UNIQUE KEY uq_districts_workspace_name (workspace_id, name),
    CONSTRAINT fk_districts_workspace
        FOREIGN KEY (workspace_id) REFERENCES organizations(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS device_categories (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    workspace_id BIGINT UNSIGNED NOT NULL,
    name VARCHAR(120) NOT NULL,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    UNIQUE KEY uq_device_categories_workspace_name (workspace_id, name),
    CONSTRAINT fk_device_categories_workspace
        FOREIGN KEY (workspace_id) REFERENCES organizations(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS pickup_requests (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    workspace_id BIGINT UNSIGNED NOT NULL,
    request_code VARCHAR(32) NOT NULL,
    requester_name VARCHAR(160) NOT NULL,
    requester_email VARCHAR(254) NULL,
    requester_phone VARCHAR(40) NULL,
    location_name VARCHAR(160) NOT NULL,
    street_address VARCHAR(500) NULL,
    district_id BIGINT UNSIGNED NOT NULL,
    status ENUM('pending', 'scheduled', 'in_progress', 'completed', 'cancelled')
        NOT NULL DEFAULT 'pending',
    requested_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    scheduled_for DATE NULL,
    notes TEXT NULL,
    created_by BIGINT UNSIGNED NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uq_pickup_requests_workspace_code (workspace_id, request_code),
    KEY idx_pickups_workspace_status_date (workspace_id, status, scheduled_for),
    KEY idx_pickups_workspace_requested_at (workspace_id, requested_at),
    KEY idx_pickups_district (district_id),
    CONSTRAINT fk_pickups_workspace
        FOREIGN KEY (workspace_id) REFERENCES organizations(id) ON DELETE CASCADE,
    CONSTRAINT fk_pickups_district
        FOREIGN KEY (district_id) REFERENCES districts(id),
    CONSTRAINT fk_pickups_created_by
        FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB AUTO_INCREMENT=2842 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS pickup_request_items (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    pickup_request_id BIGINT UNSIGNED NOT NULL,
    device_category_id BIGINT UNSIGNED NOT NULL,
    description VARCHAR(255) NULL,
    quantity INT UNSIGNED NOT NULL DEFAULT 1,
    estimated_weight_kg DECIMAL(10, 2) NOT NULL,
    KEY idx_pickup_items_category (device_category_id),
    CONSTRAINT fk_pickup_items_request
        FOREIGN KEY (pickup_request_id) REFERENCES pickup_requests(id) ON DELETE CASCADE,
    CONSTRAINT fk_pickup_items_category
        FOREIGN KEY (device_category_id) REFERENCES device_categories(id),
    CONSTRAINT chk_pickup_item_quantity CHECK (quantity > 0),
    CONSTRAINT chk_pickup_item_weight CHECK (estimated_weight_kg > 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS collection_routes (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    workspace_id BIGINT UNSIGNED NOT NULL,
    route_name VARCHAR(160) NOT NULL,
    route_date DATE NOT NULL,
    status ENUM('planned', 'in_progress', 'completed', 'cancelled') NOT NULL DEFAULT 'planned',
    assigned_driver_id BIGINT UNSIGNED NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uq_routes_workspace_name_date (workspace_id, route_name, route_date),
    KEY idx_routes_workspace_date (workspace_id, route_date, status),
    CONSTRAINT fk_routes_workspace
        FOREIGN KEY (workspace_id) REFERENCES organizations(id) ON DELETE CASCADE,
    CONSTRAINT fk_routes_driver
        FOREIGN KEY (assigned_driver_id) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS route_stops (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    route_id BIGINT UNSIGNED NOT NULL,
    pickup_request_id BIGINT UNSIGNED NOT NULL,
    stop_order INT UNSIGNED NOT NULL,
    arrived_at DATETIME NULL,
    completed_at DATETIME NULL,
    UNIQUE KEY uq_route_stop_request (route_id, pickup_request_id),
    UNIQUE KEY uq_route_stop_order (route_id, stop_order),
    CONSTRAINT fk_route_stops_route
        FOREIGN KEY (route_id) REFERENCES collection_routes(id) ON DELETE CASCADE,
    CONSTRAINT fk_route_stops_pickup
        FOREIGN KEY (pickup_request_id) REFERENCES pickup_requests(id) ON DELETE CASCADE,
    CONSTRAINT chk_route_stop_order CHECK (stop_order > 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS collections (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    pickup_request_id BIGINT UNSIGNED NOT NULL,
    route_stop_id BIGINT UNSIGNED NULL,
    collected_by BIGINT UNSIGNED NULL,
    collected_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    item_count INT UNSIGNED NOT NULL,
    collected_weight_kg DECIMAL(10, 2) NOT NULL,
    notes TEXT NULL,
    UNIQUE KEY uq_collections_pickup (pickup_request_id),
    KEY idx_collections_collected_at (collected_at),
    CONSTRAINT fk_collections_pickup
        FOREIGN KEY (pickup_request_id) REFERENCES pickup_requests(id) ON DELETE RESTRICT,
    CONSTRAINT fk_collections_route_stop
        FOREIGN KEY (route_stop_id) REFERENCES route_stops(id) ON DELETE SET NULL,
    CONSTRAINT fk_collections_user
        FOREIGN KEY (collected_by) REFERENCES users(id) ON DELETE SET NULL,
    CONSTRAINT chk_collections_item_count CHECK (item_count >= 0),
    CONSTRAINT chk_collections_weight CHECK (collected_weight_kg >= 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS recycling_batches (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    workspace_id BIGINT UNSIGNED NOT NULL,
    recycling_partner_id BIGINT UNSIGNED NOT NULL,
    batch_code VARCHAR(64) NOT NULL,
    status ENUM('received', 'processing', 'completed', 'rejected') NOT NULL DEFAULT 'received',
    received_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    completed_at TIMESTAMP NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uq_recycling_batches_workspace_code (workspace_id, batch_code),
    KEY idx_recycling_batches_workspace_date (workspace_id, completed_at),
    CONSTRAINT fk_recycling_batches_workspace
        FOREIGN KEY (workspace_id) REFERENCES organizations(id) ON DELETE CASCADE,
    CONSTRAINT fk_recycling_batches_partner
        FOREIGN KEY (recycling_partner_id) REFERENCES organizations(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS recycling_batch_items (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    batch_id BIGINT UNSIGNED NOT NULL,
    collection_id BIGINT UNSIGNED NULL,
    device_category_id BIGINT UNSIGNED NOT NULL,
    recycled_weight_kg DECIMAL(10, 2) NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_recycling_items_batch
        FOREIGN KEY (batch_id) REFERENCES recycling_batches(id) ON DELETE CASCADE,
    CONSTRAINT fk_recycling_items_collection
        FOREIGN KEY (collection_id) REFERENCES collections(id) ON DELETE SET NULL,
    CONSTRAINT fk_recycling_items_category
        FOREIGN KEY (device_category_id) REFERENCES device_categories(id),
    CONSTRAINT chk_recycling_item_weight CHECK (recycled_weight_kg >= 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS impact_goals (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    workspace_id BIGINT UNSIGNED NOT NULL,
    period_start DATE NOT NULL,
    period_end DATE NOT NULL,
    recycling_goal_kg DECIMAL(12, 2) NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uq_impact_goal_period (workspace_id, period_start, period_end),
    CONSTRAINT fk_impact_goals_workspace
        FOREIGN KEY (workspace_id) REFERENCES organizations(id) ON DELETE CASCADE,
    CONSTRAINT chk_impact_goal_dates CHECK (period_end >= period_start),
    CONSTRAINT chk_impact_goal_weight CHECK (recycling_goal_kg > 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS notifications (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    workspace_id BIGINT UNSIGNED NOT NULL,
    user_id BIGINT UNSIGNED NULL,
    title VARCHAR(180) NOT NULL,
    message TEXT NOT NULL,
    read_at DATETIME NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    KEY idx_notifications_user_created (user_id, created_at),
    CONSTRAINT fk_notifications_workspace
        FOREIGN KEY (workspace_id) REFERENCES organizations(id) ON DELETE CASCADE,
    CONSTRAINT fk_notifications_user
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE OR REPLACE VIEW pickup_request_dashboard AS
SELECT
    p.id,
    p.workspace_id,
    p.request_code,
    p.location_name,
    d.name AS district_name,
    p.status,
    p.scheduled_for,
    COALESCE(items.device_types, 'Unspecified') AS device_types,
    COALESCE(items.estimated_weight_kg, 0.00) AS estimated_weight_kg,
    p.requested_at
FROM pickup_requests AS p
JOIN districts AS d ON d.id = p.district_id
LEFT JOIN (
    SELECT
        i.pickup_request_id,
        GROUP_CONCAT(DISTINCT dc.name ORDER BY dc.name SEPARATOR ', ') AS device_types,
        SUM(i.estimated_weight_kg) AS estimated_weight_kg
    FROM pickup_request_items AS i
    JOIN device_categories AS dc ON dc.id = i.device_category_id
    GROUP BY i.pickup_request_id
) AS items ON items.pickup_request_id = p.id;

CREATE OR REPLACE VIEW dashboard_monthly_metrics AS
SELECT
    o.id AS workspace_id,
    (
        SELECT COUNT(*)
        FROM pickup_requests AS p
        WHERE p.workspace_id = o.id
          AND p.requested_at >= DATE_FORMAT(CURRENT_DATE, '%Y-%m-01')
          AND p.requested_at < DATE_FORMAT(CURRENT_DATE + INTERVAL 1 MONTH, '%Y-%m-01')
    ) AS pickups_requested_this_month,
    (
        SELECT COUNT(*)
        FROM pickup_requests AS p
        WHERE p.workspace_id = o.id AND p.status IN ('pending', 'scheduled')
    ) AS awaiting_collection,
    (
        SELECT COUNT(*)
        FROM pickup_requests AS p
        WHERE p.workspace_id = o.id
          AND (
              (p.status = 'pending' AND p.requested_at < CURRENT_TIMESTAMP - INTERVAL 2 DAY)
              OR (p.status = 'scheduled' AND p.scheduled_for < CURRENT_DATE)
          )
    ) AS needing_attention,
    (
        SELECT COUNT(*)
        FROM organizations AS partner
        WHERE partner.workspace_id = o.id
          AND partner.organization_type IN ('collection_partner', 'recycling_partner')
          AND partner.is_active = TRUE
    ) AS active_partners,
    COALESCE((
        SELECT SUM(rbi.recycled_weight_kg)
        FROM recycling_batches AS rb
        JOIN recycling_batch_items AS rbi ON rbi.batch_id = rb.id
        WHERE rb.workspace_id = o.id
          AND rb.completed_at >= DATE_FORMAT(CURRENT_DATE, '%Y-%m-01')
          AND rb.completed_at < DATE_FORMAT(CURRENT_DATE + INTERVAL 1 MONTH, '%Y-%m-01')
          AND rb.status = 'completed'
    ), 0.00) AS recycled_weight_kg_this_month
FROM organizations AS o
WHERE o.organization_type = 'workspace';

CREATE OR REPLACE VIEW daily_collection_volume AS
SELECT
    totals.workspace_id,
    totals.activity_date,
    SUM(totals.collected_items) AS collected_items,
    SUM(totals.collected_weight_kg) AS collected_weight_kg,
    SUM(totals.recycled_weight_kg) AS recycled_weight_kg
FROM (
    SELECT
        p.workspace_id,
        DATE(c.collected_at) AS activity_date,
        SUM(c.item_count) AS collected_items,
        SUM(c.collected_weight_kg) AS collected_weight_kg,
        0.00 AS recycled_weight_kg
    FROM collections AS c
    JOIN pickup_requests AS p ON p.id = c.pickup_request_id
    GROUP BY p.workspace_id, DATE(c.collected_at)
    UNION ALL
    SELECT
        rb.workspace_id,
        DATE(rb.completed_at) AS activity_date,
        0 AS collected_items,
        0.00 AS collected_weight_kg,
        SUM(rbi.recycled_weight_kg) AS recycled_weight_kg
    FROM recycling_batches AS rb
    JOIN recycling_batch_items AS rbi ON rbi.batch_id = rb.id
    WHERE rb.status = 'completed' AND rb.completed_at IS NOT NULL
    GROUP BY rb.workspace_id, DATE(rb.completed_at)
) AS totals
GROUP BY totals.workspace_id, totals.activity_date;

CREATE OR REPLACE VIEW monthly_device_category_totals AS
SELECT
    p.workspace_id,
    dc.id AS device_category_id,
    dc.name AS name,
    SUM(i.quantity) AS item_count,
    SUM(i.estimated_weight_kg) AS estimated_weight_kg
FROM collections AS c
JOIN pickup_requests AS p ON p.id = c.pickup_request_id
JOIN pickup_request_items AS i ON i.pickup_request_id = p.id
JOIN device_categories AS dc ON dc.id = i.device_category_id
WHERE c.collected_at >= DATE_FORMAT(CURRENT_DATE, '%Y-%m-01')
  AND c.collected_at < DATE_FORMAT(CURRENT_DATE + INTERVAL 1 MONTH, '%Y-%m-01')
GROUP BY p.workspace_id, dc.id, dc.name;

-- Seed the sample Greenloop workspace with realistic operations data. Statements can be run again safely.
INSERT INTO organizations (id, workspace_id, name, organization_type, contact_email, phone, is_active)
VALUES
    (1, NULL, 'Greenloop Co.', 'workspace', 'ops@greenloop.example', '+1-800-555-0100', TRUE),
    (2, 1, 'Loop Logistics', 'collection_partner', 'dispatch@looplogistics.example', '+1-800-555-0110', TRUE),
    (3, 1, 'Renew Recycling', 'recycling_partner', 'hello@renewrecycling.example', '+1-800-555-0120', TRUE),
    (4, 1, 'Circular City Co-op', 'collection_partner', 'team@circularcity.example', '+1-800-555-0130', TRUE),
    (5, 1, 'Apex Material Recovery', 'recycling_partner', 'contact@apexrecovery.example', '+1-800-555-0140', TRUE),
    (6, 1, 'CleanEarth Refiners', 'recycling_partner', 'plant@cleanearth.example', '+1-800-555-0150', TRUE),
    (7, 1, 'Metro Eco Haulers', 'collection_partner', 'service@metroecohaul.example', '+1-800-555-0160', TRUE),
    (8, 1, 'Urban Green Transit', 'collection_partner', 'fleet@urbangreen.example', '+1-800-555-0170', TRUE)
ON DUPLICATE KEY UPDATE name = VALUES(name), contact_email = VALUES(contact_email), phone = VALUES(phone), is_active = VALUES(is_active);

INSERT INTO users (id, organization_id, full_name, email, role, is_active)
VALUES
    (1, 1, 'Alex Morgan', 'alex.morgan@greenloop.example', 'manager', TRUE),
    (2, 1, 'Sam Rivera', 'sam.rivera@greenloop.example', 'driver', TRUE),
    (3, 1, 'Priya Sharma', 'priya.sharma@greenloop.example', 'dispatcher', TRUE),
    (4, 1, 'Marcus Vance', 'marcus.vance@greenloop.example', 'driver', TRUE),
    (5, 1, 'Elena Rostova', 'elena.rostova@greenloop.example', 'driver', TRUE),
    (6, 1, 'David Kim', 'david.kim@greenloop.example', 'viewer', TRUE)
ON DUPLICATE KEY UPDATE full_name = VALUES(full_name), role = VALUES(role), is_active = VALUES(is_active);

INSERT INTO districts (id, workspace_id, name, is_active)
VALUES
    (1, 1, 'North District', TRUE),
    (2, 1, 'East District', TRUE),
    (3, 1, 'Central District', TRUE),
    (4, 1, 'West District', TRUE),
    (5, 1, 'South District', TRUE),
    (6, 1, 'Tech Corridor', TRUE),
    (7, 1, 'Industrial Zone', TRUE),
    (8, 1, 'University Heights', TRUE)
ON DUPLICATE KEY UPDATE name = VALUES(name), is_active = VALUES(is_active);

INSERT INTO device_categories (id, workspace_id, name, is_active)
VALUES
    (1, 1, 'Laptops', TRUE),
    (2, 1, 'Mobile phones', TRUE),
    (3, 1, 'Monitors', TRUE),
    (4, 1, 'Mixed devices', TRUE),
    (5, 1, 'Desktops', TRUE),
    (6, 1, 'Appliances', TRUE),
    (7, 1, 'Network & Servers', TRUE),
    (8, 1, 'Lithium Batteries', TRUE)
ON DUPLICATE KEY UPDATE name = VALUES(name), is_active = VALUES(is_active);

INSERT INTO pickup_requests (
    id, workspace_id, request_code, requester_name, location_name, district_id,
    status, requested_at, scheduled_for, notes, created_by
)
VALUES
    (2837, 1, 'EW-2837', 'Greenfield College', 'Greenfield College', 5, 'completed', '2026-10-24 09:30:00', '2026-10-26', 'Main computer lab upgrade', 1),
    (2838, 1, 'EW-2838', 'Arbor & Co.', 'Arbor & Co.', 4, 'completed', '2026-10-25 11:00:00', '2026-10-27', 'Quarterly office clearing', 1),
    (2839, 1, 'EW-2839', 'Pixel Labs', 'Pixel Labs', 3, 'completed', '2026-10-23 14:00:00', '2026-10-25', 'Replaced design monitors', 1),
    (2840, 1, 'EW-2840', 'Sunrise Community', 'Sunrise Community', 2, 'completed', '2026-10-24 16:30:00', '2026-10-28', 'Community drop-off drive', 1),
    (2841, 1, 'EW-2841', 'Brightway Office', 'Brightway Office', 1, 'completed', '2026-10-27 08:45:00', '2026-10-29', 'Staff laptop refreshes', 1),
    (2843, 1, 'EW-2843', 'Apex Tech Hub', 'Apex Tech Hub', 6, 'completed', '2026-11-01 10:15:00', '2026-11-03', 'Rack server decommissioning', 1),
    (2844, 1, 'EW-2844', 'St. Jude Memorial Hospital', 'St. Jude Memorial Hospital', 3, 'completed', '2026-11-03 13:00:00', '2026-11-05', 'Admin block IT equipment', 1),
    (2845, 1, 'EW-2845', 'Horizon Public School', 'Horizon Public School', 2, 'completed', '2026-11-04 09:00:00', '2026-11-06', 'Old Pentium computer lab', 1),
    (2846, 1, 'EW-2846', 'Silicon Vista Labs', 'Silicon Vista Labs', 6, 'completed', '2026-11-06 15:30:00', '2026-11-08', 'Developer workstations', 1),
    (2847, 1, 'EW-2847', 'Metro City Council', 'Metro City Council', 3, 'completed', '2026-11-08 10:00:00', '2026-11-10', 'Public records office screens', 1),
    (2848, 1, 'EW-2848', 'BioTech Innovations', 'BioTech Innovations', 7, 'completed', '2026-11-09 11:45:00', '2026-11-11', 'UPS and instrument batteries', 1),
    (2849, 1, 'EW-2849', 'National Engineering Institute', 'National Engineering Institute', 8, 'completed', '2026-11-11 14:20:00', '2026-11-13', 'Robotics department overhaul', 1),
    (2850, 1, 'EW-2850', 'Oakwood Residential Towers', 'Oakwood Residential Towers', 4, 'completed', '2026-11-12 16:00:00', '2026-11-14', 'Microwaves, printers, and appliances', 1),
    (2851, 1, 'EW-2851', 'Cyberdyne Software', 'Cyberdyne Software', 6, 'completed', '2026-11-14 10:30:00', '2026-11-16', 'Engineering team laptops', 1),
    (2852, 1, 'EW-2852', 'Central Telecom Station', 'Central Telecom Station', 7, 'completed', '2026-11-15 12:00:00', '2026-11-17', 'Switchgear and router rack components', 1),
    (2842, 1, 'EW-2842', 'Greenfield office', 'Greenfield office', 1, 'in_progress', '2026-11-17 08:30:00', '2026-11-19', 'Fleet driver en route', 1),
    (2853, 1, 'EW-2853', 'Riverdale High School', 'Riverdale High School', 5, 'in_progress', '2026-11-17 11:00:00', '2026-11-19', 'Loading at rear entrance', 1),
    (2854, 1, 'EW-2854', 'Quantum Computing Center', 'Quantum Computing Center', 6, 'in_progress', '2026-11-18 09:15:00', '2026-11-19', 'Security check required at Gate 2', 1),
    (2855, 1, 'EW-2855', 'Global Media Studios', 'Global Media Studios', 3, 'in_progress', '2026-11-18 14:00:00', '2026-11-19', 'Video editing monitors', 1),
    (2856, 1, 'EW-2856', 'Trinity Health Clinic', 'Trinity Health Clinic', 1, 'scheduled', '2026-11-18 10:00:00', '2026-11-20', 'Decommissioned clinical tablets', 1),
    (2857, 1, 'EW-2857', 'Urban Co-working Spaces', 'Urban Co-working Spaces', 4, 'scheduled', '2026-11-18 13:30:00', '2026-11-20', 'Peripherals, mice, keyboards, docks', 1),
    (2858, 1, 'EW-2858', 'Pinnacle Financial Services', 'Pinnacle Financial Services', 3, 'scheduled', '2026-11-19 08:45:00', '2026-11-21', 'Hard drives wiped per protocol', 1),
    (2859, 1, 'EW-2859', 'Evergreen Botanical Society', 'Evergreen Botanical Society', 5, 'scheduled', '2026-11-19 11:20:00', '2026-11-21', 'Laboratory refrigeration unit', 1),
    (2860, 1, 'EW-2860', 'Nexus Cloud Data Center', 'Nexus Cloud Data Center', 6, 'scheduled', '2026-11-19 12:00:00', '2026-11-22', 'Heavy cargo lift required', 1),
    (2861, 1, 'EW-2861', 'State Maritime Academy', 'State Maritime Academy', 2, 'scheduled', '2026-11-19 13:10:00', '2026-11-23', 'Navigation simulator computers', 1),
    (2862, 1, 'EW-2862', 'FutureWave Robotics', 'FutureWave Robotics', 8, 'pending', '2026-11-19 10:30:00', '2026-11-24', 'Lithium battery safe containers needed', 1),
    (2863, 1, 'EW-2863', 'Lotus Valley Apartments', 'Lotus Valley Apartments', 1, 'pending', '2026-11-19 11:40:00', '2026-11-24', 'Resident association e-waste bin', 1),
    (2864, 1, 'EW-2864', 'Silverline Retail Group', 'Silverline Retail Group', 3, 'pending', '2026-11-19 12:15:00', '2026-11-25', 'POS systems and barcode scanners', 1),
    (2865, 1, 'EW-2865', 'Heritage Law Chambers', 'Heritage Law Chambers', 4, 'pending', '2026-11-19 12:50:00', '2026-11-25', 'Old partner laptops with certificates', 1),
    (2866, 1, 'EW-2866', 'Cloud9 Coworking', 'Cloud9 Coworking', 6, 'pending', '2026-11-19 13:20:00', '2026-11-26', 'External displays and cables', 1),
    (2867, 1, 'EW-2867', 'Old Town Repair Shop', 'Old Town Repair Shop', 5, 'cancelled', '2026-11-10 09:00:00', '2026-11-12', 'Client postponed collection', 1),
    (2868, 1, 'EW-2868', 'BlueStar Electronics', 'BlueStar Electronics', 7, 'cancelled', '2026-11-14 11:00:00', '2026-11-15', 'Wrong equipment classification', 1)
ON DUPLICATE KEY UPDATE
    location_name = VALUES(location_name), district_id = VALUES(district_id), status = VALUES(status),
    requested_at = VALUES(requested_at), scheduled_for = VALUES(scheduled_for), notes = VALUES(notes);

INSERT INTO pickup_request_items (pickup_request_id, device_category_id, description, quantity, estimated_weight_kg)
VALUES
    (2837, 5, 'Main computer lab upgrade', 7, 32.40),
    (2838, 4, 'Quarterly office clearing', 9, 16.80),
    (2839, 3, 'Replaced design monitors', 10, 41.00),
    (2840, 2, 'Community drop-off drive', 18, 8.20),
    (2841, 1, 'Staff laptop refreshes', 12, 24.50),
    (2843, 7, 'Rack server decommissioning', 8, 120.00),
    (2844, 4, 'Admin block IT equipment', 15, 55.40),
    (2845, 5, 'Old Pentium computer lab', 22, 68.00),
    (2846, 1, 'Developer workstations', 20, 42.50),
    (2847, 3, 'Public records office screens', 8, 34.00),
    (2848, 8, 'UPS and instrument batteries', 14, 28.60),
    (2849, 5, 'Robotics department overhaul', 30, 95.00),
    (2850, 6, 'Microwaves, printers, and appliances', 6, 85.00),
    (2851, 1, 'Engineering team laptops', 15, 31.20),
    (2852, 7, 'Switchgear and router rack components', 11, 145.00),
    (2842, 1, 'Fleet driver en route', 6, 13.50),
    (2853, 3, 'Loading at rear entrance', 7, 26.50),
    (2854, 1, 'Security check required at Gate 2', 8, 18.40),
    (2855, 3, 'Video editing monitors', 12, 44.00),
    (2856, 2, 'Decommissioned clinical tablets', 25, 12.00),
    (2857, 4, 'Peripherals, mice, keyboards, docks', 14, 22.50),
    (2858, 5, 'Hard drives wiped per protocol', 16, 52.00),
    (2859, 6, 'Laboratory refrigeration unit', 3, 38.00),
    (2860, 7, 'Heavy cargo lift required', 12, 190.00),
    (2861, 5, 'Navigation simulator computers', 14, 45.00),
    (2862, 8, 'Lithium battery safe containers needed', 8, 19.50),
    (2863, 2, 'Resident association e-waste bin', 20, 9.80),
    (2864, 4, 'POS systems and barcode scanners', 16, 33.00),
    (2865, 1, 'Old partner laptops with certificates', 7, 14.20),
    (2866, 3, 'External displays and cables', 8, 29.00),
    (2867, 6, 'Client postponed collection', 4, 62.00),
    (2868, 4, 'Wrong equipment classification', 10, 18.00)
ON DUPLICATE KEY UPDATE estimated_weight_kg = VALUES(estimated_weight_kg);

INSERT INTO collection_routes (id, workspace_id, route_name, route_date, status, assigned_driver_id)
VALUES
    (1, 1, 'North District AM', '2026-10-28', 'completed', 2),
    (2, 1, 'Central District PM', '2026-10-25', 'completed', 2),
    (3, 1, 'Tech Corridor Heavy Haul', '2026-11-03', 'completed', 4),
    (4, 1, 'Metro Institutional Route', '2026-11-05', 'completed', 5),
    (5, 1, 'University & Downtown Sweep', '2026-11-13', 'completed', 2),
    (6, 1, 'Industrial & West Express', '2026-11-17', 'completed', 4),
    (7, 1, 'Central Live Dispatch', '2026-11-19', 'in_progress', 5),
    (8, 1, 'North & West Scheduled Sweep', '2026-11-20', 'planned', 2),
    (9, 1, 'Tech Park Consolidated Dispatch', '2026-11-22', 'planned', 4),
    (10, 1, 'Coastal District Run', '2026-11-23', 'planned', 5)
ON DUPLICATE KEY UPDATE route_name = VALUES(route_name), status = VALUES(status);

INSERT INTO route_stops (id, route_id, pickup_request_id, stop_order, completed_at)
VALUES
    (1, 1, 2841, 1, '2026-10-28 15:00:00'),
    (2, 2, 2839, 1, '2026-10-25 14:00:00'),
    (3, 2, 2838, 2, '2026-10-25 16:30:00'),
    (4, 3, 2843, 1, '2026-11-03 14:30:00'),
    (5, 3, 2846, 2, '2026-11-03 16:00:00'),
    (6, 4, 2844, 1, '2026-11-05 11:30:00'),
    (7, 4, 2845, 2, '2026-11-05 14:30:00'),
    (8, 5, 2849, 1, '2026-11-13 11:00:00'),
    (9, 5, 2847, 2, '2026-11-13 13:30:00'),
    (10, 5, 2848, 3, '2026-11-13 15:30:00'),
    (11, 6, 2850, 1, '2026-11-17 10:30:00'),
    (12, 6, 2851, 2, '2026-11-17 12:30:00'),
    (13, 6, 2852, 3, '2026-11-17 15:00:00'),
    (14, 7, 2842, 1, NULL),
    (15, 7, 2853, 2, NULL),
    (16, 7, 2854, 3, NULL),
    (17, 7, 2855, 4, NULL),
    (18, 8, 2856, 1, NULL),
    (19, 8, 2857, 2, NULL),
    (20, 9, 2858, 1, NULL),
    (21, 9, 2859, 2, NULL),
    (22, 9, 2860, 3, NULL),
    (23, 10, 2861, 1, NULL)
ON DUPLICATE KEY UPDATE stop_order = VALUES(stop_order), completed_at = VALUES(completed_at);

INSERT INTO collections (id, pickup_request_id, route_stop_id, collected_by, collected_at, item_count, collected_weight_kg, notes)
VALUES
    (1, 2837, NULL, 2, '2026-10-26 14:15:00', 7, 32.40, 'Verified collection from Greenfield College'),
    (2, 2838, 3, 2, '2026-10-27 10:20:00', 9, 16.80, 'Verified collection from Arbor & Co.'),
    (3, 2839, 2, 2, '2026-10-25 15:45:00', 10, 41.00, 'Verified collection from Pixel Labs'),
    (4, 2840, NULL, 2, '2026-10-28 11:00:00', 18, 8.20, 'Verified collection from Sunrise Community'),
    (5, 2841, 1, 2, '2026-10-29 13:30:00', 12, 24.50, 'Verified collection from Brightway Office'),
    (6, 2843, 4, 4, '2026-11-03 16:00:00', 8, 120.00, 'Verified collection from Apex Tech Hub'),
    (7, 2844, 6, 5, '2026-11-05 11:30:00', 15, 55.40, 'Verified collection from St. Jude Memorial Hospital'),
    (8, 2845, 7, 5, '2026-11-06 14:00:00', 22, 68.00, 'Verified collection from Horizon Public School'),
    (9, 2846, 5, 4, '2026-11-08 10:45:00', 20, 42.50, 'Verified collection from Silicon Vista Labs'),
    (10, 2847, 9, 2, '2026-11-10 15:15:00', 8, 34.00, 'Verified collection from Metro City Council'),
    (11, 2848, 10, 2, '2026-11-11 12:30:00', 14, 28.60, 'Verified collection from BioTech Innovations'),
    (12, 2849, 8, 2, '2026-11-13 16:30:00', 30, 95.00, 'Verified collection from National Engineering Institute'),
    (13, 2850, 11, 4, '2026-11-14 11:15:00', 6, 85.00, 'Verified collection from Oakwood Residential Towers'),
    (14, 2851, 12, 4, '2026-11-16 13:45:00', 15, 31.20, 'Verified collection from Cyberdyne Software'),
    (15, 2852, 13, 4, '2026-11-17 15:30:00', 11, 145.00, 'Verified collection from Central Telecom Station')
ON DUPLICATE KEY UPDATE collected_weight_kg = VALUES(collected_weight_kg);

INSERT INTO recycling_batches (id, workspace_id, recycling_partner_id, batch_code, status, received_at, completed_at)
VALUES
    (1, 1, 3, 'RB-2026-001', 'completed', '2026-10-26 10:00:00', '2026-10-27 16:30:00'),
    (2, 1, 5, 'RB-2026-002', 'completed', '2026-10-28 09:15:00', '2026-10-29 15:00:00'),
    (3, 1, 6, 'RB-2026-003', 'completed', '2026-10-30 11:30:00', '2026-10-31 17:00:00'),
    (4, 1, 3, 'RB-2026-004', 'completed', '2026-11-04 10:00:00', '2026-11-05 14:00:00'),
    (5, 1, 5, 'RB-2026-005', 'completed', '2026-11-07 08:45:00', '2026-11-08 16:30:00'),
    (6, 1, 6, 'RB-2026-006', 'completed', '2026-11-09 13:00:00', '2026-11-10 17:45:00'),
    (7, 1, 3, 'RB-2026-007', 'completed', '2026-11-12 11:00:00', '2026-11-13 15:20:00'),
    (8, 1, 5, 'RB-2026-008', 'completed', '2026-11-14 14:30:00', '2026-11-15 18:00:00'),
    (9, 1, 6, 'RB-2026-009', 'completed', '2026-11-15 09:30:00', '2026-11-16 14:10:00'),
    (10, 1, 3, 'RB-2026-010', 'processing', '2026-11-17 10:00:00', NULL),
    (11, 1, 5, 'RB-2026-011', 'processing', '2026-11-18 11:30:00', NULL),
    (12, 1, 6, 'RB-2026-012', 'received', '2026-11-19 09:00:00', NULL)
ON DUPLICATE KEY UPDATE status = VALUES(status), completed_at = VALUES(completed_at);

INSERT INTO recycling_batch_items (id, batch_id, device_category_id, recycled_weight_kg)
VALUES
    (1, 1, 3, 41.00),
    (2, 2, 5, 32.40),
    (3, 3, 1, 24.50),
    (4, 4, 7, 120.00),
    (5, 5, 5, 68.00),
    (6, 6, 1, 42.50),
    (7, 7, 8, 28.60),
    (8, 8, 5, 95.00),
    (9, 9, 6, 85.00),
    (10, 10, 7, 145.00),
    (11, 11, 4, 55.40),
    (12, 12, 1, 31.20)
ON DUPLICATE KEY UPDATE recycled_weight_kg = VALUES(recycled_weight_kg);

INSERT INTO impact_goals (id, workspace_id, period_start, period_end, recycling_goal_kg)
VALUES (1, 1, '2026-11-01', '2026-11-30', 800.00)
ON DUPLICATE KEY UPDATE period_start = VALUES(period_start), period_end = VALUES(period_end), recycling_goal_kg = VALUES(recycling_goal_kg);

INSERT INTO notifications (id, workspace_id, user_id, title, message, created_at)
VALUES
    (1, 1, 1, 'Fleet route active', 'Driver Marcus Vance started Commercial West & South PM route.', '2026-11-19 13:45:00'),
    (2, 1, 1, 'New pickup requested', 'Cloud9 Coworking booked 29.0 kg of monitors for collection.', '2026-11-19 13:20:00'),
    (3, 1, 1, 'Recycling batch received', 'CleanEarth Refiners checked in Batch #RB-2026-012 (31.2 kg laptops).', '2026-11-19 09:05:00'),
    (4, 1, 1, 'Heavy e-waste scheduled', 'Nexus Cloud Data Center scheduled 190.0 kg servers for Nov 22.', '2026-11-19 08:30:00'),
    (5, 1, 1, 'Batch processing completed', 'Apex Material Recovery completed refining Batch #RB-2026-008 (95.0 kg).', '2026-11-15 18:05:00'),
    (6, 1, 1, 'Monthly audit milestone', 'Workspace crossed 600 kg of safely diverted electronic material this month.', '2026-11-14 16:00:00'),
    (7, 1, 1, 'Driver Sam Rivera completed stops', 'All 4 stops in University Sweep verified and signed off.', '2026-11-13 16:35:00'),
    (8, 1, 1, 'Green Certificate issued', 'Certificate #REC-CERT-45572D32 generated for Pixel Labs.', '2026-11-10 11:20:00')
ON DUPLICATE KEY UPDATE title = VALUES(title), message = VALUES(message), created_at = VALUES(created_at);

-- Example dashboard queries:
-- SELECT * FROM dashboard_monthly_metrics WHERE workspace_id = 1;
-- SELECT * FROM pickup_request_dashboard WHERE workspace_id = 1 ORDER BY requested_at DESC;
-- SELECT * FROM daily_collection_volume
-- WHERE workspace_id = 1 AND activity_date >= CURRENT_DATE - INTERVAL 30 DAY
-- ORDER BY activity_date;

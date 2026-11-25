# Recollect — E-Waste Management & Operations System
### DBMS Capstone Project

**Recollect** is an electronic waste (e-waste) collection, recycling, and environmental impact dashboard backed by **MongoDB** and a **Node.js/Express** REST API.

Designed and engineered for a college DBMS capstone project, this application models real-world circular economy workflows aligned with **UNEP (United Nations Environment Programme)**, **EPA**, and **WEEE/RoHS** guidelines.

---

## 🌟 Key Features

### 1. Operations & Logistics Lifecycle (Full CRUD)
* **Real-time Status Transitions**: Transition collection requests through: `Pending` $\rightarrow$ `Scheduled` $\rightarrow$ `In progress` $\rightarrow$ `Completed` $\rightarrow$ `Cancelled`.
* **Automated Audit Logging**: Marking requests as `Completed` automatically logs verified item counts and weights into the `collections` audit table, dynamically updating monthly metrics and volume charts.
* **Interactive Management**: Quick status changes, editing details (weight, dates, notes, category, district), and safe deletion directly from the table or modal.

### 2. Environmental Impact & Carbon Offset Engine
Quantifies tangible ecological benefits from diverted electronic scrap using international Life Cycle Assessment (LCA) standards:
* 🌿 **GHG / $\text{CO}_2$ Avoided**: $\approx 1.44\text{ kg CO}_2\text{e}$ prevented per kg of e-waste recycled compared to raw virgin mineral extraction.
* 🌳 **Mature Tree Equivalency**: Quantifies equivalent annual carbon absorption by mature trees.
* 🛡️ **Toxic Heavy Metals Neutralized**: Prevents hazardous elements (Lead, Cadmium, Mercury, Arsenic) from leaching into soil and municipal groundwater ($4.2\text{ g/kg}$).
* ⚡ **Energy Conservation**: Measures kilowatt-hours saved ($2.8\text{ kWh/kg}$) and days of household electricity power.
* 💎 **Precious Metals Reclaimed**: Measures recoverable high-value metals (Gold, Silver, Copper, Palladium).

### 3. Official Green Recycling Certificate Generator
* Instantly generates verifiable **Certificates of Responsible E-Waste Disposal**.
* Includes unique Certificate ID, cryptographic verification hash, consigned weights, device breakdown, and environmental metrics.
* Aligned with **ISO 14001:2015 Environmental Management** and **WEEE/RoHS** compliance standards.
* One-click **Print / Save as PDF** capability.

### 4. Fleet & Route Management
* Driver assignment, scheduled dates, and sequenced route stops.
* Status tracking across planned, in-progress, and completed routes.

---

## 🗄️ Database Architecture (MongoDB)

The API stores operational data in MongoDB collections for organizations, users, districts, device categories, pickup requests, collections, routes, recycling batches, impact goals, notifications, and ID counters. Pickup items, route stops, and recycling items are embedded in their parent documents so related operational data can be read and updated together.

The frontend continues to use the same `/api/...` endpoints and response fields. Numeric IDs are retained for pickup requests and related options; MongoDB-generated `_id` values are internal.

---

## 🚀 Getting Started

### Prerequisites
* **Node.js**: v18.0 or newer
* **MongoDB**: local MongoDB server for development, or a MongoDB Atlas cluster

### 1. Database Setup
For local development, start MongoDB locally. For deployment, create a MongoDB Atlas cluster, create a database user, and allow your deployment network access in Atlas. Copy the cluster connection string; replace its password placeholder and include the database name in the URI.

### 2. Environment Configuration
Copy `.env.example` to `.env`:
```sh
cp .env.example .env
```
Configure the connection details in `.env`:
```ini
PORT=3000
MONGODB_URI=mongodb://127.0.0.1:27017/recollect
MONGODB_DB=recollect
WORKSPACE_ID=1
```

To load the sample workspace and dashboard records into empty collections:
```sh
npm run seed
```
The seed command skips any collection that already contains documents.

To import all data rows from the legacy `database.sql` seed into MongoDB, run:
```sh
npm run import:sql -- --dry-run
npm run import:sql
```
The importer embeds pickup items, route stops, and recycling items in their MongoDB parent documents. It preserves SQL IDs, adds missing rows, and replaces documents with matching IDs using the SQL row data.

### 3. Install & Launch
```sh
# Install dependencies
npm install

# Start production server
npm start

# Or start with auto-reload (development)
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser. Verify the connection at [http://localhost:3000/api/health](http://localhost:3000/api/health).

### Deploying on Vercel
In the Vercel project settings, add `MONGODB_URI` using the MongoDB Atlas connection string and `MONGODB_DB` (for example, `recollect`). Add `WORKSPACE_ID` if you want to use a workspace other than `1`, then redeploy. Do not commit the real URI or database password to GitHub. The Vercel function uses the same serverless API and connects to MongoDB on demand.

---

## 🔌 API Endpoints

| Method | Endpoint | Description |
| :--- | :--- | :--- |
| `GET` | `/api/health` | Health check & MongoDB status |
| `GET` | `/api/dashboard` | Monthly KPIs & device category breakdown |
| `GET` | `/api/impact` | Real-time carbon, toxic material & energy savings |
| `GET` | `/api/volume?range=30D` | Time-series collection & recycling volume points |
| `GET` | `/api/pickups` | Paginated, filtered, and searchable pickup list |
| `GET` | `/api/pickups/:id` | Full details for a single pickup request |
| `POST` | `/api/pickups` | Create a new collection request |
| `PUT` | `/api/pickups/:id` | Edit details of a pickup request |
| `PATCH`| `/api/pickups/:id/status` | Update pickup status with automated notifications |
| `DELETE`| `/api/pickups/:id` | Remove a pickup request and related items |
| `GET` | `/api/certificates/:code`| Generate Green Recycling Certificate data |
| `GET` | `/api/routes` | View collection routes and assigned drivers |
| `GET` | `/api/recycling` | Recycling batches and partner material recovery |
| `GET` | `/api/partners` | Directory of collection and recycling partners |
| `GET` | `/api/notifications` | Real-time alerts and activity stream |
| `POST` | `/api/notifications/read` | Mark all notifications as read |

---

## 👥 Authors & Academic Context
* **Author**: Kinshuk Karol
* **Project**: Capstone Project for Database Management Systems (DBMS)

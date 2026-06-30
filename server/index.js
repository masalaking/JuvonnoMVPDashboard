import 'dotenv/config';
import express from 'express';
import { readFileSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { randomUUID } from 'crypto';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = join(__dirname, '..');

const PORT = process.env.API_PORT ?? 3001;
const DASHBOARD_API_KEY = process.env.DASHBOARD_API_KEY ?? '';
const TENANT_LINKS_FILE = process.env.TENANT_LINKS_FILE ?? join(ROOT, 'data/tenant-links.json');
const REQUESTS_DATA_FILE = process.env.REQUESTS_DATA_FILE ?? join(ROOT, 'data/requests.json');

const app = express();
app.use(express.json());

function loadTenants() {
  return JSON.parse(readFileSync(TENANT_LINKS_FILE, 'utf-8'));
}

function loadRequests() {
  return JSON.parse(readFileSync(REQUESTS_DATA_FILE, 'utf-8'));
}

function saveRequests(requests) {
  writeFileSync(REQUESTS_DATA_FILE, JSON.stringify(requests, null, 2));
}

function findTenant(accessToken) {
  return loadTenants().find(t => t.access_token === accessToken) ?? null;
}

app.get('/health', (_req, res) => res.json({ ok: true }));

// Frontend fetches tenant info (clinic name, receptionist, etc.)
app.get('/api/link/:accessToken/tenant', (req, res) => {
  const tenant = findTenant(req.params.accessToken);
  if (!tenant) return res.status(404).json({ error: 'Invalid access token' });
  const { access_token, ...info } = tenant;
  res.json(info);
});

// n8n pushes incoming request data here
app.post('/api/link/:accessToken/intake/requests', (req, res) => {
  const apiKey = req.headers['x-dashboard-api-key'];
  if (!DASHBOARD_API_KEY || apiKey !== DASHBOARD_API_KEY) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const tenant = findTenant(req.params.accessToken);
  if (!tenant) return res.status(404).json({ error: 'Invalid access token' });

  const requests = loadRequests();
  const entry = {
    id: randomUUID(),
    client_id: tenant.client_id,
    created_at: new Date().toISOString(),
    status: 'New',
    ...req.body,
  };
  requests.push(entry);
  saveRequests(requests);
  res.status(201).json(entry);
});

// Frontend polls this to get the queue for a tenant
app.get('/api/link/:accessToken/queue/requests', (req, res) => {
  const tenant = findTenant(req.params.accessToken);
  if (!tenant) return res.status(404).json({ error: 'Invalid access token' });

  const requests = loadRequests();
  res.json(requests.filter(r => r.client_id === tenant.client_id));
});

// Frontend updates a request's status
app.patch('/api/link/:accessToken/queue/requests/:id', (req, res) => {
  const tenant = findTenant(req.params.accessToken);
  if (!tenant) return res.status(404).json({ error: 'Invalid access token' });

  const requests = loadRequests();
  const idx = requests.findIndex(
    r => r.id === req.params.id && r.client_id === tenant.client_id
  );
  if (idx === -1) return res.status(404).json({ error: 'Request not found' });

  requests[idx] = {
    ...requests[idx],
    ...req.body,
    id: requests[idx].id,
    client_id: requests[idx].client_id,
  };
  saveRequests(requests);
  res.json(requests[idx]);
});

// Serve built frontend
app.use(express.static(join(ROOT, 'dist')));
app.get('*', (_req, res) => res.sendFile(join(ROOT, 'dist/index.html')));

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));

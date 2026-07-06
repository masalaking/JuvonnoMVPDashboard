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
const SETTINGS_FILE = process.env.SETTINGS_FILE ?? join(ROOT, 'data/settings.json');

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

function loadSettings() {
  try { return JSON.parse(readFileSync(SETTINGS_FILE, 'utf-8')); } catch { return {}; }
}

function saveSettingsFile(data) {
  writeFileSync(SETTINGS_FILE, JSON.stringify(data, null, 2));
}

// Transform one section from internal storage format into the shape n8n expects.
function formatForN8n(section, data) {
  if (section === 'practitioners') {
    const list = Array.isArray(data?.list) ? data.list : [];
    return {
      practitioners: list.map(p => ({
        name: p.name,
        staff_num: String(p.staff_num ?? ''),
        keywords: typeof p.keywords === 'string'
          ? p.keywords.split(',').map(k => k.trim()).filter(Boolean)
          : (Array.isArray(p.keywords) ? p.keywords : []),
        service_types: (p.appointment_types ?? []).map(t => ({
          service: t.service_name,
          keywords: typeof t.keywords === 'string'
            ? t.keywords.split(',').map(k => k.trim()).filter(Boolean)
            : (Array.isArray(t.keywords) ? t.keywords : []),
          durations: Object.fromEntries(
            (t.duration_categories ?? []).map(c => [
              c.label,
              (c.durations ?? '').split(',').map(d => parseInt(d.trim(), 10)).filter(n => !isNaN(n)),
            ])
          ),
        })),
      })),
    };
  }
  if (section === 'faqs') {
    return { faqs: (data?.list ?? []).map(f => ({ question: f.question, answer: f.answer })) };
  }
  return { [section]: data };
}

// Build the full all_settings object in n8n's expected shape.
function buildN8nAllSettings(allSettings) {
  const result = {};
  for (const [section, data] of Object.entries(allSettings)) {
    Object.assign(result, formatForN8n(section, data));
  }
  return result;
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

// ── Settings endpoints ────────────────────────────────────────────────────────

// Return all saved settings for this tenant
app.get('/api/link/:accessToken/settings', (req, res) => {
  const tenant = findTenant(req.params.accessToken);
  if (!tenant) return res.status(404).json({ error: 'Invalid access token' });
  const all = loadSettings();
  res.json(all[tenant.client_id] ?? {});
});

// Save all sections at once — body: { sections: { clinic_profile: {...}, practitioners: {...}, ... } }
// Fires one webhook per section so n8n processes each independently
app.put('/api/link/:accessToken/settings/bulk', async (req, res) => {
  const tenant = findTenant(req.params.accessToken);
  if (!tenant) return res.status(404).json({ error: 'Invalid access token' });
  const { sections } = req.body;
  if (!sections || typeof sections !== 'object') return res.status(400).json({ error: 'sections is required' });

  const all = loadSettings();
  const existing = all[tenant.client_id] ?? {};

  for (const [section, data] of Object.entries(sections)) {
    existing[section] = { ...(existing[section] ?? {}), ...data };
  }
  all[tenant.client_id] = existing;
  saveSettingsFile(all);

  res.json(existing);

  // Fire sequentially after responding so concurrent executions don't race on
  // n8n's read→merge→write pattern inside $getWorkflowStaticData('global').
  if (tenant.n8n_webhook_url) {
    (async () => {
      for (const [section, data] of Object.entries(sections)) {
        try {
          await fetch(tenant.n8n_webhook_url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              event: 'settings.changed',
              client_id: tenant.client_id,
              clinic_id: tenant.clinic_id,
              clinic_name: tenant.clinic_name,
              section,
              changed: formatForN8n(section, data),
              all_settings: buildN8nAllSettings(existing),
            }),
          });
        } catch (err) {
          console.error(`[webhook] failed to notify n8n for section "${section}" (${tenant.client_id}):`, err.message);
        }
      }
    })();
  }
});

// Save (merge) one section — body: { section: 'voice_personality', data: {...} }
// After saving, fires a webhook to n8n so it can react (e.g. update Retell AI)
app.put('/api/link/:accessToken/settings', async (req, res) => {
  const tenant = findTenant(req.params.accessToken);
  if (!tenant) return res.status(404).json({ error: 'Invalid access token' });
  const { section, data } = req.body;
  if (!section || !data) return res.status(400).json({ error: 'section and data are required' });

  const all = loadSettings();
  const existing = all[tenant.client_id] ?? {};
  existing[section] = { ...(existing[section] ?? {}), ...data };
  all[tenant.client_id] = existing;
  saveSettingsFile(all);

  res.json(existing);

  if (tenant.n8n_webhook_url) {
    fetch(tenant.n8n_webhook_url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        event: 'settings.changed',
        client_id: tenant.client_id,
        clinic_id: tenant.clinic_id,
        clinic_name: tenant.clinic_name,
        section,
        changed: formatForN8n(section, data),
        all_settings: buildN8nAllSettings(existing),
      }),
    }).catch(err => console.error(`[webhook] failed to notify n8n for section "${section}" (${tenant.client_id}):`, err.message));
  }
});

// Serve built frontend
app.use(express.static(join(ROOT, 'dist')));
app.get('*', (_req, res) => res.sendFile(join(ROOT, 'dist/index.html')));

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));

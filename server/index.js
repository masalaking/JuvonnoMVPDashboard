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

// ── n8n proxy helper (Payment Recovery + Call Logs) ─────────────────────────
// These two feature areas keep no local storage on this server — n8n (backed
// by Google Sheets / Juvonno) is the source of truth. The dashboard is a thin,
// per-tenant proxy: it resolves :accessToken -> tenant, forwards an `event` +
// payload to that tenant's own n8n_webhook_url, and relays back whatever n8n
// responds with (via n8n's "Respond to Webhook" node). This keeps every
// request scoped to one clinic's n8n instance, same as /settings scopes
// writes to one clinic's data.
async function callN8n(tenant, event, payload = {}) {
  if (!tenant.n8n_webhook_url) {
    const err = new Error('No n8n webhook configured for this clinic');
    err.status = 502;
    throw err;
  }
  const res = await fetch(tenant.n8n_webhook_url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      event,
      client_id: tenant.client_id,
      clinic_id: tenant.clinic_id,
      clinic_name: tenant.clinic_name,
      ...payload,
    }),
  });
  const text = await res.text();
  let json;
  try { json = text ? JSON.parse(text) : {}; } catch { json = { raw: text }; }
  if (!res.ok) {
    const err = new Error(json?.error ?? `n8n responded with ${res.status}`);
    err.status = 502;
    throw err;
  }
  return json;
}

// Wraps a route handler that talks to n8n so failures come back as a clean
// 502 instead of an unhandled rejection / stack trace to the client.
function n8nRoute(handler) {
  return async (req, res) => {
    try {
      await handler(req, res);
    } catch (err) {
      console.error(`[n8n proxy] ${req.method} ${req.originalUrl} failed:`, err.message);
      res.status(err.status ?? 502).json({ error: err.message ?? 'Upstream n8n request failed' });
    }
  };
}

// Strict boolean coercion for values that may arrive as a real boolean, the
// string "true"/"false", or be missing. Boolean("false") === true in JS, so
// any Boolean(value)/!!value on a stored string is a bug — this is the one
// place that decides truthiness for values coming from storage/API.
function parseBoolean(value) {
  if (value === true) return true;
  if (value === false || value == null) return false;
  return String(value).trim().toLowerCase() === 'true';
}

const CLINIC_HOURS_DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

// Always emits open_<Day> as the literal string "true"/"false", regardless of
// what shape it arrived in (boolean, "true", "false", undefined). This is
// applied both to a single section's `changed` payload and to `all_settings`,
// so the two can never disagree about whether a day is open.
function formatClinicHoursForN8n(data) {
  const src = data ?? {};
  const out = {};
  for (const day of CLINIC_HOURS_DAYS) {
    out[`open_${day}`] = parseBoolean(src[`open_${day}`]) ? 'true' : 'false';
    out[`start_${day}`] = String(src[`start_${day}`] ?? '');
    out[`end_${day}`] = String(src[`end_${day}`] ?? '');
  }
  return out;
}

// Transform one section from internal storage format into the shape n8n
// expects. Returns the section's data UNWRAPPED (no {section: ...} envelope)
// so callers can nest it under the section name exactly once - wrapping it
// here as well as at the call site is what caused the double-nested
// all_settings.clinic_hours.clinic_hours bug.
function formatForN8n(section, data) {
  if (section === 'clinic_hours') {
    return formatClinicHoursForN8n(data);
  }
  if (section === 'practitioners') {
    const list = Array.isArray(data?.list) ? data.list : [];
    return list.map(p => ({
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
    }));
  }
  if (section === 'faqs') {
    return (data?.list ?? []).map(f => ({ question: f.question, answer: f.answer }));
  }
  return data;
}

// Build the full all_settings object in n8n's expected shape, nesting each
// section's formatted data under its own key exactly once.
function buildN8nAllSettings(allSettings) {
  const result = {};
  for (const [section, data] of Object.entries(allSettings)) {
    result[section] = formatForN8n(section, data);
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
    ...req.body,
    // These are always ours to set, never the caller's - a new request is
    // always "New" regardless of what status (if any) the workflow sends,
    // since staff should be the ones moving it through the queue.
    id: randomUUID(),
    client_id: tenant.client_id,
    created_at: new Date().toISOString(),
    status: 'New',
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

// Frontend deletes a request from the queue
app.delete('/api/link/:accessToken/queue/requests/:id', (req, res) => {
  const tenant = findTenant(req.params.accessToken);
  if (!tenant) return res.status(404).json({ error: 'Invalid access token' });

  const requests = loadRequests();
  const idx = requests.findIndex(
    r => r.id === req.params.id && r.client_id === tenant.client_id
  );
  if (idx === -1) return res.status(404).json({ error: 'Request not found' });

  requests.splice(idx, 1);
  saveRequests(requests);
  res.status(204).end();
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

// ── Payment Recovery (billing) endpoints ────────────────────────────────────
// No local storage — every route resolves :accessToken -> tenant, then
// proxies to that tenant's own n8n_webhook_url (see callN8n above) and
// relays back n8n's response. n8n / Google Sheets is the single source of
// truth for invoices, tasks, and communications.

app.get('/api/link/:accessToken/billing/overview', n8nRoute(async (req, res) => {
  const tenant = findTenant(req.params.accessToken);
  if (!tenant) return res.status(404).json({ error: 'Invalid access token' });
  res.json(await callN8n(tenant, 'billing.get_overview'));
}));

app.get('/api/link/:accessToken/billing/invoices', n8nRoute(async (req, res) => {
  const tenant = findTenant(req.params.accessToken);
  if (!tenant) return res.status(404).json({ error: 'Invalid access token' });
  res.json(await callN8n(tenant, 'billing.get_invoices'));
}));

app.get('/api/link/:accessToken/billing/invoices/:invoiceId', n8nRoute(async (req, res) => {
  const tenant = findTenant(req.params.accessToken);
  if (!tenant) return res.status(404).json({ error: 'Invalid access token' });
  res.json(await callN8n(tenant, 'billing.get_invoice', { invoice_id: req.params.invoiceId }));
}));

app.get('/api/link/:accessToken/billing/tasks', n8nRoute(async (req, res) => {
  const tenant = findTenant(req.params.accessToken);
  if (!tenant) return res.status(404).json({ error: 'Invalid access token' });
  res.json(await callN8n(tenant, 'billing.get_tasks'));
}));

app.get('/api/link/:accessToken/billing/communications', n8nRoute(async (req, res) => {
  const tenant = findTenant(req.params.accessToken);
  if (!tenant) return res.status(404).json({ error: 'Invalid access token' });
  res.json(await callN8n(tenant, 'billing.get_communications'));
}));

app.get('/api/link/:accessToken/billing/settings', n8nRoute(async (req, res) => {
  const tenant = findTenant(req.params.accessToken);
  if (!tenant) return res.status(404).json({ error: 'Invalid access token' });
  res.json(await callN8n(tenant, 'billing.get_settings'));
}));

app.post('/api/link/:accessToken/billing/settings', n8nRoute(async (req, res) => {
  const tenant = findTenant(req.params.accessToken);
  if (!tenant) return res.status(404).json({ error: 'Invalid access token' });
  res.json(await callN8n(tenant, 'billing.settings_changed', { settings: req.body }));
}));

// Staff-triggered invoice actions — each just forwards to n8n, which performs
// the real side effect (Twilio send, Juvonno lookup, Sheets update) and
// returns the updated invoice.
function billingInvoiceAction(event) {
  return n8nRoute(async (req, res) => {
    const tenant = findTenant(req.params.accessToken);
    if (!tenant) return res.status(404).json({ error: 'Invalid access token' });
    res.json(await callN8n(tenant, event, { invoice_id: req.params.invoiceId }));
  });
}

app.post('/api/link/:accessToken/billing/invoices/:invoiceId/send-now', billingInvoiceAction('billing.invoice.send_now'));
app.post('/api/link/:accessToken/billing/invoices/:invoiceId/pause', billingInvoiceAction('billing.invoice.pause'));
app.post('/api/link/:accessToken/billing/invoices/:invoiceId/resume', billingInvoiceAction('billing.invoice.resume'));
app.post('/api/link/:accessToken/billing/invoices/:invoiceId/reconcile', billingInvoiceAction('billing.invoice.reconcile'));
app.post('/api/link/:accessToken/billing/invoices/:invoiceId/escalate', billingInvoiceAction('billing.invoice.escalate'));

app.post('/api/link/:accessToken/billing/tasks/:taskId/cancel', n8nRoute(async (req, res) => {
  const tenant = findTenant(req.params.accessToken);
  if (!tenant) return res.status(404).json({ error: 'Invalid access token' });
  res.json(await callN8n(tenant, 'billing.task.cancel', { task_id: req.params.taskId }));
}));

app.post('/api/link/:accessToken/billing/tasks/:taskId/reschedule', n8nRoute(async (req, res) => {
  const tenant = findTenant(req.params.accessToken);
  if (!tenant) return res.status(404).json({ error: 'Invalid access token' });
  res.json(await callN8n(tenant, 'billing.task.reschedule', { task_id: req.params.taskId, scheduled_time: req.body?.scheduled_time }));
}));

// ── Call logs endpoint ───────────────────────────────────────────────────────
// No local storage either — proxies to n8n, which owns inbound/outbound call
// history. `direction` is passed through so n8n can filter or the dashboard
// can filter the response client-side; entries carry direction: "inbound" |
// "outbound" so Call Logs / Transcripts / Recordings can split by tab.
app.get('/api/link/:accessToken/call-logs', n8nRoute(async (req, res) => {
  const tenant = findTenant(req.params.accessToken);
  if (!tenant) return res.status(404).json({ error: 'Invalid access token' });
  res.json(await callN8n(tenant, 'call_logs.get', { direction: req.query.direction ?? null }));
}));

// Serve built frontend
app.use(express.static(join(ROOT, 'dist')));
app.get('*', (_req, res) => res.sendFile(join(ROOT, 'dist/index.html')));

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));

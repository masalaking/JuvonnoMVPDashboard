import 'dotenv/config';
import express from 'express';
import { readFileSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { randomUUID } from 'crypto';
import { prisma } from './db.js';
import { requireSession, requireCsrf, requireClinicAccess, requireRole, verifyCredentials, clinicsForUser, issueSession, clearSession, rateLimit } from './auth.js';
import * as n8nProd from './n8n.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = join(__dirname, '..');

const PORT = process.env.API_PORT ?? 3001;
const DASHBOARD_API_KEY = process.env.DASHBOARD_API_KEY ?? '';
// Optional: shared secret n8n's Payment Recovery workflow can require via an
// X-Dashboard-Secret header. Sent only when configured so tenants that
// haven't set this yet keep working exactly as before (billing/recovery
// routes all funnel through callN8n below).
const N8N_DASHBOARD_SECRET = process.env.N8N_DASHBOARD_SECRET ?? '';
// Same credential n8n's production webhooks send (server/n8n.js uses this
// pair outbound; this is the inbound direction - verifying n8n's calls TO us).
const N8N_DASHBOARD_AUTH_HEADER = (process.env.N8N_DASHBOARD_AUTH_HEADER ?? 'Authorization').toLowerCase();
const N8N_DASHBOARD_AUTH_VALUE = process.env.N8N_DASHBOARD_AUTH_VALUE ?? '';
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
  let res;
  try {
    res = await fetch(tenant.n8n_webhook_url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(N8N_DASHBOARD_SECRET ? { 'X-Dashboard-Secret': N8N_DASHBOARD_SECRET } : {}),
      },
      body: JSON.stringify({
        event,
        client_id: tenant.client_id,
        clinic_id: tenant.clinic_id,
        clinic_name: tenant.clinic_name,
        ...payload,
      }),
      signal: AbortSignal.timeout(15_000),
    });
  } catch (error) {
    const err = new Error(error?.name === 'TimeoutError'
      ? 'The payment recovery service timed out'
      : 'The payment recovery service is unavailable');
    err.status = error?.name === 'TimeoutError' ? 504 : 502;
    throw err;
  }
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

// The Inbound Tracker n8n workflow (overview / analytics / calls / transcripts
// / invoices) uses a different calling convention than callN8n above: separate
// GET webhooks per path (e.g. /webhook/<client_id>/calls), each expecting a
// `tenantId` query param, rather than one shared webhook keyed by an `event`
// field. Each clinic gets its own copy of this workflow imported into the
// same n8n instance under a path prefix matching its own client_id - so
// multi-tenancy needs no new config field, just naming each clinic's webhook
// paths to match its client_id when that clinic's workflow copy is set up.
const INBOUND_TRACKER_HOST = 'https://n8n.getnapsolutions.com/webhook';

async function callInboundTracker(tenant, path, query = {}) {
  const url = new URL(`${INBOUND_TRACKER_HOST}/${tenant.client_id}/${path.replace(/^\/+/, '')}`);
  url.searchParams.set('tenantId', tenant.access_token);
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== null) url.searchParams.set(key, String(value));
  }
  const res = await fetch(url);
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

// The Outbound Tracker n8n workflow is a SEPARATE workflow from the inbound
// one, with its own webhook prefix - for this tenant it's literally
// "juvonno-outbound/<path>", not "<client_id>/outbound-<path>" under the
// inbound prefix. Mirrors callInboundTracker's request/response handling,
// just against `<client_id>-outbound/<path>` instead of `<client_id>/<path>`.
async function callOutboundTracker(tenant, path, query = {}) {
  const url = new URL(`${INBOUND_TRACKER_HOST}/${tenant.client_id}-outbound/${path.replace(/^\/+/, '')}`);
  url.searchParams.set('tenantId', tenant.access_token);
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== null) url.searchParams.set(key, String(value));
  }
  const res = await fetch(url);
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

// POST variant for outbound-tracker-prefixed webhooks that take a body
// instead of query params (e.g. the "Make a Call" batch-call trigger).
// Passes through n8n's response body AND status code, since that workflow
// deliberately responds 400 with { success:false, invalidRows } on bad
// input rather than a generic 502 - the caller needs to see that shape.
async function postToOutboundTracker(tenant, path, body) {
  const url = `${INBOUND_TRACKER_HOST}/${tenant.client_id}-outbound/${path.replace(/^\/+/, '')}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let json;
  try { json = text ? JSON.parse(text) : {}; } catch { json = { raw: text }; }
  return { status: res.status, json };
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

// The entire /api/link/:accessToken/* MVP surface below is retired - the
// dashboard is session-only now (real login, per-clinic authorization via
// user_clinic_access). This blanket 410 sits before every /api/link route
// definition so none of them are reachable anymore, without deleting the
// route bodies themselves (kept only as reference/rollback material).
app.use('/api/link', (_req, res) => {
  res.status(410).json({ error: { code: 'GONE', message: 'Access-token links have been retired. Please sign in.', retryable: false } });
});

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

// Read-only settings lookup by client_id (no access token) — used by the
// n8n "Juvonno Settings Backend" workflow's "Get Receptionist Config" chain,
// so it can read settings directly from this server's synchronous file
// storage instead of relying on n8n's own workflow static data (which is
// unreliable for fast read-after-write between separate executions).
app.get('/api/settings-by-client/:clientId', (req, res) => {
  const apiKey = req.headers['x-dashboard-api-key'];
  if (!DASHBOARD_API_KEY || apiKey !== DASHBOARD_API_KEY) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  const all = loadSettings();
  const existing = all[req.params.clientId];
  if (!existing) return res.status(404).json({ error: 'No settings found' });
  res.json({
    success: true,
    client_id: req.params.clientId,
    updated_at: new Date().toISOString(),
    settings: buildN8nAllSettings(existing),
  });
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

// ── Payment Recovery (AI-call based) ────────────────────────────────────────
// Separate from the `billing.*` endpoints above, which are the older
// SMS/email-reminder model. This is the AI-outbound-call recovery workflow
// (JUVONNO_PAYMENT_RECOVERY_DASHBOARD spec): Day-3 payment request -> Day-7/14
// Retell call queue -> staff approval -> dispatch -> outcome -> reconciliation.
// Same proxy pattern as callN8n - the n8n workflow just needs to listen for
// these exact event names on the tenant's n8n_webhook_url.
// Consolidated snapshot (metrics + invoices + queue + calls + activity +
// settings in one response) so PaymentRecoveryScreen can make one request
// instead of six. The individual routes below stay in place for backward
// compatibility - nothing currently calling them breaks.
app.get('/api/link/:accessToken/recovery/snapshot', n8nRoute(async (req, res) => {
  const tenant = findTenant(req.params.accessToken);
  if (!tenant) return res.status(404).json({ error: 'Invalid access token' });
  res.json(await callN8n(tenant, 'recovery.get_snapshot'));
}));

app.get('/api/link/:accessToken/recovery/overview', n8nRoute(async (req, res) => {
  const tenant = findTenant(req.params.accessToken);
  if (!tenant) return res.status(404).json({ error: 'Invalid access token' });
  res.json(await callN8n(tenant, 'recovery.get_overview'));
}));

app.get('/api/link/:accessToken/recovery/invoices', n8nRoute(async (req, res) => {
  const tenant = findTenant(req.params.accessToken);
  if (!tenant) return res.status(404).json({ error: 'Invalid access token' });
  res.json(await callN8n(tenant, 'recovery.get_invoices'));
}));

app.get('/api/link/:accessToken/recovery/queue', n8nRoute(async (req, res) => {
  const tenant = findTenant(req.params.accessToken);
  if (!tenant) return res.status(404).json({ error: 'Invalid access token' });
  res.json(await callN8n(tenant, 'recovery.get_queue'));
}));

app.get('/api/link/:accessToken/recovery/calls', n8nRoute(async (req, res) => {
  const tenant = findTenant(req.params.accessToken);
  if (!tenant) return res.status(404).json({ error: 'Invalid access token' });
  res.json(await callN8n(tenant, 'recovery.get_calls'));
}));

app.get('/api/link/:accessToken/recovery/activity', n8nRoute(async (req, res) => {
  const tenant = findTenant(req.params.accessToken);
  if (!tenant) return res.status(404).json({ error: 'Invalid access token' });
  res.json(await callN8n(tenant, 'recovery.get_activity'));
}));

app.get('/api/link/:accessToken/recovery/settings', n8nRoute(async (req, res) => {
  const tenant = findTenant(req.params.accessToken);
  if (!tenant) return res.status(404).json({ error: 'Invalid access token' });
  res.json(await callN8n(tenant, 'recovery.get_settings'));
}));

app.post('/api/link/:accessToken/recovery/settings', n8nRoute(async (req, res) => {
  const tenant = findTenant(req.params.accessToken);
  if (!tenant) return res.status(404).json({ error: 'Invalid access token' });
  res.json(await callN8n(tenant, 'recovery.settings_changed', { settings: req.body }));
}));

app.post('/api/link/:accessToken/recovery/queue/approve', n8nRoute(async (req, res) => {
  const tenant = findTenant(req.params.accessToken);
  if (!tenant) return res.status(404).json({ error: 'Invalid access token' });
  res.json(await callN8n(tenant, 'recovery.queue.approve', { queue_ids: req.body?.queueIds ?? [] }));
}));

app.post('/api/link/:accessToken/recovery/queue/reject', n8nRoute(async (req, res) => {
  const tenant = findTenant(req.params.accessToken);
  if (!tenant) return res.status(404).json({ error: 'Invalid access token' });
  res.json(await callN8n(tenant, 'recovery.queue.reject', { queue_ids: req.body?.queueIds ?? [], reason: req.body?.reason }));
}));

function recoveryInvoiceAction(event) {
  return n8nRoute(async (req, res) => {
    const tenant = findTenant(req.params.accessToken);
    if (!tenant) return res.status(404).json({ error: 'Invalid access token' });
    res.json(await callN8n(tenant, event, { invoice_id: req.params.invoiceId, reason: req.body?.reason }));
  });
}

app.post('/api/link/:accessToken/recovery/invoices/:invoiceId/hold', recoveryInvoiceAction('recovery.invoice.hold'));
app.post('/api/link/:accessToken/recovery/invoices/:invoiceId/resume', recoveryInvoiceAction('recovery.invoice.resume'));
app.post('/api/link/:accessToken/recovery/invoices/:invoiceId/reconcile', recoveryInvoiceAction('recovery.invoice.reconcile'));
app.post('/api/link/:accessToken/recovery/invoices/:invoiceId/escalate', recoveryInvoiceAction('recovery.invoice.escalate'));

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

// ── Inbound Tracker endpoints ────────────────────────────────────────────────
// Proxies to the "Juvonno Inbound Tracker" n8n workflow's own GET webhooks
// (juvonno/overview, juvonno/analytics, juvonno/calls, juvonno/transcripts,
// juvonno/invoices), which read call/billing history from Google Sheets.
// Distinct from callN8n/call-logs above, which use a different (event-based)
// workflow convention.
app.get('/api/link/:accessToken/inbound/overview', n8nRoute(async (req, res) => {
  const tenant = findTenant(req.params.accessToken);
  if (!tenant) return res.status(404).json({ error: 'Invalid access token' });
  res.json(await callInboundTracker(tenant, 'overview'));
}));

app.get('/api/link/:accessToken/inbound/analytics', n8nRoute(async (req, res) => {
  const tenant = findTenant(req.params.accessToken);
  if (!tenant) return res.status(404).json({ error: 'Invalid access token' });
  res.json(await callInboundTracker(tenant, 'analytics', { range: req.query.range ?? 1 }));
}));

app.get('/api/link/:accessToken/inbound/calls', n8nRoute(async (req, res) => {
  const tenant = findTenant(req.params.accessToken);
  if (!tenant) return res.status(404).json({ error: 'Invalid access token' });
  res.json(await callInboundTracker(tenant, 'calls'));
}));

app.get('/api/link/:accessToken/inbound/transcripts', n8nRoute(async (req, res) => {
  const tenant = findTenant(req.params.accessToken);
  if (!tenant) return res.status(404).json({ error: 'Invalid access token' });
  res.json(await callInboundTracker(tenant, 'transcripts'));
}));

app.get('/api/link/:accessToken/inbound/invoices', n8nRoute(async (req, res) => {
  const tenant = findTenant(req.params.accessToken);
  if (!tenant) return res.status(404).json({ error: 'Invalid access token' });
  res.json(await callInboundTracker(tenant, 'invoices'));
}));

// ── Outbound Tracker endpoints ───────────────────────────────────────────────
// Proxies to the "Juvonno Outbound Tracker" n8n workflow's own GET webhooks
// (<client_id>-outbound/overview, /analytics, /calls, /transcripts,
// /invoices) - a separate workflow from the inbound one, with its own
// Google Sheet, so these use callOutboundTracker rather than
// callInboundTracker even though the response shapes are identical.
app.get('/api/link/:accessToken/outbound/overview', n8nRoute(async (req, res) => {
  const tenant = findTenant(req.params.accessToken);
  if (!tenant) return res.status(404).json({ error: 'Invalid access token' });
  res.json(await callOutboundTracker(tenant, 'overview'));
}));

app.get('/api/link/:accessToken/outbound/analytics', n8nRoute(async (req, res) => {
  const tenant = findTenant(req.params.accessToken);
  if (!tenant) return res.status(404).json({ error: 'Invalid access token' });
  res.json(await callOutboundTracker(tenant, 'analytics', { range: req.query.range ?? 1 }));
}));

app.get('/api/link/:accessToken/outbound/calls', n8nRoute(async (req, res) => {
  const tenant = findTenant(req.params.accessToken);
  if (!tenant) return res.status(404).json({ error: 'Invalid access token' });
  res.json(await callOutboundTracker(tenant, 'calls'));
}));

app.get('/api/link/:accessToken/outbound/transcripts', n8nRoute(async (req, res) => {
  const tenant = findTenant(req.params.accessToken);
  if (!tenant) return res.status(404).json({ error: 'Invalid access token' });
  res.json(await callOutboundTracker(tenant, 'transcripts'));
}));

app.get('/api/link/:accessToken/outbound/invoices', n8nRoute(async (req, res) => {
  const tenant = findTenant(req.params.accessToken);
  if (!tenant) return res.status(404).json({ error: 'Invalid access token' });
  res.json(await callOutboundTracker(tenant, 'invoices'));
}));

// Triggers the "Make a Call" batch-call workflow - body:
// { contacts: [{phone_number, first_name?, last_name?, full_name?}, ...], name?: string }
// Matches the outbound tracker's recipient contract (see
// FRONTEND_HANDOFF.md). clinic_id/client_id are set here from the resolved
// tenant rather than trusted from the request body, so the browser can't
// spoof which clinic a batch call is billed/logged against.
app.post('/api/link/:accessToken/outbound/make-call', n8nRoute(async (req, res) => {
  const tenant = findTenant(req.params.accessToken);
  if (!tenant) return res.status(404).json({ error: 'Invalid access token' });
  const { contacts, name } = req.body ?? {};
  if (!Array.isArray(contacts) || contacts.length === 0) {
    return res.status(400).json({ success: false, error: 'contacts must be a non-empty array' });
  }
  const normalized = contacts.map((c) => {
    const phone_number = String(c?.phone_number ?? c?.phoneNumber ?? '').trim();
    const first_name = String(c?.first_name ?? c?.firstName ?? '').trim();
    const last_name = String(c?.last_name ?? c?.lastName ?? '').trim();
    const full_name = String(c?.full_name ?? c?.fullName ?? '').trim() || [first_name, last_name].filter(Boolean).join(' ');
    return { phone_number, first_name, last_name, full_name, clinic_id: tenant.clinic_id, client_id: tenant.client_id };
  });
  if (normalized.some(c => !c.phone_number)) {
    return res.status(400).json({ success: false, error: 'Every contact must have a phone_number' });
  }
  const { status, json } = await postToOutboundTracker(tenant, 'make-call', { contacts: normalized, name });
  res.status(status).json(json);
}));

// ═══════════════════════════════════════════════════════════════════════════
// Production RivaCare API (RIVACARE-FRONTEND-DEVELOPER-HANDOFF.md) — replaces
// the /api/link/:accessToken/* MVP surface above with server-controlled
// sessions, verified (tenant_id, clinic_id) scoping via Prisma/Postgres, and
// the new shared n8n webhook contracts (server/n8n.js). The legacy routes
// above are left untouched for backward compatibility during migration
// (handoff §3.4) — nothing that currently works stops working.
// ═══════════════════════════════════════════════════════════════════════════

// Uniform error contract (handoff §13): { error: { code, message, retryable } }.
// Distinct from the legacy n8nRoute() above, which keeps its old flat shape
// so existing /api/link/* callers don't see a breaking change.
function apiRoute(handler) {
  return async (req, res) => {
    try {
      await handler(req, res);
    } catch (err) {
      const status = err.status ?? 502;
      const code = err.code ?? (
        status === 401 ? 'UNAUTHENTICATED' :
        status === 403 ? 'FORBIDDEN' :
        status === 400 ? 'VALIDATION_ERROR' :
        status === 404 ? 'NOT_FOUND' :
        status === 409 ? 'CONFLICT' :
        status === 429 ? 'RATE_LIMITED' :
        status >= 500 ? 'UPSTREAM_UNAVAILABLE' : 'ERROR'
      );
      if (status >= 500) console.error(`[api] ${req.method} ${req.originalUrl} failed:`, err.message);
      res.status(status).json({ error: { code, message: err.message ?? 'Request failed', retryable: [429, 502, 503, 504].includes(status) } });
    }
  };
}

function badRequest(message, code = 'VALIDATION_ERROR') {
  const err = new Error(message);
  err.status = 400;
  err.code = code;
  return err;
}

// ── Auth (§5) ────────────────────────────────────────────────────────────────
app.post('/api/auth/login', rateLimit('login', 10, 60_000), apiRoute(async (req, res) => {
  const { username, password } = req.body ?? {};
  if (!username || !password) throw badRequest('username and password are required.');
  const user = await verifyCredentials(username, password);
  if (!user) {
    const err = new Error('Invalid username or password.');
    err.status = 401;
    err.code = 'UNAUTHENTICATED';
    throw err;
  }
  const clinics = await clinicsForUser(user.id, user.tenant_id);
  const activeClinicId = clinics[0]?.clinicId ?? null;
  const csrfToken = issueSession(res, { userId: user.id, tenantId: user.tenant_id, activeClinicId });
  res.json({ userId: user.id, tenantId: user.tenant_id, clinics, activeClinicId, csrfToken });
}));

app.post('/api/auth/logout', requireSession, requireCsrf, apiRoute(async (req, res) => {
  clearSession(res);
  res.json({ ok: true });
}));

app.get('/api/auth/session', requireSession, apiRoute(async (req, res) => {
  const clinics = await clinicsForUser(req.session.userId, req.session.tenantId);
  res.json({ userId: req.session.userId, tenantId: req.session.tenantId, activeClinicId: req.session.activeClinicId ?? null, clinics });
}));

// ── Clinic selection (§5, §12) ───────────────────────────────────────────────
app.get('/api/clinics', requireSession, apiRoute(async (req, res) => {
  const clinics = await clinicsForUser(req.session.userId, req.session.tenantId);
  res.json({ tenantId: req.session.tenantId, clinics, activeClinicId: req.session.activeClinicId ?? clinics[0]?.clinicId ?? null });
}));

app.post('/api/session/active-clinic', requireSession, requireCsrf, apiRoute(async (req, res) => {
  const clinicId = String(req.body?.clinicId ?? '');
  if (!clinicId) throw badRequest('clinicId is required.');
  const access = await prisma.user_clinic_access.findUnique({
    where: { user_id_tenant_id_clinic_id: { user_id: req.session.userId, tenant_id: req.session.tenantId, clinic_id: clinicId } },
  });
  if (!access) {
    const err = new Error('You do not have access to this clinic.');
    err.status = 403;
    err.code = 'FORBIDDEN';
    throw err;
  }
  const csrfToken = issueSession(res, { userId: req.session.userId, tenantId: req.session.tenantId, activeClinicId: clinicId });
  res.json({ activeClinicId: clinicId, csrfToken });
}));

// Every /api/dashboard/* route requires a valid session AND a verified
// (tenant_id, clinic_id) the session's user actually has access to.
const dashboardAuth = [requireSession, requireCsrf, requireClinicAccess];

// ── Staff Action Queue (n8n → us) ────────────────────────────────────────────
// The AI Receptionist workflow's "Send Booking/Reschedule/Cancellation to
// Staff Action Queue" nodes POST here once someone points them at this
// server's real URL and re-enables them (currently disabled, pointed at
// https://disabled.invalid/... as a placeholder - that's an n8n-side edit,
// not something this server controls). Backed by the `requests` table,
// which is the production replacement for the legacy requests.json file.
function requireN8nAuth(req, res, next) {
  if (!N8N_DASHBOARD_AUTH_VALUE) {
    return res.status(503).json({ error: { code: 'UPSTREAM_UNAVAILABLE', message: 'N8N_DASHBOARD_AUTH_VALUE is not configured.', retryable: false } });
  }
  if (req.headers[N8N_DASHBOARD_AUTH_HEADER] !== N8N_DASHBOARD_AUTH_VALUE) {
    return res.status(401).json({ error: { code: 'UNAUTHENTICATED', message: 'Invalid or missing dashboard auth header.', retryable: false } });
  }
  next();
}

app.post('/api/webhooks/staff-action', requireN8nAuth, apiRoute(async (req, res) => {
  const payload = req.body ?? {};
  const metadata = payload.metadata ?? {};
  const tenantId = String(metadata.client_id ?? metadata.tenant_id ?? payload.tenant_id ?? '').trim();
  const clinicId = String(metadata.clinic_id ?? payload.clinic_id ?? '').trim();
  if (!tenantId || !clinicId) throw badRequest('metadata.client_id/tenant_id and metadata.clinic_id are required.');
  const row = await prisma.requests.create({
    data: { tenant_id: tenantId, clinic_id: clinicId, status: 'New', data: payload },
  });
  res.status(201).json({ ok: true, id: row.id });
}));

// Flattens the Postgres row (id/status/created_at columns + `data` JSONB)
// back into the flat shape the existing StaffTask UI already expects.
function flattenRequestRow(row) {
  const data = row.data && typeof row.data === 'object' ? row.data : {};
  return { ...data, id: row.id, status: row.status, created_at: row.created_at.toISOString() };
}

app.get('/api/dashboard/queue/requests', ...dashboardAuth, apiRoute(async (req, res) => {
  const rows = await prisma.requests.findMany({
    where: { tenant_id: req.session.tenantId, clinic_id: req.clinicId },
    orderBy: { created_at: 'desc' },
  });
  res.json(rows.map(flattenRequestRow));
}));

app.patch('/api/dashboard/queue/requests/:id', ...dashboardAuth, apiRoute(async (req, res) => {
  const existing = await prisma.requests.findFirst({
    where: { id: req.params.id, tenant_id: req.session.tenantId, clinic_id: req.clinicId },
  });
  if (!existing) {
    const err = new Error('Request not found.');
    err.status = 404;
    err.code = 'NOT_FOUND';
    throw err;
  }
  const currentData = existing.data && typeof existing.data === 'object' ? existing.data : {};
  const nextData = { ...currentData, ...(req.body ?? {}) };
  delete nextData.id;
  delete nextData.status;
  const status = String(req.body?.status ?? existing.status);
  const updated = await prisma.requests.update({
    where: { id: existing.id },
    data: { status, data: nextData },
  });
  res.json(flattenRequestRow(updated));
}));

app.delete('/api/dashboard/queue/requests/:id', ...dashboardAuth, apiRoute(async (req, res) => {
  const existing = await prisma.requests.findFirst({
    where: { id: req.params.id, tenant_id: req.session.tenantId, clinic_id: req.clinicId },
  });
  if (!existing) {
    const err = new Error('Request not found.');
    err.status = 404;
    err.code = 'NOT_FOUND';
    throw err;
  }
  await prisma.requests.delete({ where: { id: existing.id } });
  res.status(204).end();
}));

// ── Inbound dashboard (§6.2) ─────────────────────────────────────────────────
app.get('/api/dashboard/inbound/overview', ...dashboardAuth, apiRoute(async (req, res) => {
  res.json(await n8nProd.inbound.overview(req.session.tenantId, req.clinicId));
}));
app.get('/api/dashboard/inbound/analytics', ...dashboardAuth, apiRoute(async (req, res) => {
  res.json(await n8nProd.inbound.analytics(req.session.tenantId, req.clinicId, req.query.range));
}));
app.get('/api/dashboard/inbound/calls', ...dashboardAuth, apiRoute(async (req, res) => {
  res.json(await n8nProd.inbound.calls(req.session.tenantId, req.clinicId));
}));
app.get('/api/dashboard/inbound/transcripts', ...dashboardAuth, apiRoute(async (req, res) => {
  res.json(await n8nProd.inbound.transcripts(req.session.tenantId, req.clinicId));
}));
app.get('/api/dashboard/inbound/invoices', ...dashboardAuth, apiRoute(async (req, res) => {
  res.json(await n8nProd.inbound.invoices(req.session.tenantId, req.clinicId));
}));

// ── Outbound dashboard (§6.3) ────────────────────────────────────────────────
app.get('/api/dashboard/outbound/overview', ...dashboardAuth, apiRoute(async (req, res) => {
  res.json(await n8nProd.outbound.overview(req.session.tenantId, req.clinicId));
}));
app.get('/api/dashboard/outbound/analytics', ...dashboardAuth, apiRoute(async (req, res) => {
  res.json(await n8nProd.outbound.analytics(req.session.tenantId, req.clinicId, req.query.range));
}));
app.get('/api/dashboard/outbound/calls', ...dashboardAuth, apiRoute(async (req, res) => {
  res.json(await n8nProd.outbound.calls(req.session.tenantId, req.clinicId));
}));
app.get('/api/dashboard/outbound/transcripts', ...dashboardAuth, apiRoute(async (req, res) => {
  res.json(await n8nProd.outbound.transcripts(req.session.tenantId, req.clinicId));
}));
app.get('/api/dashboard/outbound/invoices', ...dashboardAuth, apiRoute(async (req, res) => {
  res.json(await n8nProd.outbound.invoices(req.session.tenantId, req.clinicId));
}));

// ── Settings (§6.1, §8) ──────────────────────────────────────────────────────
// /juvonno-settings-config (internal receptionist config, decrypted Juvonno
// key) is intentionally never proxied here - only the public/redacted read
// and the write-only save are reachable from the browser.
app.get('/api/dashboard/settings', ...dashboardAuth, apiRoute(async (req, res) => {
  res.json(await n8nProd.getPublicSettings(req.session.tenantId, req.clinicId));
}));
app.put('/api/dashboard/settings', ...dashboardAuth, requireRole('owner', 'admin'), rateLimit('settings-save', 20, 60_000), apiRoute(async (req, res) => {
  const payload = { ...(req.body ?? {}), tenant_id: req.session.tenantId, clinic_id: req.clinicId };
  res.json(await n8nProd.saveSettings(payload));
}));
app.get('/api/dashboard/settings/retell-options', ...dashboardAuth, requireRole('owner', 'admin'), rateLimit('retell-options', 30, 5 * 60_000), apiRoute(async (req, res) => {
  res.json(await n8nProd.getRetellOptions(req.session.tenantId, req.clinicId));
}));

// ── Payment Recovery (§6.4) ──────────────────────────────────────────────────
app.get('/api/dashboard/recovery/snapshot', ...dashboardAuth, apiRoute(async (req, res) => {
  res.json(await n8nProd.recoveryEvent('recovery.get_snapshot', req.session.tenantId, req.clinicId));
}));
app.post('/api/dashboard/recovery/queue/approve', ...dashboardAuth, rateLimit('recovery-mutate', 30, 60_000), apiRoute(async (req, res) => {
  res.json(await n8nProd.recoveryEvent('recovery.queue.approve', req.session.tenantId, req.clinicId, { queue_ids: req.body?.queueIds ?? [] }));
}));
app.post('/api/dashboard/recovery/queue/reject', ...dashboardAuth, rateLimit('recovery-mutate', 30, 60_000), apiRoute(async (req, res) => {
  res.json(await n8nProd.recoveryEvent('recovery.queue.reject', req.session.tenantId, req.clinicId, { queue_ids: req.body?.queueIds ?? [], reason: req.body?.reason }));
}));
function recoveryInvoiceRoute(action) {
  return apiRoute(async (req, res) => {
    res.json(await n8nProd.recoveryEvent(`recovery.invoice.${action}`, req.session.tenantId, req.clinicId, { invoice_id: req.params.invoiceId, reason: req.body?.reason }));
  });
}
app.post('/api/dashboard/recovery/invoices/:invoiceId/hold', ...dashboardAuth, rateLimit('recovery-mutate', 30, 60_000), recoveryInvoiceRoute('hold'));
app.post('/api/dashboard/recovery/invoices/:invoiceId/resume', ...dashboardAuth, rateLimit('recovery-mutate', 30, 60_000), recoveryInvoiceRoute('resume'));
app.post('/api/dashboard/recovery/invoices/:invoiceId/escalate', ...dashboardAuth, rateLimit('recovery-mutate', 30, 60_000), recoveryInvoiceRoute('escalate'));
app.post('/api/dashboard/recovery/invoices/:invoiceId/reconcile', ...dashboardAuth, rateLimit('recovery-mutate', 30, 60_000), recoveryInvoiceRoute('reconcile'));
app.put('/api/dashboard/recovery/settings', ...dashboardAuth, rateLimit('settings-save', 20, 60_000), apiRoute(async (req, res) => {
  res.json(await n8nProd.recoveryEvent('recovery.settings_changed', req.session.tenantId, req.clinicId, { settings: req.body ?? {} }));
}));

// Serve built frontend - only the bare root URL serves the app shell.
// Static assets (JS/CSS/favicon under dist/) still resolve via their own
// real paths; everything else (old /t/:token links, typos, probes) 404s
// instead of silently rendering the SPA, so there is exactly one entry
// point into the dashboard.
app.use(express.static(join(ROOT, 'dist')));
app.get('/', (_req, res) => res.sendFile(join(ROOT, 'dist/index.html')));
app.use((_req, res) => res.status(404).send('Not found'));

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));

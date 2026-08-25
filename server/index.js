import 'dotenv/config';
import express from 'express';
import multer from 'multer';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { join, dirname, extname } from 'path';
import { fileURLToPath } from 'url';
import { randomUUID, createHash } from 'crypto';
import { prisma } from './db.js';
import { requireSession, requireCsrf, requireClinicAccess, requireRole, verifyCredentials, clinicsForUser, issueSession, clearSession, rateLimit, readCsrfToken } from './auth.js';
import * as n8nProd from './n8n.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = join(__dirname, '..');

const PORT = process.env.API_PORT ?? 3001;
// Still guards GET /api/settings-by-client/:clientId below, which the n8n
// "Juvonno Settings Backend" workflow calls directly (server-to-server, no
// user session) to read a clinic's settings file.
const DASHBOARD_API_KEY = process.env.DASHBOARD_API_KEY ?? '';
const SETTINGS_FILE = process.env.SETTINGS_FILE ?? join(ROOT, 'data/settings.json');
// Private knowledge-base upload storage (FRONTEND-DEVELOPER-HANDOFF.md - the
// "Knowledge Base Submission Queue" doc). Deliberately NOT under any
// statically-served path - static file serving is restricted to `/` only
// (see the catch-all 404 below), so a file written here is unreachable by
// URL. Files are addressed only by an opaque storage_key returned to the
// browser, never a public URL.
const KNOWLEDGE_UPLOADS_DIR = process.env.KNOWLEDGE_UPLOADS_DIR ?? join(ROOT, 'data/knowledge-uploads');
const KNOWLEDGE_UPLOAD_MAX_BYTES = 50 * 1024 * 1024;
const KNOWLEDGE_UPLOAD_MIME_TYPES = {
  pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
};

const app = express();
app.use(express.json());

// Still backs GET /api/settings-by-client/:clientId below - the n8n
// "Juvonno Settings Backend" workflow reads a clinic's settings from this
// file directly rather than from its own workflow static data (unreliable
// for fast read-after-write between separate executions).
function loadSettings() {
  try { return JSON.parse(readFileSync(SETTINGS_FILE, 'utf-8')); } catch { return {}; }
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
        service_id: String(t.service_id ?? ''),
        product_id: String(t.product_id ?? ''),
        schedule_type_id: String(t.schedule_type_id ?? ''),
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

// The entire /api/link/:accessToken/* MVP surface is retired - the dashboard
// is session-only now (real login, per-clinic authorization via
// user_clinic_access, multi-clinic-prompt.md). This blanket 410 is the only
// thing left mounted at that prefix; every route body that used to live here
// (tenant/queue/settings/billing/recovery/inbound/outbound, all keyed by a
// bare access token) has been deleted along with the JSON-file helpers
// (loadTenants/findTenant/loadRequests/saveRequests/callN8n/
// callInboundTracker/callOutboundTracker/postToOutboundTracker/n8nRoute)
// that only existed to serve it.
app.use('/api/link', (_req, res) => {
  res.status(410).json({ error: { code: 'GONE', message: 'Access-token links have been retired. Please sign in.', retryable: false } });
});

// Read-only settings lookup by client_id (no access token) — used by the
// n8n "Juvonno Settings Backend" workflow's "Get Receptionist Config" chain,
// so it can read settings directly from this server's synchronous file
// storage instead of relying on n8n's own workflow static data (which is
// unreliable for fast read-after-write between separate executions). Kept
// deliberately (multi-clinic-prompt.md §3.3) even though everything else in
// the legacy surface above it is gone - n8n still calls this one directly.
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

// ═══════════════════════════════════════════════════════════════════════════
// Production RivaCare API (RIVACARE-FRONTEND-DEVELOPER-HANDOFF.md,
// multi-clinic-prompt.md) — server-controlled sessions, verified
// (tenant_id, clinic_id) scoping via Prisma/Postgres, and the shared n8n
// webhook contracts (server/n8n.js). This is the only surface the frontend
// talks to now; the legacy /api/link/:accessToken/* MVP surface above it is
// fully retired (410 only, route bodies deleted).
// ═══════════════════════════════════════════════════════════════════════════

// Uniform error contract (handoff §13): { error: { code, message, retryable } }.
function apiRoute(handler) {
  return async (req, res) => {
    try {
      await handler(req, res);
    } catch (err) {
      // err.status is only ever set by errors WE threw on purpose (badRequest,
      // the 401 in /auth/login, requireClinicAccess, etc.) with a message
      // that's already safe to show a user. Anything else - a raw Prisma
      // exception, a network failure, a bug - is unexpected and its message
      // can contain internal details (hostnames, query shapes, stack-adjacent
      // text) that must never reach the browser, so it gets a generic message
      // instead. The real error still goes to the server log either way.
      const isKnown = typeof err.status === 'number';
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
      if (status >= 500) console.error(`[api] ${req.method} ${req.originalUrl} failed:`, err);
      const message = isKnown ? (err.message ?? 'Request failed') : 'Something went wrong. Please try again.';
      res.status(status).json({ error: { code, message, retryable: [429, 502, 503, 504].includes(status) } });
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
  // Only auto-select when there's exactly one clinic to choose from -
  // with 2+, the frontend must show the clinic picker rather than silently
  // landing on whichever clinic happened to sort first (multi-clinic-prompt.md
  // §2: "clinic picker screen after login when 2+ clinics and none selected").
  const activeClinicId = clinics.length === 1 ? clinics[0].clinicId : null;
  const csrfToken = issueSession(res, { userId: user.id, tenantId: user.tenant_id, activeClinicId });
  res.json({ userId: user.id, tenantId: user.tenant_id, clinics, activeClinicId, csrfToken });
}));

app.post('/api/auth/logout', requireSession, requireCsrf, apiRoute(async (req, res) => {
  clearSession(res);
  res.json({ ok: true });
}));

app.get('/api/auth/session', requireSession, apiRoute(async (req, res) => {
  const clinics = await clinicsForUser(req.session.userId, req.session.tenantId);
  // multi-clinic-prompt.md §1.1: a hard reload has a valid session cookie
  // but the rc_csrf cookie can legitimately be missing (e.g. cleared,
  // first load in a new tab context) - never return an empty csrfToken,
  // since that makes every mutation (including switching clinics) 403
  // until the next login. Mint a fresh session+CSRF pair whenever the
  // existing CSRF cookie is missing/empty so the response always carries
  // a usable token.
  let csrfToken = readCsrfToken(req);
  if (!csrfToken) {
    csrfToken = issueSession(res, { userId: req.session.userId, tenantId: req.session.tenantId, activeClinicId: req.session.activeClinicId ?? null });
  }
  res.json({ userId: req.session.userId, tenantId: req.session.tenantId, activeClinicId: req.session.activeClinicId ?? null, clinics, csrfToken });
}));

// ── Clinic selection (§5, §12) ───────────────────────────────────────────────
app.get('/api/clinics', requireSession, apiRoute(async (req, res) => {
  const clinics = await clinicsForUser(req.session.userId, req.session.tenantId);
  // Same single-clinic auto-select rule as login - never default to
  // clinics[0] when there's more than one, that's the picker's job.
  const fallback = clinics.length === 1 ? clinics[0].clinicId : null;
  res.json({ tenantId: req.session.tenantId, clinics, activeClinicId: req.session.activeClinicId ?? fallback });
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

// n8n's appointment-requests webhook always responds HTTP 200, even when the
// business operation was refused (wrong clinic access, missing metadata,
// etc.) - it signals that via `success: false` + `error_code` inside the
// body, not the status code. Reads that did `res.json(result.events ?? [])`
// were swallowing that refusal and turning it into an indistinguishable
// empty collection, so the dashboard showed "no activity" for what was
// actually an access/config failure. This turns success:false into a real
// thrown error instead, same as any other upstream failure.
function requireN8nSuccess(result, fallbackMessage) {
  if (result?.success === true) return result;
  const err = new Error(result?.message || fallbackMessage);
  err.status = result?.error_code === 'CLINIC_ACCESS_FORBIDDEN' ? 403 : 502;
  err.code = result?.error_code || 'N8N_UPSTREAM_FAILED';
  throw err;
}

// ── Staff Action Queue / Appointment Requests (FRONTEND-BFF-HANDOFF.md) ─────
// The AI Receptionist workflow now writes cancellation requests straight
// into Postgres itself (its own Postgres credential, with idempotency keys
// and row-level locking for the actual Juvonno cancellation call) - this
// server no longer receives a push webhook for it and must NOT read/write
// the `requests` / `appointment_events` tables directly, because the n8n
// webhook below is the only thing that knows how to do that safely (it
// joins against user_clinic_access itself, and `approve` does a locked
// re-fetch + cancel + verify against Juvonno that has no business being
// reimplemented in this Express server). Every action here is a thin proxy.
// Status filter defaults to "" (all non-archived statuses) rather than
// "pending" so the dashboard's own filter tabs (Pending/In Progress/
// Completed/etc.) can do client-side filtering across one fetched set,
// same as the legacy queue screen always worked.
app.get('/api/dashboard/queue/requests', ...dashboardAuth, apiRoute(async (req, res) => {
  const result = requireN8nSuccess(
    await n8nProd.appointmentRequests.list(req.session.userId, req.session.tenantId, req.clinicId, req.query.status ?? ''),
    'The appointment request queue could not be loaded.',
  );
  res.json(result.requests ?? []);
}));

app.get('/api/dashboard/queue/requests/:id', ...dashboardAuth, apiRoute(async (req, res) => {
  const result = requireN8nSuccess(
    await n8nProd.appointmentRequests.get(req.session.userId, req.session.tenantId, req.clinicId, req.params.id),
    'The request could not be loaded.',
  );
  res.json(result);
}));

// Approve is cancellation-approval only (per the n8n contract): it re-fetches
// the appointment from Juvonno, cancels it if not already cancelled, verifies
// the cancelled state, and only then marks the request completed - never
// treat a 200 here as done without checking request_status/provider_confirmed.
app.post('/api/dashboard/queue/requests/:id/approve', ...dashboardAuth, rateLimit('queue-mutate', 30, 60_000), apiRoute(async (req, res) => {
  res.json(await n8nProd.appointmentRequests.approve(req.session.userId, req.session.tenantId, req.clinicId, req.params.id));
}));

app.post('/api/dashboard/queue/requests/:id/reject', ...dashboardAuth, rateLimit('queue-mutate', 30, 60_000), apiRoute(async (req, res) => {
  res.json(await n8nProd.appointmentRequests.reject(req.session.userId, req.session.tenantId, req.clinicId, req.params.id, req.body?.resolutionCode, req.body?.resolutionNote));
}));

app.post('/api/dashboard/queue/requests/:id/assign', ...dashboardAuth, rateLimit('queue-mutate', 30, 60_000), apiRoute(async (req, res) => {
  res.json(await n8nProd.appointmentRequests.assign(req.session.userId, req.session.tenantId, req.clinicId, req.params.id, req.body?.assignedUserId));
}));

// Archive replaces delete outright - there is no hard-delete route for
// requests anymore (FRONTEND-BFF-HANDOFF.md: "Remove every hard-delete
// endpoint/button for requests").
app.post('/api/dashboard/queue/requests/:id/archive', ...dashboardAuth, rateLimit('queue-mutate', 30, 60_000), apiRoute(async (req, res) => {
  res.json(await n8nProd.appointmentRequests.archive(req.session.userId, req.session.tenantId, req.clinicId, req.params.id, req.body?.resolutionNote));
}));

// Append-only activity/notifications feed (bookings, lookups, reschedules,
// cancellations, failures) - a separate stream from the actionable queue
// above; only cancellation_requested events have a linked `requests` row.
app.get('/api/dashboard/activity', ...dashboardAuth, apiRoute(async (req, res) => {
  const result = requireN8nSuccess(
    await n8nProd.appointmentRequests.eventsList(req.session.userId, req.session.tenantId, req.clinicId, {
      event_type: req.query.eventType,
      status: req.query.status,
      limit: req.query.limit,
      offset: req.query.offset,
    }),
    'Appointment activity could not be loaded.',
  );
  res.json(result.events ?? []);
}));

app.get('/api/dashboard/activity/:id', ...dashboardAuth, apiRoute(async (req, res) => {
  const result = requireN8nSuccess(
    await n8nProd.appointmentRequests.eventGet(req.session.userId, req.session.tenantId, req.clinicId, req.params.id),
    'The activity record could not be loaded.',
  );
  res.json(result);
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
// ── Outbound Batch Calls (FRONTEND-DEVELOPER-HANDOFF (1).md) ────────────────
// Replaces the old single-shot make-call route above: creating a batch only
// ever writes clinic-scoped database rows (Draft status) - it never touches
// Retell. Only the separate, deliberate /dispatch route below does that.
// FRONTEND-DEVELOPER-HANDOFF-COMBINED.md §3: "Use the same E.164 validation
// everywhere" - this exact pattern, matched on the frontend too.
function isE164Phone(value) {
  return /^\+[1-9]\d{7,14}$/.test(String(value ?? ''));
}

// A network retry must reuse the original idempotency key rather than
// minting a fresh one, or the retry becomes a silent duplicate (handoff
// §1/§4). The browser generates and holds a stable per-attempt token across
// retries of the same logical submit; this only derives the final n8n key
// from it (still server-controlled format/prefix, never trusts the raw
// client value directly) rather than calling randomUUID() on every request.
function stableIdempotencyKey(prefix, clientOperationId) {
  const token = typeof clientOperationId === 'string' && /^[a-zA-Z0-9_-]{8,100}$/.test(clientOperationId)
    ? clientOperationId
    : randomUUID();
  return `${prefix}-${token}`;
}

app.post('/api/dashboard/outbound-batches', ...dashboardAuth, requireRole('owner', 'admin'), rateLimit('outbound-batch-create', 20, 60_000), apiRoute(async (req, res) => {
  const body = req.body ?? {};
  const name = body.name != null ? String(body.name).trim() || undefined : undefined;
  const contactsIn = Array.isArray(body.contacts) ? body.contacts : [];
  if (contactsIn.length === 0) throw badRequest('contacts must be a non-empty array.');
  if (contactsIn.length > 100) throw badRequest('A batch may contain at most 100 contacts.');

  const seenPhones = new Set();
  const contacts = contactsIn.map((c, i) => {
    const phone = String(c?.patient_phone ?? c?.phone_number ?? '').trim();
    if (!isE164Phone(phone)) throw badRequest(`Row ${i + 1}: phone number must be E.164 (e.g. +14165551234).`);
    if (seenPhones.has(phone)) throw badRequest(`Row ${i + 1}: duplicate phone number ${phone} within this batch.`);
    seenPhones.add(phone);
    return {
      contact_external_id: c?.contact_external_id != null ? String(c.contact_external_id) : undefined,
      patient_first_name: String(c?.patient_first_name ?? c?.first_name ?? '').trim(),
      patient_last_name: String(c?.patient_last_name ?? c?.last_name ?? '').trim(),
      patient_phone: phone,
    };
  });

  const payload = { name, contacts, idempotency_key: stableIdempotencyKey('outbound-batch', body.client_operation_id) };
  // Not wrapped in requireN8nSuccess: success:false here can mean a
  // legitimate "duplicate" (same idempotency_key returned the existing
  // draft) rather than a failure - the frontend reads success/duplicate/
  // error_code itself (handoff §3/§4).
  res.json(await n8nProd.outboundBatches.create(req.session.userId, req.session.tenantId, req.clinicId, payload));
}));

app.get('/api/dashboard/outbound-batches', ...dashboardAuth, apiRoute(async (req, res) => {
  const result = requireN8nSuccess(
    await n8nProd.outboundBatches.list(req.session.userId, req.session.tenantId, req.clinicId),
    'The batch history could not be loaded.',
  );
  res.json(result.batches ?? []);
}));

app.get('/api/dashboard/outbound-batches/:id', ...dashboardAuth, apiRoute(async (req, res) => {
  const result = requireN8nSuccess(
    await n8nProd.outboundBatches.get(req.session.userId, req.session.tenantId, req.clinicId, req.params.id),
    'The batch could not be loaded.',
  );
  // Defense in depth: never trust a record whose ownership fields don't
  // match the verified session as belonging to this clinic.
  const record = result?.batch ?? result;
  if (record && (record.tenant_id !== req.session.tenantId || record.clinic_id !== req.clinicId)) {
    return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Batch not found.', retryable: false } });
  }
  res.json(result);
}));

app.post('/api/dashboard/outbound-batches/:id/dispatch', ...dashboardAuth, requireRole('owner', 'admin'), rateLimit('outbound-batch-dispatch', 10, 60_000), apiRoute(async (req, res) => {
  res.json(await n8nProd.outboundBatches.dispatch(req.session.userId, req.session.tenantId, req.clinicId, req.params.id));
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

// ── SMS Follow-Ups (FRONTEND-DEVELOPER-HANDOFF-SMS-ONLY.md) ─────────────────
// Returns only the safe, normalized fields the workflow sends - never
// Twilio credentials, raw provider payloads, or raw n8n errors. Missing
// count values default to 0 rather than surfacing as an error, since a new
// clinic legitimately has no SMS history yet.
app.get('/api/dashboard/sms-follow-ups/status', ...dashboardAuth, apiRoute(async (req, res) => {
  const raw = await n8nProd.getSmsFollowupStatus(req.session.tenantId, req.clinicId);
  const counts = raw?.last_24_hours ?? {};
  res.json({
    success: raw?.success === true,
    provider: raw?.sms_enabled ? String(raw?.provider ?? 'twilio') : null,
    sms_enabled: raw?.sms_enabled === true,
    sender_status: String(raw?.sender_status ?? 'not_configured'),
    masked_from_number: raw?.masked_from_number ? String(raw.masked_from_number) : null,
    last_24_hours: {
      jobs: Number(counts.jobs) || 0,
      pending: Number(counts.pending) || 0,
      sent: Number(counts.sent) || 0,
      delivered: Number(counts.delivered) || 0,
      failed: Number(counts.failed) || 0,
      suppressed: Number(counts.suppressed) || 0,
    },
  });
}));

// ── Knowledge Base Submission Queue (FRONTEND-DEVELOPER-HANDOFF.md) ─────────
// Clinic users submit a website URL, PDF, or DOCX for a RivaCare
// administrator to manually review and add to Retell - this server never
// uploads anything to Retell itself. PDF/DOCX bytes never reach n8n; only
// safe metadata (storage_key/sha256/size) does, per the doc's private
// file upload flow.
function resolveKnowledgeUploadPath(storageKey, tenantId, clinicId) {
  // Scoped to THIS request's verified tenant/clinic, not whatever the
  // browser sent - a storage_key naming a different clinic can never
  // resolve here, structurally, regardless of what string is supplied.
  const prefix = `knowledge-submissions/${tenantId}/${clinicId}/`;
  if (typeof storageKey !== 'string' || !storageKey.startsWith(prefix)) return null;
  const rest = storageKey.slice(prefix.length);
  if (!rest || rest.includes('/') || rest.includes('..')) return null;
  return join(KNOWLEDGE_UPLOADS_DIR, tenantId, clinicId, rest);
}

const knowledgeUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: KNOWLEDGE_UPLOAD_MAX_BYTES, files: 1 },
  fileFilter: (req, file, cb) => {
    const sourceType = String(req.query.sourceType ?? '');
    const expectedMime = KNOWLEDGE_UPLOAD_MIME_TYPES[sourceType];
    if (!expectedMime) return cb(badRequest('sourceType query param must be "pdf" or "docx".'));
    if (file.mimetype !== expectedMime) return cb(badRequest(`File must be ${expectedMime} for sourceType "${sourceType}".`));
    cb(null, true);
  },
});

// Normalizes multer's own error-callback style (which bypasses apiRoute's
// try/catch) into the same { error: { code, message, retryable } } contract
// every other route uses, so a bad upload never falls through to Express's
// default HTML error page.
function knowledgeUploadMiddleware(req, res, next) {
  knowledgeUpload.single('file')(req, res, (err) => {
    if (!err) return next();
    if (err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'File exceeds the 50 MB maximum.', retryable: false } });
    }
    const status = typeof err.status === 'number' ? err.status : 400;
    return res.status(status).json({ error: { code: err.code ?? 'VALIDATION_ERROR', message: err.message ?? 'Upload failed.', retryable: false } });
  });
}

app.post('/api/dashboard/knowledge-submissions/upload', ...dashboardAuth, requireRole('owner', 'admin'), rateLimit('kb-upload', 20, 60_000), knowledgeUploadMiddleware, apiRoute(async (req, res) => {
  if (!req.file) throw badRequest('file is required.');
  const dir = join(KNOWLEDGE_UPLOADS_DIR, req.session.tenantId, req.clinicId);
  mkdirSync(dir, { recursive: true });
  const filename = `${randomUUID()}${extname(req.file.originalname).toLowerCase()}`;
  const sha256 = createHash('sha256').update(req.file.buffer).digest('hex');
  writeFileSync(join(dir, filename), req.file.buffer);
  // Opaque storage_key only - never a public/permanent URL (doc's private
  // upload flow step 3).
  res.json({
    storageKey: `knowledge-submissions/${req.session.tenantId}/${req.clinicId}/${filename}`,
    originalFilename: req.file.originalname,
    mimeType: req.file.mimetype,
    byteSize: req.file.size,
    sha256,
  });
}));

app.post('/api/dashboard/knowledge-submissions', ...dashboardAuth, requireRole('owner', 'admin'), rateLimit('kb-submit', 20, 60_000), apiRoute(async (req, res) => {
  const body = req.body ?? {};
  const sourceType = String(body.source_type ?? '');
  if (!['website', 'pdf', 'docx'].includes(sourceType)) throw badRequest('source_type must be "website", "pdf", or "docx".');
  const title = String(body.title ?? '').trim();
  if (!title) throw badRequest('title is required.');
  if (title.length > 300) throw badRequest('title must be 300 characters or fewer.');
  const requestNote = body.request_note != null ? String(body.request_note) : undefined;
  if (requestNote && requestNote.length > 2000) throw badRequest('request_note must be 2,000 characters or fewer.');

  const payload = { title, request_note: requestNote, source_type: sourceType };

  if (sourceType === 'website') {
    const rawUrl = String(body.website_url ?? '');
    let parsed;
    try {
      parsed = new URL(rawUrl);
    } catch {
      throw badRequest('website_url must be a valid URL.');
    }
    if (parsed.protocol !== 'https:') throw badRequest('website_url must use HTTPS.');
    if (parsed.username || parsed.password) throw badRequest('website_url must not include embedded credentials.');
    payload.website_url = parsed.toString();
    payload.idempotency_key = stableIdempotencyKey('kb-web', body.client_operation_id);
  } else {
    const storageKey = String(body.storage_key ?? '');
    const diskPath = resolveKnowledgeUploadPath(storageKey, req.session.tenantId, req.clinicId);
    if (!diskPath || !existsSync(diskPath)) throw badRequest('storage_key does not match an uploaded file for this clinic.');
    const originalFilename = String(body.original_filename ?? '').trim();
    const sha256 = String(body.sha256 ?? '');
    const byteSize = Number(body.byte_size);
    if (!originalFilename) throw badRequest('original_filename is required.');
    if (!/^[a-f0-9]{64}$/.test(sha256)) throw badRequest('sha256 must be a 64-character lowercase hex string.');
    if (!Number.isFinite(byteSize) || byteSize <= 0) throw badRequest('byte_size is required.');
    payload.storage_provider = 'private_object_storage';
    payload.storage_key = storageKey;
    payload.original_filename = originalFilename;
    payload.mime_type = KNOWLEDGE_UPLOAD_MIME_TYPES[sourceType];
    payload.byte_size = byteSize;
    payload.sha256 = sha256;
    payload.idempotency_key = stableIdempotencyKey('kb-file', body.client_operation_id);
  }

  // Not wrapped in requireN8nSuccess: success:false here can mean a
  // legitimate "duplicate" (same idempotency_key returned the existing
  // record) rather than a failure - the frontend reads success/duplicate/
  // error_code itself (handoff §2/§4), same shape n8n actually sends back.
  res.json(await n8nProd.knowledgeSubmissions.submit(req.session.userId, req.session.tenantId, req.clinicId, payload));
}));

app.get('/api/dashboard/knowledge-submissions', ...dashboardAuth, requireRole('owner', 'admin'), apiRoute(async (req, res) => {
  const result = requireN8nSuccess(
    await n8nProd.knowledgeSubmissions.list(req.session.userId, req.session.tenantId, req.clinicId),
    'The submission history could not be loaded.',
  );
  res.json(result.submissions ?? []);
}));

app.get('/api/dashboard/knowledge-submissions/:id', ...dashboardAuth, requireRole('owner', 'admin'), apiRoute(async (req, res) => {
  const result = requireN8nSuccess(
    await n8nProd.knowledgeSubmissions.get(req.session.userId, req.session.tenantId, req.clinicId, req.params.id),
    'The submission could not be loaded.',
  );
  // Defense in depth: n8n should already scope by the tenant_id/clinic_id we
  // sent, but never trust a record whose ownership fields don't match the
  // verified session as belonging to this clinic (doc acceptance test #1).
  // Normalized to n8n's actual { submission: ... } shape (handoff §4) -
  // never require a `record` property.
  const record = result?.submission ?? result;
  if (record && (record.tenant_id !== req.session.tenantId || record.clinic_id !== req.clinicId)) {
    return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Submission not found.', retryable: false } });
  }
  res.json(result);
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
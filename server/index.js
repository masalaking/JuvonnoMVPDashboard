import 'dotenv/config';
import express from 'express';
import multer from 'multer';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { join, dirname, extname } from 'path';
import { fileURLToPath } from 'url';
import { randomUUID, createHash } from 'crypto';
import { prisma } from './db.js';
import { requireSession, requireCsrf, requireClinicAccess, requireRole, verifyCredentials, clinicsForUser, issueSession, clearSession, rateLimit, readCsrfToken, isLocalDashboardNoLogin } from './auth.js';
import * as n8nProd from './n8n.js';
import { buildManagerSummary, answerManagerQuestion } from './manager-assistant.js';
import { advisorEncryptionReady } from './advisor-crypto.js';
import { createEmbedding, runAdvisor, ADVISOR_MODEL } from './advisor-agent.js';
import { createConversation, listConversations, getConversation, listMessages, saveMessage, archiveConversation, deleteConversation, queueMemoryJob, searchMemories, listMemories, deleteMemory, auditAdvisor } from './advisor-store.js';
import { listRecommendations, createRecommendation, updateRecommendation } from './advisor-recommendations.js';
import { processAdvisorMemoryJobs, startAdvisorMemoryWorker } from './advisor-memory-worker.js';
import { authorizedAdvisorClinicScope } from './advisor-scope.js';
import { createVerifiedRetellProxy, createVerifiedRetellScopedProxy } from './retell-webhooks.js';
import { redactPublicSettingsResponse } from './settings-redaction.js';
import { parsePublicWebsiteUrl } from './public-website-url.js';
import { buildBillingOverview } from './inbound-overview.js';
import { buildInboundCalls, buildInboundTranscripts, buildInboundAnalytics } from './inbound-dashboard.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = join(__dirname, '..');

const PORT = process.env.API_PORT ?? 3001;
// OpenAI is the only supported Advisor provider. Never send an Anthropic key
// to the OpenAI endpoint by treating an old variable name as a fallback.
const OPENAI_API_KEY = process.env.OPENAI_API_KEY ?? '';
const MANAGER_ASSISTANT_MODEL = process.env.MANAGER_ASSISTANT_MODEL ?? 'gpt-5.1';
const ADVISOR_ROLES = new Set(['owner', 'admin']);

function canUseAdvisor(clinics) {
  return isLocalDashboardNoLogin || clinics.some(clinic => ADVISOR_ROLES.has(String(clinic.role).toLowerCase()));
}
// Still guards GET /api/settings-by-client/:clientId below, which the n8n
// "Juvonno Settings Backend" workflow calls directly (server-to-server, no
// user session) to read a clinic's settings file.
const DASHBOARD_API_KEY = process.env.DASHBOARD_API_KEY ?? '';
const RETELL_WEBHOOK_API_KEY = process.env.RETELL_WEBHOOK_API_KEY ?? '';
const N8N_RETELL_CALL_ANALYZED_URL = process.env.N8N_RETELL_CALL_ANALYZED_URL ?? '';
const N8N_RETELL_INBOUND_ROUTER_URL = process.env.N8N_RETELL_INBOUND_ROUTER_URL ?? '';
const N8N_RETELL_RECEPTIONIST_URL = process.env.N8N_RETELL_RECEPTIONIST_URL ?? '';
const N8N_RETELL_OUTBOUND_CALL_ANALYZED_URL = process.env.N8N_RETELL_OUTBOUND_CALL_ANALYZED_URL ?? '';
const N8N_RETELL_OUTBOUND_CONTEXT_URL = process.env.N8N_RETELL_OUTBOUND_CONTEXT_URL ?? '';
const N8N_DASHBOARD_AUTH_HEADER = process.env.N8N_DASHBOARD_AUTH_HEADER ?? 'Authorization';
const N8N_DASHBOARD_AUTH_VALUE = process.env.N8N_DASHBOARD_AUTH_VALUE ?? '';
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
// Database routing uses a normalized destination phone and returns no clinic
// data beyond the server-to-server scope passed to n8n. `LIMIT 2` makes any
// duplicate configuration fail closed rather than selecting arbitrarily.
async function resolveReceptionistClinic(destinationPhone) {
  const rows = await prisma.$queryRaw`
    SELECT cc.tenant_id, cc.clinic_id
    FROM clinic_configs cc
    JOIN tenants t ON t.id = cc.tenant_id
    WHERE cc.status = 'active'
      AND t.status = 'active'
      AND regexp_replace(COALESCE(cc.retell_receptionist_phone_number, ''), '\\D', '', 'g') = ${destinationPhone}
    LIMIT 2
  `;
  return rows.length === 1
    ? { tenantId: String(rows[0].tenant_id), clinicId: String(rows[0].clinic_id) }
    : null;
}
// Retell signature verification needs the original bytes. These routes must
// precede express.json(), and their downstream n8n webhooks must use header
// authentication before a Retell URL is pointed here.
app.post('/webhooks/retell/call-analyzed', express.raw({ type: 'application/json', limit: '2mb' }), createVerifiedRetellProxy({
  webhookKey: RETELL_WEBHOOK_API_KEY,
  targetUrl: N8N_RETELL_CALL_ANALYZED_URL,
  authHeader: N8N_DASHBOARD_AUTH_HEADER,
  authValue: N8N_DASHBOARD_AUTH_VALUE,
}));
app.post('/webhooks/retell/outbound-call-analyzed', express.raw({ type: 'application/json', limit: '2mb' }), createVerifiedRetellProxy({
  webhookKey: RETELL_WEBHOOK_API_KEY,
  targetUrl: N8N_RETELL_OUTBOUND_CALL_ANALYZED_URL,
  authHeader: N8N_DASHBOARD_AUTH_HEADER,
  authValue: N8N_DASHBOARD_AUTH_VALUE,
}));
app.post('/webhooks/retell/outbound-context', express.raw({ type: 'application/json', limit: '256kb' }), createVerifiedRetellProxy({
  webhookKey: RETELL_WEBHOOK_API_KEY,
  targetUrl: N8N_RETELL_OUTBOUND_CONTEXT_URL,
  authHeader: N8N_DASHBOARD_AUTH_HEADER,
  authValue: N8N_DASHBOARD_AUTH_VALUE,
}));
app.post('/webhooks/retell/inbound', express.raw({ type: 'application/json', limit: '256kb' }), createVerifiedRetellScopedProxy({
  webhookKey: RETELL_WEBHOOK_API_KEY,
  targetUrl: N8N_RETELL_INBOUND_ROUTER_URL,
  authHeader: N8N_DASHBOARD_AUTH_HEADER,
  authValue: N8N_DASHBOARD_AUTH_VALUE,
  scopeResolver: resolveReceptionistClinic,
}));
// Retell custom-function calls use a different n8n contract from the inbound
// call router. Keep this target separate so a configuration mistake cannot
// deliver receptionist tool calls to the call-ingestion workflow.
app.post('/webhooks/retell/receptionist', express.raw({ type: 'application/json', limit: '256kb' }), createVerifiedRetellScopedProxy({
  webhookKey: RETELL_WEBHOOK_API_KEY,
  targetUrl: N8N_RETELL_RECEPTIONIST_URL,
  authHeader: N8N_DASHBOARD_AUTH_HEADER,
  authValue: N8N_DASHBOARD_AUTH_VALUE,
  scopeResolver: resolveReceptionistClinic,
}));
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
// Safe for local development and deployment probes: no account, clinic,
// credential, or provider payload is returned. n8n is configuration-checked
// here; its request-level availability is still reported by each source.
app.get('/healthz', async (_req, res) => {
  let database = 'available';
  try { await prisma.$queryRawUnsafe('SELECT 1'); } catch { database = 'unavailable'; }
  const configured = Boolean(process.env.N8N_BASE_URL && process.env.N8N_DASHBOARD_AUTH_VALUE);
  const advisor = advisorEncryptionReady() && Boolean(OPENAI_API_KEY) ? 'configured' : 'unavailable';
  const ok = database === 'available';
  res.status(ok ? 200 : 503).json({ ok, services: { database, n8n: configured ? 'configured' : 'unavailable', advisor } });
});

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
  res.json({ userId: user.id, tenantId: user.tenant_id, clinics, activeClinicId, csrfToken, canViewManagerAssistant: canUseAdvisor(clinics) });
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
  res.json({
    userId: req.session.userId,
    tenantId: req.session.tenantId,
    activeClinicId: req.session.activeClinicId ?? null,
    clinics,
    csrfToken,
    canViewManagerAssistant: canUseAdvisor(clinics),
  });
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

// Demo manager assistant access is intentionally derived from the user's
// current user_clinic_access rows on every request. The browser's eligibility
// flag is presentation only and is never trusted for authorization.
async function requireManagerEligible(req, res, next) {
  try {
    const clinics = await clinicsForUser(req.session.userId, req.session.tenantId);
    const authorized = isLocalDashboardNoLogin ? clinics : clinics.filter(clinic => ADVISOR_ROLES.has(String(clinic.role).toLowerCase()));
    if (!authorized.length) {
      return res.status(403).json({ error: { code: 'MANAGER_ASSISTANT_FORBIDDEN', message: 'Owner or administrator access to at least one clinic is required.', retryable: false } });
    }
    req.managerClinics = authorized;
    next();
  } catch (error) {
    console.error('[manager-assistant] eligibility check failed:', error);
    res.status(502).json({ error: { code: 'MANAGER_ASSISTANT_UNAVAILABLE', message: 'The manager assistant is temporarily unavailable.', retryable: true } });
  }
}

// No database table is required for manager insights. Keep a short-lived,
// process-local cache so normal chat questions do not repeatedly call the
// Juvonno API. A process restart simply clears the cache and the next read
// safely refreshes it.
const managerInsightCache = new Map();
const MANAGER_INSIGHT_CACHE_TTL_MS = 10 * 60_000;

function managerInsightCacheKey(tenantId, clinicId) {
  return `${tenantId}:${clinicId}`;
}

async function managerBusinessOverview(userId, tenantId, clinicId, forceRefresh = false, periodDays = 30) {
  const key = managerInsightCacheKey(tenantId, clinicId);
  const cached = managerInsightCache.get(key);
  if (!forceRefresh && cached && Date.now() - cached.cachedAt < MANAGER_INSIGHT_CACHE_TTL_MS) {
    return cached.value;
  }
  const value = forceRefresh
    ? await n8nProd.managerInsights.refresh(userId, tenantId, clinicId, periodDays)
    : await n8nProd.managerInsights.get(userId, tenantId, clinicId);
  managerInsightCache.set(key, { cachedAt: Date.now(), value });
  return value;
}

async function managerSummaryForRequest(req) {
  return buildManagerSummary({
    tenantId: req.session.tenantId,
    clinics: req.managerClinics,
    inboundOverview: n8nProd.inbound.overview,
    outboundOverview: n8nProd.outbound.overview,
    businessOverview: (tenantId, clinicId) => managerBusinessOverview(req.session.userId, tenantId, clinicId),
  });
}

// Multi-clinic, read-only rollup. This route deliberately does not accept a
// clinic_id: its scope is the full verified access list attached above.
app.get('/api/dashboard/manager/summary', requireSession, requireCsrf, requireManagerEligible, apiRoute(async (req, res) => {
  res.setHeader('Cache-Control', 'private, no-store');
  res.json(await managerSummaryForRequest(req));
}));

// Explicit refresh only: normal chat/summary reads use cached snapshots so a
// manager cannot accidentally create a burst of Juvonno API calls by asking
// several questions. Scope is re-derived from user_clinic_access above.
app.post(
  '/api/dashboard/manager/refresh',
  requireSession,
  requireCsrf,
  requireManagerEligible,
  rateLimit('manager-insights-refresh', 3, 15 * 60_000),
  apiRoute(async (req, res) => {
    const periodDays = Math.min(90, Math.max(7, Number(req.body?.periodDays) || 30));
    const refreshed = await Promise.allSettled(req.managerClinics.map(clinic =>
      managerBusinessOverview(req.session.userId, req.session.tenantId, clinic.clinicId, true, periodDays)
    ));
    const results = refreshed.map((result, index) => ({
      clinicId: req.managerClinics[index].clinicId,
      clinicName: req.managerClinics[index].clinicName,
      success: result.status === 'fulfilled',
      generatedAt: result.status === 'fulfilled' ? result.value?.snapshot?.generated_at ?? null : null,
    }));
    res.setHeader('Cache-Control', 'private, no-store');
    res.status(results.some(result => result.success) ? 200 : 502).json({
      success: results.every(result => result.success),
      partial: results.some(result => result.success) && results.some(result => !result.success),
      results,
    });
  }),
);

// ── Production Clinic Advisor conversations and semantic memory ─────────────
function advisorClinicScope(req, requested) {
  return authorizedAdvisorClinicScope(req.managerClinics.map(clinic => clinic.clinicId), requested);
}

function advisorDateRange(body = {}) {
  const end = /^\d{4}-\d{2}-\d{2}$/.test(String(body.end_date ?? '')) ? String(body.end_date) : new Date().toISOString().slice(0,10);
  const fallback = new Date(`${end}T00:00:00Z`); fallback.setUTCDate(fallback.getUTCDate()-30);
  const start = /^\d{4}-\d{2}-\d{2}$/.test(String(body.start_date ?? '')) ? String(body.start_date) : fallback.toISOString().slice(0,10);
  if (start > end) throw badRequest('start_date must not be after end_date.', 'INVALID_ADVISOR_DATE_RANGE');
  return { start, end };
}

// The model receives an explicit availability envelope so a failed provider
// endpoint can never be casually interpreted as a confirmed zero. The n8n
// workflow remains the source of truth for the actual records.
function normalizeAdvisorToolResult(result) {
  const payload = result && typeof result === 'object' ? result : { success: false };
  const live = Array.isArray(payload?.data?.juvonno_live) ? payload.data.juvonno_live : [];
  const availability = live.map(row => ({
    clinic_id: row?.clinic_id ?? null,
    status: row?.available === true ? 'available' : 'unavailable',
    reason: row?.reason ?? null,
    warnings: Array.isArray(row?.warnings) ? row.warnings : [],
  }));
  if (!availability.length && payload.success === true) availability.push({ clinic_id: null, status: 'available', reason: null, warnings: [] });
  return { ...payload, availability };
}

function ensureAdvisorReady() {
  if (!advisorEncryptionReady()) {
    const error = new Error('The Advisor encryption key is not configured.'); error.status=503; error.code='ADVISOR_ENCRYPTION_NOT_CONFIGURED'; throw error;
  }
}

app.post('/api/dashboard/manager/conversations', requireSession, requireCsrf, requireManagerEligible, rateLimit('advisor-conversation-create', 20, 60_000), apiRoute(async (req,res) => {
  ensureAdvisorReady();
  const clinicIds=advisorClinicScope(req,req.body?.requested_clinic_ids);
  if (!clinicIds.length) throw badRequest('Select at least one authorized clinic.', 'INVALID_ADVISOR_SCOPE');
  const conversation=await createConversation({tenantId:req.session.tenantId,userId:req.session.userId,title:String(req.body?.title??'New conversation').slice(0,120),clinicIds});
  await auditAdvisor({tenantId:req.session.tenantId,userId:req.session.userId,clinicIds,eventType:'conversation_created',correlationId:randomUUID()});
  res.status(201).json({success:true,conversation});
}));

app.get('/api/dashboard/manager/conversations', requireSession, requireCsrf, requireManagerEligible, apiRoute(async (req,res) => {
  ensureAdvisorReady(); res.setHeader('Cache-Control','private, no-store');
  res.json({success:true,conversations:await listConversations(req.session.tenantId,req.session.userId)});
}));

app.get('/api/dashboard/manager/conversations/:id/messages', requireSession, requireCsrf, requireManagerEligible, apiRoute(async (req,res) => {
  ensureAdvisorReady();
  const conversation=await getConversation(req.session.tenantId,req.session.userId,req.params.id);
  if (!conversation) return res.status(404).json({error:{code:'NOT_FOUND',message:'Conversation not found.',retryable:false}});
  const correlationId=randomUUID();
  await auditAdvisor({tenantId:req.session.tenantId,userId:req.session.userId,clinicIds:conversation.clinic_scope,eventType:'conversation_read',correlationId});
  res.setHeader('Cache-Control','private, no-store');
  res.json({success:true,conversation,messages:await listMessages(req.session.tenantId,req.session.userId,conversation.id)});
}));

app.post('/api/dashboard/manager/conversations/:id/archive', requireSession, requireCsrf, requireManagerEligible, apiRoute(async (req,res) => {
  ensureAdvisorReady(); const ok=await archiveConversation(req.session.tenantId,req.session.userId,req.params.id); res.status(ok?200:404).json({success:ok});
}));

app.delete('/api/dashboard/manager/conversations/:id', requireSession, requireCsrf, requireManagerEligible, rateLimit('advisor-conversation-delete', 10, 60_000), apiRoute(async (req,res) => {
  ensureAdvisorReady(); const id=req.params.id; const correlationId=randomUUID();
  const ok=await deleteConversation(req.session.tenantId,req.session.userId,id);
  if (ok) await auditAdvisor({tenantId:req.session.tenantId,userId:req.session.userId,eventType:'conversation_deleted',correlationId,metadata:{conversation_id_hash:createHash('sha256').update(id).digest('hex')}});
  res.status(ok?200:404).json({success:ok});
}));

app.get('/api/dashboard/manager/memories', requireSession, requireCsrf, requireManagerEligible, rateLimit('advisor-memory-read', 30, 60_000), apiRoute(async (req,res) => {
  ensureAdvisorReady(); const correlationId=randomUUID();
  const memories=await listMemories(req.session.tenantId,req.session.userId,String(req.query.search??''));
  await auditAdvisor({tenantId:req.session.tenantId,userId:req.session.userId,eventType:'memory_list_read',correlationId,metadata:{result_count:memories.length}});
  res.setHeader('Cache-Control','private, no-store'); res.json({success:true,memories});
}));

app.delete('/api/dashboard/manager/memories/:id', requireSession, requireCsrf, requireManagerEligible, rateLimit('advisor-memory-delete', 20, 60_000), apiRoute(async (req,res) => {
  ensureAdvisorReady(); const ok=await deleteMemory(req.session.tenantId,req.session.userId,req.params.id);
  if (ok) await auditAdvisor({tenantId:req.session.tenantId,userId:req.session.userId,eventType:'memory_deleted',correlationId:randomUUID()});
  res.status(ok?200:404).json({success:ok});
}));

// Owners decide whether to accept or implement a recommendation. The Advisor
// can surface evidence, but it never executes outreach or clinic changes.
app.get('/api/dashboard/manager/recommendations', requireSession, requireCsrf, requireManagerEligible, apiRoute(async (req,res) => {
  ensureAdvisorReady();
  const requestedClinic = String(req.query.clinic_id ?? '').trim();
  const clinicIds = requestedClinic ? advisorClinicScope(req, [requestedClinic]) : req.managerClinics.map(clinic => clinic.clinicId);
  if (requestedClinic && !clinicIds.includes(requestedClinic)) {
    return res.status(403).json({error:{code:'FORBIDDEN',message:'You do not have access to this clinic.',retryable:false}});
  }
  const recommendations = await listRecommendations(req.session.tenantId, clinicIds, req.query.status);
  await auditAdvisor({tenantId:req.session.tenantId,userId:req.session.userId,clinicIds,eventType:'recommendations_read',correlationId:randomUUID(),metadata:{result_count:recommendations.length}});
  res.setHeader('Cache-Control','private, no-store'); res.json({success:true,recommendations});
}));

app.post('/api/dashboard/manager/recommendations', requireSession, requireCsrf, requireManagerEligible, rateLimit('advisor-recommendation-create', 20, 60_000), apiRoute(async (req,res) => {
  ensureAdvisorReady();
  const clinicId = String(req.body?.clinic_id ?? '').trim();
  const allowed = new Set(req.managerClinics.map(clinic => clinic.clinicId));
  if (!clinicId) throw badRequest('clinic_id is required.', 'INVALID_RECOMMENDATION');
  if (!allowed.has(clinicId)) {
    const error = new Error('You do not have access to this clinic.'); error.status=403; error.code='FORBIDDEN'; throw error;
  }
  const recommendation = await createRecommendation({tenantId:req.session.tenantId,clinicId,body:req.body,sources:[]});
  await auditAdvisor({tenantId:req.session.tenantId,userId:req.session.userId,clinicIds:[clinicId],eventType:'recommendation_created',correlationId:randomUUID(),metadata:{recommendation_id_hash:createHash('sha256').update(recommendation.id).digest('hex')}});
  res.status(201).json({success:true,recommendation});
}));

app.patch('/api/dashboard/manager/recommendations/:id', requireSession, requireCsrf, requireManagerEligible, rateLimit('advisor-recommendation-update', 30, 60_000), apiRoute(async (req,res) => {
  ensureAdvisorReady();
  const clinicIds=req.managerClinics.map(clinic => clinic.clinicId);
  const recommendation=await updateRecommendation({tenantId:req.session.tenantId,clinicIds,id:req.params.id,body:req.body});
  if (!recommendation) return res.status(404).json({error:{code:'NOT_FOUND',message:'Recommendation not found.',retryable:false}});
  await auditAdvisor({tenantId:req.session.tenantId,userId:req.session.userId,clinicIds:[recommendation.clinic_id],eventType:'recommendation_updated',correlationId:randomUUID(),metadata:{recommendation_id_hash:createHash('sha256').update(recommendation.id).digest('hex'),status:recommendation.implementation_status}});
  res.json({success:true,recommendation});
}));

app.get('/api/dashboard/manager/sources/:messageId', requireSession, requireCsrf, requireManagerEligible, apiRoute(async (req,res) => {
  ensureAdvisorReady();
  const rows=await prisma.$queryRawUnsafe(`SELECT m.sources FROM advisor_messages m JOIN advisor_conversations c ON c.id=m.conversation_id WHERE m.id=$1 AND m.tenant_id=$2 AND c.user_id=$3 AND m.deleted_at IS NULL`,req.params.messageId,req.session.tenantId,req.session.userId);
  if (!rows[0]) return res.status(404).json({error:{code:'NOT_FOUND',message:'Message not found.',retryable:false}});
  res.setHeader('Cache-Control','private, no-store'); res.json({success:true,sources:rows[0].sources??[]});
}));

app.post('/api/dashboard/manager/conversations/:id/messages', requireSession, requireCsrf, requireManagerEligible, rateLimit('advisor-chat', 20, 60_000), async (req,res) => {
  const correlationId=randomUUID();
  try {
    ensureAdvisorReady();
    const message=String(req.body?.message??'').trim();
    if (message.length<2||message.length>2000) throw badRequest('message must contain between 2 and 2000 characters.','INVALID_ADVISOR_MESSAGE');
    const conversation=await getConversation(req.session.tenantId,req.session.userId,req.params.id);
    if (!conversation) { res.status(404).json({error:{code:'NOT_FOUND',message:'Conversation not found.',retryable:false}}); return; }
    const conversationScope=Array.isArray(conversation.clinic_scope)?conversation.clinic_scope:[];
    const clinicIds=advisorClinicScope(req,req.body?.requested_clinic_ids).filter(id=>conversationScope.includes(id));
    if (!clinicIds.length) { res.status(403).json({error:{code:'FORBIDDEN',message:'No authorized clinic remains in this conversation scope.',retryable:false}}); return; }
    const dates=advisorDateRange(req.body);
    res.status(200); res.setHeader('Content-Type','text/event-stream; charset=utf-8'); res.setHeader('Cache-Control','private, no-store'); res.setHeader('X-Accel-Buffering','no'); res.flushHeaders?.();
    const emit=(event,data)=>res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    emit('conversation',{id:conversation.id}); emit('status',{message:'Reviewing the authorized clinic data…'});
    const userMessageId=await saveMessage({conversationId:conversation.id,tenantId:req.session.tenantId,userId:req.session.userId,role:'user',content:message});
    const history=await listMessages(req.session.tenantId,req.session.userId,conversation.id,12);
    let memories=[];
    try {
      const queryEmbedding=await createEmbedding(OPENAI_API_KEY,message);
      memories=await searchMemories({tenantId:req.session.tenantId,userId:req.session.userId,clinicIds,embedding:queryEmbedding,limit:6});
      await auditAdvisor({tenantId:req.session.tenantId,userId:req.session.userId,clinicIds,eventType:'memory_retrieval',correlationId,metadata:{result_count:memories.length}});
    } catch (error) { emit('status',{message:'Long-term memory is unavailable; continuing with live data.'}); }
    let result;
    try {
      result=await runAdvisor({apiKey:OPENAI_API_KEY,messages:history,memories,authorizedClinicIds:clinicIds,dateRange:dates,executeTool:async args=>{
        if (args.action==='advisor.patient_lookup' && !args.patient_identifier) return {success:false,error_code:'SPECIFIC_PATIENT_IDENTIFIER_REQUIRED',message:'Ask for a specific patient identifier.',sources:[]};
        if (['advisor.appointment_details','advisor.call_transcript_details'].includes(args.action) && !args.detail_identifier) return {success:false,error_code:'SPECIFIC_DETAIL_IDENTIFIER_REQUIRED',message:'Ask for a specific appointment or call identifier.',sources:[]};
        if (args.action==='advisor.practitioner_revenue' && !args.practitioner_identifier) return {success:false,error_code:'SPECIFIC_PRACTITIONER_IDENTIFIER_REQUIRED',message:'Ask for a specific practitioner name or staff number.',sources:[]};
        if (['advisor.recommendation_tracking','advisor.recommendation_measurement'].includes(args.action)) {
          const recommendations=await listRecommendations(req.session.tenantId,args.clinic_ids);
          const sources=args.clinic_ids.map(clinicId=>({source_name:'Recommendation tracking',clinic_id:clinicId,date_start:args.start_date,date_end:args.end_date,freshness:'stored outcome records'}));
          await auditAdvisor({tenantId:req.session.tenantId,userId:req.session.userId,clinicIds:args.clinic_ids,eventType:'tool_execution',toolName:args.action,status:'success',correlationId});
          return {success:true,recommendations,sources};
        }
        const toolResult=normalizeAdvisorToolResult(await n8nProd.runManagerAnalystTool({action:args.action,userId:req.session.userId,tenantId:req.session.tenantId,clinicIds:args.clinic_ids,startDate:args.start_date||dates.start,endDate:args.end_date||dates.end,patientIdentifier:args.patient_identifier,detailIdentifier:args.detail_identifier,practitionerIdentifier:args.practitioner_identifier,correlationId}));
        await auditAdvisor({tenantId:req.session.tenantId,userId:req.session.userId,clinicIds:args.clinic_ids,eventType:args.action==='advisor.patient_lookup'?'patient_lookup':'tool_execution',toolName:args.action,status:toolResult.success===true?'success':'failed',correlationId});
        return toolResult;
      }});
    } catch (error) {
      // A data-source failure must not produce a confident, generic-looking
      // business answer from stale aggregates. Keep the response short and
      // explicit so the owner knows to retry rather than treating it as data.
      result={answer:"I couldn't reach the live clinic data just now, so I can't answer that reliably. Please try again in a moment.",toolCalls:[],sources:[],tokenUsage:{},responseMode:'structured_fallback'};
    }
    for (const source of result.sources??[]) emit('source',source);
    for (const chunk of String(result.answer).match(/.{1,80}(?:\s|$)/g)??[result.answer]) emit('text_delta',{text:chunk});
    const assistantMessageId=await saveMessage({conversationId:conversation.id,tenantId:req.session.tenantId,userId:req.session.userId,role:'assistant',content:result.answer,model:ADVISOR_MODEL,responseMode:result.responseMode??'live',toolCalls:result.toolCalls,sources:result.sources,tokenUsage:result.tokenUsage});
    await queueMemoryJob(req.session.tenantId, conversation.id, assistantMessageId);
    processAdvisorMemoryJobs(OPENAI_API_KEY).catch(()=>{});
    emit('done',{message_id:assistantMessageId,user_message_id:userMessageId,sources:result.sources??[],response_mode:result.responseMode??'live'}); res.end();
  } catch (error) {
    if (!res.headersSent) { res.status(error.status??500).json({error:{code:error.code??'ADVISOR_FAILED',message:error.message??'Advisor failed.',retryable:(error.status??500)>=500}}); return; }
    res.write(`event: error\ndata: ${JSON.stringify({code:error.code??'ADVISOR_FAILED',message:error.message??'Advisor failed.'})}\n\n`); res.end();
  }
});

app.post(
  '/api/dashboard/manager/ask',
  requireSession,
  requireCsrf,
  requireManagerEligible,
  rateLimit('manager-assistant', 20, 60_000),
  apiRoute(async (req, res) => {
    const question = String(req.body?.question ?? '').trim();
    if (question.length < 2 || question.length > 800) {
      throw badRequest('question must contain between 2 and 800 characters.', 'INVALID_MANAGER_QUESTION');
    }
    const summary = await managerSummaryForRequest(req);
    const result = await answerManagerQuestion({
      question,
      summary,
      apiKey: OPENAI_API_KEY,
      model: MANAGER_ASSISTANT_MODEL,
    });
    res.setHeader('Cache-Control', 'private, no-store');
    res.json({ success: true, answer: result.answer, mode: result.mode, generatedAt: summary.generatedAt });
  }),
);

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
app.post('/api/dashboard/queue/requests/:id/approve', ...dashboardAuth, requireRole('owner', 'admin'), rateLimit('queue-mutate', 30, 60_000), apiRoute(async (req, res) => {
  res.json(await n8nProd.appointmentRequests.approve(req.session.userId, req.session.tenantId, req.clinicId, req.params.id));
}));

app.post('/api/dashboard/queue/requests/:id/reject', ...dashboardAuth, requireRole('owner', 'admin'), rateLimit('queue-mutate', 30, 60_000), apiRoute(async (req, res) => {
  res.json(await n8nProd.appointmentRequests.reject(req.session.userId, req.session.tenantId, req.clinicId, req.params.id, req.body?.resolutionCode, req.body?.resolutionNote));
}));

app.post('/api/dashboard/queue/requests/:id/assign', ...dashboardAuth, requireRole('owner', 'admin'), rateLimit('queue-mutate', 30, 60_000), apiRoute(async (req, res) => {
  res.json(await n8nProd.appointmentRequests.assign(req.session.userId, req.session.tenantId, req.clinicId, req.params.id, req.body?.assignedUserId));
}));

// Archive replaces delete outright - there is no hard-delete route for
// requests anymore (FRONTEND-BFF-HANDOFF.md: "Remove every hard-delete
// endpoint/button for requests").
app.post('/api/dashboard/queue/requests/:id/archive', ...dashboardAuth, requireRole('owner', 'admin'), rateLimit('queue-mutate', 30, 60_000), apiRoute(async (req, res) => {
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
async function readInboundCalls(req) {
  return prisma.$queryRaw`
    SELECT c.retell_call_id AS call_id, c.from_number, c.call_status,
      c.disconnect_reason, c.duration_minutes AS call_duration_min,
      TO_CHAR(c.started_at AT TIME ZONE COALESCE(cc.timezone, t.timezone, 'America/Toronto'), 'YYYY-MM-DD') AS call_date,
      TO_CHAR(c.started_at AT TIME ZONE COALESCE(cc.timezone, t.timezone, 'America/Toronto'), 'YYYY-MM-DD"T"HH24:MI:SS') AS call_timestamp,
      TO_CHAR(c.started_at AT TIME ZONE COALESCE(cc.timezone, t.timezone, 'America/Toronto'), 'YYYY-MM') AS call_month,
      c.summary AS call_summary, c.sentiment, c.transcript, c.recording_url,
      (COALESCE(c.recording_url, '') <> '') AS has_recording,
      (COALESCE(c.transcript, '') <> '') AS has_transcript,
      CASE WHEN COALESCE(BTRIM(c.transcript), '') = '' THEN 0
        ELSE ARRAY_LENGTH(REGEXP_SPLIT_TO_ARRAY(BTRIM(c.transcript), '\\s+'), 1) END AS word_count
    FROM calls c
    JOIN tenants t ON t.id = c.tenant_id
    JOIN clinic_configs cc ON cc.tenant_id = c.tenant_id AND cc.clinic_id = c.clinic_id
    WHERE c.tenant_id = ${req.session.tenantId} AND c.clinic_id = ${req.clinicId}
    ORDER BY c.started_at DESC
    LIMIT 500
  `;
}
app.get('/api/dashboard/inbound/overview', ...dashboardAuth, apiRoute(async (req, res) => {
  // This read-only billing summary used to share the inactive Retell-ingestion
  // workflow. Keeping it in the BFF preserves the dashboard without making a
  // public webhook active again. Scope comes only from dashboardAuth.
  const rows = await prisma.$queryRaw`
    SELECT bm.*, t.name AS client_name
    FROM billing_months bm
    JOIN tenants t ON t.id = bm.tenant_id
    JOIN clinic_configs cc ON cc.tenant_id = bm.tenant_id AND cc.clinic_id = bm.clinic_id
    WHERE bm.tenant_id = ${req.session.tenantId}
      AND bm.clinic_id = ${req.clinicId}
    ORDER BY bm.billing_month DESC
    LIMIT 1
  `;
  const overview = buildBillingOverview(rows[0]);
  if (!overview) {
    const error = new Error('No billing summary is available for this clinic.');
    error.status = 404;
    error.code = 'BILLING_DATA_UNAVAILABLE';
    throw error;
  }
  res.json(overview);
}));
app.get('/api/dashboard/inbound/analytics', ...dashboardAuth, apiRoute(async (req, res) => {
  res.json(buildInboundAnalytics(await readInboundCalls(req), req.query.range));
}));
app.get('/api/dashboard/inbound/calls', ...dashboardAuth, apiRoute(async (req, res) => {
  res.json(buildInboundCalls(await readInboundCalls(req)));
}));
app.get('/api/dashboard/inbound/transcripts', ...dashboardAuth, apiRoute(async (req, res) => {
  res.json(buildInboundTranscripts(await readInboundCalls(req)));
}));
app.get('/api/dashboard/inbound/invoices', ...dashboardAuth, apiRoute(async (req, res) => {
  const rows = await prisma.$queryRaw`
    SELECT i.invoice_id, i.billing_month, i.status, i.base_amount, i.overage_minutes,
      i.overage_amount, i.total_amount, i.generated_at, i.due_at, i.details
    FROM invoices i
    WHERE i.tenant_id = ${req.session.tenantId} AND i.clinic_id = ${req.clinicId}
    ORDER BY i.billing_month DESC
    LIMIT 100
  `;
  res.json({ invoices: rows.map(row => {
    const details = row.details && typeof row.details === 'object' ? row.details : {};
    const minutesUsed = Number(details.minutes_used ?? 0);
    const included = Number(details.included_minutes ?? 1000);
    const overageMinutes = Number(row.overage_minutes ?? 0);
    const amount = Number(row.total_amount ?? 0);
    const status = String(row.status ?? 'pending').toLowerCase();
    return {
      id: row.invoice_id, invoice_id: row.invoice_id, period: row.billing_month,
      amount: `$${amount.toFixed(2)}`, amountRaw: amount,
      minutes: `${minutesUsed.toLocaleString()} / ${included.toLocaleString()}`,
      minutesUsed, includedMinutes: included, status,
      date: row.generated_at ? new Date(row.generated_at).toISOString().slice(0, 10) : '',
      dueDate: row.due_at ? new Date(row.due_at).toISOString().slice(0, 10) : '',
      paid: status === 'paid', isOverage: overageMinutes > 0, overageMin: overageMinutes,
      overageRate: Number(details.overage_rate ?? 0.70), overageCost: Number(row.overage_amount ?? 0),
      baseRate: Number(row.base_amount ?? 500),
    };
  }) });
}));

// ── Outbound dashboard (§6.3) ────────────────────────────────────────────────
app.get('/api/dashboard/outbound/overview', ...dashboardAuth, apiRoute(async (req, res) => {
  // Same containment principle as inbound Overview: rendering historical
  // billing data is safe, but it must not require an unrelated Retell
  // workflow to be active.
  const rows = await prisma.$queryRaw`
    SELECT bm.*, t.name AS client_name
    FROM outbound_billing_months bm
    JOIN tenants t ON t.id = bm.tenant_id
    JOIN clinic_configs cc ON cc.tenant_id = bm.tenant_id AND cc.clinic_id = bm.clinic_id
    WHERE bm.tenant_id = ${req.session.tenantId}
      AND bm.clinic_id = ${req.clinicId}
    ORDER BY bm.billing_month DESC
    LIMIT 1
  `;
  const overview = buildBillingOverview(rows[0]);
  if (!overview) {
    const error = new Error('No outbound billing summary is available for this clinic.');
    error.status = 404;
    error.code = 'OUTBOUND_BILLING_DATA_UNAVAILABLE';
    throw error;
  }
  res.json(overview);
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

// Kept owner/admin-only (not main's open-to-any-clinic-user version): the
// n8n workflow side already enforces this same restriction
// (BACKEND_PRODUCTION_READINESS.md), so loosening only the BFF would create
// a client/workflow mismatch. MakeCallScreen hides Batch History for
// non-owner/admin users accordingly, rather than showing a failed load.
app.get('/api/dashboard/outbound-batches', ...dashboardAuth, requireRole('owner', 'admin'), apiRoute(async (req, res) => {
  const result = requireN8nSuccess(
    await n8nProd.outboundBatches.list(req.session.userId, req.session.tenantId, req.clinicId),
    'The batch history could not be loaded.',
  );
  res.json(result.batches ?? []);
}));

app.get('/api/dashboard/outbound-batches/:id', ...dashboardAuth, requireRole('owner', 'admin'), apiRoute(async (req, res) => {
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
  const settings = await n8nProd.getPublicSettings(req.session.tenantId, req.clinicId);
  res.json(redactPublicSettingsResponse(settings));
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
    const parsed = parsePublicWebsiteUrl(body.website_url);
    if (!parsed) throw badRequest('website_url must be a public HTTPS URL without embedded credentials.');
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
app.post('/api/dashboard/recovery/queue/approve', ...dashboardAuth, requireRole('owner', 'admin'), rateLimit('recovery-mutate', 30, 60_000), apiRoute(async (req, res) => {
  res.json(await n8nProd.recoveryEvent('recovery.queue.approve', req.session.tenantId, req.clinicId, { queue_ids: req.body?.queueIds ?? [] }));
}));
app.post('/api/dashboard/recovery/queue/reject', ...dashboardAuth, requireRole('owner', 'admin'), rateLimit('recovery-mutate', 30, 60_000), apiRoute(async (req, res) => {
  res.json(await n8nProd.recoveryEvent('recovery.queue.reject', req.session.tenantId, req.clinicId, { queue_ids: req.body?.queueIds ?? [], reason: req.body?.reason }));
}));
function recoveryInvoiceRoute(action) {
  return apiRoute(async (req, res) => {
    res.json(await n8nProd.recoveryEvent(`recovery.invoice.${action}`, req.session.tenantId, req.clinicId, { invoice_id: req.params.invoiceId, reason: req.body?.reason }));
  });
}
app.post('/api/dashboard/recovery/invoices/:invoiceId/hold', ...dashboardAuth, requireRole('owner', 'admin'), rateLimit('recovery-mutate', 30, 60_000), recoveryInvoiceRoute('hold'));
app.post('/api/dashboard/recovery/invoices/:invoiceId/resume', ...dashboardAuth, requireRole('owner', 'admin'), rateLimit('recovery-mutate', 30, 60_000), recoveryInvoiceRoute('resume'));
app.post('/api/dashboard/recovery/invoices/:invoiceId/escalate', ...dashboardAuth, requireRole('owner', 'admin'), rateLimit('recovery-mutate', 30, 60_000), recoveryInvoiceRoute('escalate'));
app.post('/api/dashboard/recovery/invoices/:invoiceId/reconcile', ...dashboardAuth, requireRole('owner', 'admin'), rateLimit('recovery-mutate', 30, 60_000), recoveryInvoiceRoute('reconcile'));
app.put('/api/dashboard/recovery/settings', ...dashboardAuth, requireRole('owner', 'admin'), rateLimit('settings-save', 20, 60_000), apiRoute(async (req, res) => {
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

startAdvisorMemoryWorker(OPENAI_API_KEY);
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));

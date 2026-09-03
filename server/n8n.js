// Production n8n integration (handoff §4, §6). Every request is scoped by
// a VERIFIED tenant_id/clinic_id (checked server-side against
// user_clinic_access before these functions are ever called - see
// requireClinicAccess in auth.js) and carries a private header-auth value
// that never reaches the browser.
const N8N_BASE_URL = (process.env.N8N_BASE_URL ?? '').replace(/\/+$/, '');
const N8N_DASHBOARD_AUTH_HEADER = process.env.N8N_DASHBOARD_AUTH_HEADER ?? 'Authorization';
const N8N_DASHBOARD_AUTH_VALUE = process.env.N8N_DASHBOARD_AUTH_VALUE ?? '';
// Dedicated webhook (FRONTEND-BFF-HANDOFF.md) - separate from N8N_BASE_URL
// because it's the ONLY thing allowed to touch the `requests` /
// `appointment_events` tables for staff-queue actions. It joins against
// user_clinic_access itself and does the Juvonno cancellation call with
// row-level locking, so this server proxies to it rather than querying
// Postgres directly for this domain (same "browser never talks to n8n or
// Postgres directly" boundary, one hop further in).
const N8N_APPOINTMENT_REQUESTS_URL = process.env.N8N_APPOINTMENT_REQUESTS_URL ?? '';
// SMS Follow-Ups (FRONTEND-DEVELOPER-HANDOFF-SMS-ONLY.md) - a separate
// database-backed n8n workflow, its own dedicated webhook like the
// appointment-requests one above rather than the shared N8N_BASE_URL.
const N8N_SMS_FOLLOWUPS_URL = process.env.N8N_SMS_FOLLOWUPS_URL ?? '';
// Knowledge Base Submission Queue (FRONTEND-DEVELOPER-HANDOFF.md) - another
// dedicated webhook, same reasoning as appointment-requests/SMS above: this
// is the only thing allowed to write to the submissions queue table, and it
// never receives the binary file itself (only storage_key/sha256/metadata
// for PDF/DOCX; the file bytes stay in this server's private storage).
const N8N_KNOWLEDGE_BASE_SUBMISSIONS_URL = process.env.N8N_KNOWLEDGE_BASE_SUBMISSIONS_URL ?? '';
// Outbound Batch Calls (FRONTEND-DEVELOPER-HANDOFF (1).md) - another
// dedicated webhook. The database is the source of truth here: create writes
// a Draft batch + its contacts to Postgres without touching Retell at all;
// only a separate, deliberate dispatch call actually fires the Retell batch
// call and records the returned retell_batch_call_id.
const N8N_OUTBOUND_BATCHES_URL = process.env.N8N_OUTBOUND_BATCHES_URL ?? '';
// Read-only, de-identified Juvonno business snapshots for the Manager
// Assistant. The workflow is the only component that receives the decrypted
// clinic API key; this BFF receives aggregate appointment/invoice/commission
// metrics only.
const N8N_MANAGER_INSIGHTS_URL = process.env.N8N_MANAGER_INSIGHTS_URL ?? '';
const N8N_MANAGER_ANALYST_TOOLS_URL = process.env.N8N_MANAGER_ANALYST_TOOLS_URL ?? '';

function authHeaders() {
  const headers = { 'Content-Type': 'application/json' };
  if (N8N_DASHBOARD_AUTH_VALUE) headers[N8N_DASHBOARD_AUTH_HEADER] = N8N_DASHBOARD_AUTH_VALUE;
  return headers;
}

// A production dashboard must never "try anyway" against a webhook when its
// server-to-server credential is missing. Besides avoiding accidental calls to
// an unauthenticated endpoint, this makes a deployment configuration failure
// explicit before any tenant-scoped payload leaves the BFF.
function requireDashboardAuth() {
  if (!N8N_DASHBOARD_AUTH_HEADER || !N8N_DASHBOARD_AUTH_VALUE) {
    const err = new Error('The upstream dashboard integration is not configured.');
    err.status = 503;
    err.code = 'N8N_AUTH_NOT_CONFIGURED';
    throw err;
  }
}

async function parseJsonSafe(res) {
  const text = await res.text();
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    return { raw: text };
  }
}

function n8nError(json, status) {
  // An n8n/provider response is not a trusted user-facing error source. Its
  // body can contain query, provider, or configuration detail, so preserve
  // neither its message nor its status code at the browser boundary.
  const err = new Error('The upstream service could not complete the request.');
  err.status = 502;
  err.code = 'N8N_UPSTREAM_FAILED';
  return err;
}

async function withTimeoutFetch(url, init, timeoutMs = 15_000) {
  try {
    return await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
  } catch (error) {
    const err = new Error(error?.name === 'TimeoutError' ? 'The service timed out' : 'The service is unavailable');
    err.status = error?.name === 'TimeoutError' ? 504 : 502;
    throw err;
  }
}

function requireBaseUrl() {
  if (!N8N_BASE_URL) {
    const err = new Error('N8N_BASE_URL is not configured');
    err.status = 503;
    throw err;
  }
}

// GET <N8N_BASE_URL>/<path>?tenant_id=...&clinic_id=...&<extra> (§6.2/6.3).
// Legacy tracker formatter nodes used camel-case query fields. Both spellings
// below are derived solely from the already-authorized BFF scope; accepting
// them downstream never grants browser-controlled scope.
export async function n8nGet(path, tenantId, clinicId, extraParams = {}) {
  requireBaseUrl();
  requireDashboardAuth();
  const url = new URL(`${N8N_BASE_URL}/${path.replace(/^\/+/, '')}`);
  url.searchParams.set('tenant_id', tenantId);
  url.searchParams.set('clinic_id', clinicId);
  url.searchParams.set('tenantId', tenantId);
  url.searchParams.set('clinicId', clinicId);
  for (const [k, v] of Object.entries(extraParams)) if (v != null && v !== '') url.searchParams.set(k, String(v));
  const res = await withTimeoutFetch(url, { headers: authHeaders() });
  const json = await parseJsonSafe(res);
  if (!res.ok) throw n8nError(json, res.status);
  return json;
}

// POST <N8N_BASE_URL>/<path> with a JSON body (Settings + Payment Recovery,
// which are single webhooks distinguishing the action via an `event` field
// or dedicated body shape rather than one webhook per action).
export async function n8nPost(path, body) {
  requireBaseUrl();
  requireDashboardAuth();
  const url = `${N8N_BASE_URL}/${path.replace(/^\/+/, '')}`;
  const res = await withTimeoutFetch(url, { method: 'POST', headers: authHeaders(), body: JSON.stringify(body) });
  const json = await parseJsonSafe(res);
  if (!res.ok) throw n8nError(json, res.status);
  return json;
}

// ── Payment Recovery (§6.4) ─────────────────────────────────────────────────
export function recoveryEvent(event, tenantId, clinicId, extra = {}) {
  return n8nPost('juvonno-payment-recovery-dashboard-api', { event, tenant_id: tenantId, clinic_id: clinicId, ...extra });
}

// ── Settings (§6.1, §8) ──────────────────────────────────────────────────────
// /juvonno-settings-config is internal/n8n-only and MUST NEVER be proxied
// to the browser - it returns the decrypted Juvonno API key.
export function saveSettings(payload) {
  return n8nPost('juvonno-settings', payload);
}
export function getPublicSettings(tenantId, clinicId) {
  return n8nGet('juvonno-settings-public', tenantId, clinicId);
}
export function getRetellOptions(tenantId, clinicId) {
  return n8nGet('juvonno-settings-retell-options', tenantId, clinicId);
}

// ── Inbound / Outbound dashboards (§6.2, §6.3) ───────────────────────────────
export const inbound = {
  overview: (t, c) => n8nGet('juvonno/overview', t, c),
  analytics: (t, c, range) => n8nGet('juvonno/analytics', t, c, { range }),
  calls: (t, c) => n8nGet('juvonno/calls', t, c),
  transcripts: (t, c) => n8nGet('juvonno/transcripts', t, c),
  invoices: (t, c) => n8nGet('juvonno/invoices', t, c),
};

export const outbound = {
  overview: (t, c) => n8nGet('juvonno-outbound/overview', t, c),
  analytics: (t, c, range) => n8nGet('juvonno-outbound/analytics', t, c, { range }),
  calls: (t, c) => n8nGet('juvonno-outbound/calls', t, c),
  transcripts: (t, c) => n8nGet('juvonno-outbound/transcripts', t, c),
  invoices: (t, c) => n8nGet('juvonno-outbound/invoices', t, c),
  // NOTE: the old single-shot makeCall() (juvonno-outbound/make-call, fired
  // Retell immediately on submit) is retired - superseded by the
  // create-then-dispatch outboundBatches flow below (FRONTEND-DEVELOPER-
  // HANDOFF (1).md), which makes the database the source of truth instead
  // of trusting a browser-supplied contacts array straight through to Retell.
};

async function managerInsightsAction(action, userId, tenantId, clinicId, extra = {}) {
  if (!N8N_MANAGER_INSIGHTS_URL) {
    const err = new Error('N8N_MANAGER_INSIGHTS_URL is not configured');
    err.status = 503;
    err.code = 'MANAGER_INSIGHTS_NOT_CONFIGURED';
    throw err;
  }
  requireDashboardAuth();
  const res = await withTimeoutFetch(N8N_MANAGER_INSIGHTS_URL, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ action, user_id: userId, tenant_id: tenantId, clinic_id: clinicId, ...extra }),
  }, 45_000);
  const json = await parseJsonSafe(res);
  if (!res.ok) throw n8nError(json, res.status);
  if (json?.success !== true) {
    const err = new Error(json?.message || 'Juvonno business insights are unavailable');
    err.status = json?.error_code === 'CLINIC_ACCESS_FORBIDDEN' ? 403 : 502;
    err.code = json?.error_code || 'MANAGER_INSIGHTS_UPSTREAM_FAILED';
    throw err;
  }
  return json;
}

export const managerInsights = {
  get: (u, t, c) => managerInsightsAction('manager_insights.get', u, t, c),
  refresh: (u, t, c, periodDays = 30) => managerInsightsAction('manager_insights.refresh', u, t, c, { period_days: periodDays }),
};

export async function runManagerAnalystTool({ action, userId, tenantId, clinicIds, startDate, endDate, patientIdentifier, detailIdentifier, practitionerIdentifier, correlationId }) {
  if (!N8N_MANAGER_ANALYST_TOOLS_URL) {
    const err = new Error('N8N_MANAGER_ANALYST_TOOLS_URL is not configured');
    err.status = 503;
    err.code = 'MANAGER_ANALYST_NOT_CONFIGURED';
    throw err;
  }
  requireDashboardAuth();
  const res = await withTimeoutFetch(N8N_MANAGER_ANALYST_TOOLS_URL, {
    method: 'POST', headers: authHeaders(), body: JSON.stringify({
      action, user_id: userId, tenant_id: tenantId, clinic_ids: clinicIds,
      start_date: startDate, end_date: endDate,
      patient_identifier: patientIdentifier || null,
      detail_identifier: detailIdentifier || null,
      practitioner_identifier: practitionerIdentifier || null,
      correlation_id: correlationId,
    }),
  // Bounded historical Advisor actions may make several adaptive Juvonno
  // requests across complete time partitions. Keep the BFF timeout above the
  // workflow's global safety ceilings while every individual source request
  // remains capped inside n8n.
  }, 120_000);
  const json = await parseJsonSafe(res);
  if (!res.ok) throw n8nError(json, res.status);
  return json;
}

// ── Appointment Requests / Staff Action Queue (FRONTEND-BFF-HANDOFF.md) ─────
// user_id/tenant_id/clinic_id must always be the verified session values
// (never anything from the request body) - callers pass them explicitly so
// that's visible at every call site instead of buried in here.
async function appointmentRequestsAction(action, userId, tenantId, clinicId, extra = {}) {
  if (!N8N_APPOINTMENT_REQUESTS_URL) {
    const err = new Error('N8N_APPOINTMENT_REQUESTS_URL is not configured');
    err.status = 503;
    throw err;
  }
  requireDashboardAuth();
  const res = await withTimeoutFetch(N8N_APPOINTMENT_REQUESTS_URL, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ action, user_id: userId, tenant_id: tenantId, clinic_id: clinicId, ...extra }),
  });
  const json = await parseJsonSafe(res);
  if (!res.ok) throw n8nError(json, res.status);
  return json;
}

// SMS Follow-Ups status (FRONTEND-DEVELOPER-HANDOFF-SMS-ONLY.md). tenant_id
// and clinic_id must always be the verified session/req.clinicId values -
// callers pass them explicitly, never anything from the request body.
export async function getSmsFollowupStatus(tenantId, clinicId) {
  if (!N8N_SMS_FOLLOWUPS_URL) {
    const err = new Error('N8N_SMS_FOLLOWUPS_URL is not configured');
    err.status = 503;
    throw err;
  }
  requireDashboardAuth();
  const res = await withTimeoutFetch(N8N_SMS_FOLLOWUPS_URL, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ action: 'status', tenant_id: tenantId, clinic_id: clinicId }),
  });
  const json = await parseJsonSafe(res);
  if (!res.ok) throw n8nError(json, res.status);
  return json;
}

export const appointmentRequests = {
  list: (u, t, c, status) => appointmentRequestsAction('appointment_request.list', u, t, c, { status }),
  get: (u, t, c, requestId) => appointmentRequestsAction('appointment_request.get', u, t, c, { request_id: requestId }),
  approve: (u, t, c, requestId) => appointmentRequestsAction('appointment_request.approve', u, t, c, { request_id: requestId }),
  reject: (u, t, c, requestId, resolutionCode, resolutionNote) =>
    appointmentRequestsAction('appointment_request.reject', u, t, c, { request_id: requestId, resolution_code: resolutionCode, resolution_note: resolutionNote }),
  assign: (u, t, c, requestId, assignedUserId) =>
    appointmentRequestsAction('appointment_request.assign', u, t, c, { request_id: requestId, assigned_user_id: assignedUserId }),
  archive: (u, t, c, requestId, resolutionNote) =>
    appointmentRequestsAction('appointment_request.archive', u, t, c, { request_id: requestId, resolution_note: resolutionNote }),
  eventsList: (u, t, c, params = {}) => appointmentRequestsAction('appointment_event.list', u, t, c, params),
  eventGet: (u, t, c, eventId) => appointmentRequestsAction('appointment_event.get', u, t, c, { event_id: eventId }),
};

// ── Knowledge Base Submission Queue (FRONTEND-DEVELOPER-HANDOFF.md) ─────────
// tenant_id/clinic_id/user_id must always be the verified session values -
// callers pass them explicitly, never anything from the request body. The
// workflow accepts one shared action field (submit/list/get/update_status),
// same convention as appointmentRequestsAction above.
async function knowledgeSubmissionsAction(action, userId, tenantId, clinicId, extra = {}) {
  if (!N8N_KNOWLEDGE_BASE_SUBMISSIONS_URL) {
    const err = new Error('N8N_KNOWLEDGE_BASE_SUBMISSIONS_URL is not configured');
    err.status = 503;
    throw err;
  }
  requireDashboardAuth();
  const res = await withTimeoutFetch(N8N_KNOWLEDGE_BASE_SUBMISSIONS_URL, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ action, user_id: userId, tenant_id: tenantId, clinic_id: clinicId, ...extra }),
  });
  const json = await parseJsonSafe(res);
  if (!res.ok) throw n8nError(json, res.status);
  return json;
}

export const knowledgeSubmissions = {
  submit: (u, t, c, payload) => knowledgeSubmissionsAction('submit', u, t, c, payload),
  list: (u, t, c) => knowledgeSubmissionsAction('list', u, t, c),
  // FRONTEND-DEVELOPER-HANDOFF-COMBINED.md §2: "the get action uses
  // submission_id, not id".
  get: (u, t, c, id) => knowledgeSubmissionsAction('get', u, t, c, { submission_id: id }),
};

// ── Outbound Batch Calls (FRONTEND-DEVELOPER-HANDOFF (1).md) ────────────────
// tenant_id/clinic_id/user_id must always be the verified session values -
// callers pass them explicitly, never anything from the request body.
async function outboundBatchesAction(action, userId, tenantId, clinicId, extra = {}) {
  if (!N8N_OUTBOUND_BATCHES_URL) {
    const err = new Error('N8N_OUTBOUND_BATCHES_URL is not configured');
    err.status = 503;
    throw err;
  }
  requireDashboardAuth();
  const res = await withTimeoutFetch(N8N_OUTBOUND_BATCHES_URL, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ action, user_id: userId, tenant_id: tenantId, clinic_id: clinicId, ...extra }),
  });
  const json = await parseJsonSafe(res);
  if (!res.ok) throw n8nError(json, res.status);
  return json;
}

export const outboundBatches = {
  create: (u, t, c, payload) => outboundBatchesAction('outbound_batch.create', u, t, c, payload),
  list: (u, t, c) => outboundBatchesAction('outbound_batch.list', u, t, c),
  get: (u, t, c, batchId) => outboundBatchesAction('outbound_batch.get', u, t, c, { batch_id: batchId }),
  dispatch: (u, t, c, batchId) => outboundBatchesAction('outbound_batch.dispatch', u, t, c, { batch_id: batchId }),
};

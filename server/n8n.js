// Production n8n integration (handoff §4, §6). Every request is scoped by
// a VERIFIED tenant_id/clinic_id (checked server-side against
// user_clinic_access before these functions are ever called - see
// requireClinicAccess in auth.js) and carries a private header-auth value
// that never reaches the browser.
const N8N_BASE_URL = (process.env.N8N_BASE_URL ?? '').replace(/\/+$/, '');
const N8N_DASHBOARD_AUTH_HEADER = process.env.N8N_DASHBOARD_AUTH_HEADER ?? 'Authorization';
const N8N_DASHBOARD_AUTH_VALUE = process.env.N8N_DASHBOARD_AUTH_VALUE ?? '';

function authHeaders() {
  const headers = { 'Content-Type': 'application/json' };
  if (N8N_DASHBOARD_AUTH_VALUE) headers[N8N_DASHBOARD_AUTH_HEADER] = N8N_DASHBOARD_AUTH_VALUE;
  return headers;
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
  const message = json?.error?.message ?? json?.error ?? `n8n responded with ${status}`;
  const err = new Error(message);
  err.status = status >= 400 && status < 600 ? status : 502;
  err.code = json?.error?.code;
  return err;
}

async function withTimeoutFetch(url, init) {
  try {
    return await fetch(url, { ...init, signal: AbortSignal.timeout(15_000) });
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
export async function n8nGet(path, tenantId, clinicId, extraParams = {}) {
  requireBaseUrl();
  const url = new URL(`${N8N_BASE_URL}/${path.replace(/^\/+/, '')}`);
  url.searchParams.set('tenant_id', tenantId);
  url.searchParams.set('clinic_id', clinicId);
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
};

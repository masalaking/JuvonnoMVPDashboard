// Server-controlled session auth for the RivaCare dashboard (handoff §5).
//
// Sessions are a signed, httpOnly cookie (HMAC-SHA256 over {userId,
// tenantId, activeClinicId, exp}) rather than a server-side session table -
// there's no `sessions` table in the production schema, and this keeps the
// server stateless/horizontally-scalable without inventing one. Rotating
// SESSION_SECRET invalidates every session at once.
//
// tenantId always comes from the verified session, never the browser
// (users.tenant_id is fixed per user - one login belongs to exactly one
// tenant). clinicId is verified per-request against user_clinic_access
// before any n8n call is made, per §5's authorization rule.
import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import { prisma } from './db.js';

// Local-only convenience for the demo dashboard. This remains disabled in
// production, where a browser must always authenticate.
const LOCAL_DASHBOARD_NO_LOGIN = process.env.NODE_ENV !== 'production'
  && String(process.env.LOCAL_DASHBOARD_NO_LOGIN ?? 'true').toLowerCase() === 'true';
export const isLocalDashboardNoLogin = LOCAL_DASHBOARD_NO_LOGIN;
const LOCAL_DASHBOARD_USERNAME = process.env.LOCAL_DASHBOARD_USERNAME ?? 'test_clinic';
const LOCAL_DASHBOARD_TENANT_ID = process.env.LOCAL_DASHBOARD_TENANT_ID ?? 'clinic_001';
const LOCAL_DASHBOARD_CLINIC_ID = process.env.LOCAL_DASHBOARD_CLINIC_ID ?? 'clinic_001';
const LOCAL_DASHBOARD_CLINIC_NAME = process.env.LOCAL_DASHBOARD_CLINIC_NAME ?? 'Local demo clinic';
const LOCAL_DASHBOARD_USER_ID = process.env.LOCAL_DASHBOARD_USER_ID ?? 'local_demo';
const USE_DATABASE_LOCAL_IDENTITY = LOCAL_DASHBOARD_NO_LOGIN
  && Boolean(process.env.DIRECT_DATABASE_URL)
  && !process.env.LOCAL_DASHBOARD_USER_ID;
const SESSION_SECRET = process.env.SESSION_SECRET ?? (LOCAL_DASHBOARD_NO_LOGIN ? 'local-dashboard-demo-only-not-for-production' : '');
const SESSION_COOKIE = 'rc_session';
const CSRF_COOKIE = 'rc_csrf';
const SESSION_MAX_AGE_MS = 12 * 60 * 60 * 1000; // 12h

function assertSecretConfigured() {
  if (!SESSION_SECRET || SESSION_SECRET === 'change-me-to-a-long-random-string') {
    throw new Error('SESSION_SECRET is not configured - set a strong random value in .env before enabling login.');
  }
}

function b64url(input) {
  return Buffer.from(input).toString('base64url');
}

function sign(payload) {
  assertSecretConfigured();
  const body = b64url(JSON.stringify(payload));
  const sig = crypto.createHmac('sha256', SESSION_SECRET).update(body).digest('base64url');
  return `${body}.${sig}`;
}

function verify(token) {
  if (!token) return null;
  assertSecretConfigured();
  const [body, sig] = token.split('.');
  if (!body || !sig) return null;
  const expected = crypto.createHmac('sha256', SESSION_SECRET).update(body).digest('base64url');
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf-8'));
    if (typeof payload.exp !== 'number' || Date.now() > payload.exp) return null;
    return payload;
  } catch {
    return null;
  }
}

function parseCookies(header) {
  const out = {};
  (header ?? '').split(';').forEach((part) => {
    const idx = part.indexOf('=');
    if (idx === -1) return;
    out[part.slice(0, idx).trim()] = decodeURIComponent(part.slice(idx + 1).trim());
  });
  return out;
}

function cookieFlags(extra = '') {
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  return `Path=/; SameSite=Lax${secure}${extra}`;
}

// Issues both the session cookie (httpOnly - never readable by page JS) and
// a CSRF token cookie (readable by page JS, double-submit pattern per §15 -
// the frontend must echo it back in an X-CSRF-Token header on every
// mutating request; a cross-site page can trigger the cookie to be sent
// automatically but can't read it to put in a header).
export function issueSession(res, { userId, tenantId, activeClinicId }) {
  const token = sign({ userId, tenantId, activeClinicId: activeClinicId ?? null, exp: Date.now() + SESSION_MAX_AGE_MS });
  const csrfToken = crypto.randomBytes(24).toString('base64url');
  res.setHeader('Set-Cookie', [
    `${SESSION_COOKIE}=${token}; HttpOnly; ${cookieFlags(`; Max-Age=${Math.floor(SESSION_MAX_AGE_MS / 1000)}`)}`,
    `${CSRF_COOKIE}=${csrfToken}; ${cookieFlags(`; Max-Age=${Math.floor(SESSION_MAX_AGE_MS / 1000)}`)}`,
  ]);
  return csrfToken;
}

export function clearSession(res) {
  res.setHeader('Set-Cookie', [
    `${SESSION_COOKIE}=; HttpOnly; ${cookieFlags('; Max-Age=0')}`,
    `${CSRF_COOKIE}=; ${cookieFlags('; Max-Age=0')}`,
  ]);
}

export function readSession(req) {
  const cookies = parseCookies(req.headers.cookie);
  return verify(cookies[SESSION_COOKIE]);
}

function readCsrfCookie(req) {
  return parseCookies(req.headers.cookie)[CSRF_COOKIE] ?? '';
}

// Exposed for GET /api/auth/session (multi-clinic-prompt.md §1.1) - the
// rc_csrf cookie is deliberately not httpOnly (the frontend echoes it back
// in X-CSRF-Token), so reading it back out is not a security-sensitive
// operation the way reading the session cookie's contents would be.
export const readCsrfToken = readCsrfCookie;

// Attaches req.session = { userId, tenantId, activeClinicId } or 401s.
export async function requireSession(req, res, next) {
  const session = readSession(req);
  if (session) {
    req.session = session;
    return next();
  }

  // When the local repo has the same read-only database connection as the
  // live dashboard, use the existing user + clinic access row. That lets n8n
  // independently verify the exact user_id it receives. If no database is
  // configured, retain a shell-only local demo fallback.
  if (LOCAL_DASHBOARD_NO_LOGIN) {
    if (USE_DATABASE_LOCAL_IDENTITY) {
      try {
        const user = await prisma.users.findUnique({ where: { username: LOCAL_DASHBOARD_USERNAME } });
        if (!user) return res.status(503).json({ error: { code: 'LOCAL_DEMO_USER_UNAVAILABLE', message: `Local demo user \"${LOCAL_DASHBOARD_USERNAME}\" was not found.`, retryable: false } });
        const clinics = await clinicsForUser(user.id, user.tenant_id);
        if (clinics.length === 0) return res.status(503).json({ error: { code: 'LOCAL_DEMO_CLINIC_UNAVAILABLE', message: 'The local demo user has no clinic access.', retryable: false } });
        const configuredClinic = process.env.LOCAL_DASHBOARD_CLINIC_ID;
        const activeClinicId = configuredClinic && clinics.some(clinic => clinic.clinicId === configuredClinic)
          ? configuredClinic
          : clinics[0].clinicId;
        const demoSession = { userId: user.id, tenantId: user.tenant_id, activeClinicId };
        issueSession(res, demoSession);
        req.session = demoSession;
        return next();
      } catch (error) {
        console.error('[auth] local database-backed session failed:', error);
        return res.status(503).json({ error: { code: 'LOCAL_DEMO_UNAVAILABLE', message: 'Could not establish the local demo session.', retryable: false } });
      }
    }
    const demoSession = { userId: LOCAL_DASHBOARD_USER_ID, tenantId: LOCAL_DASHBOARD_TENANT_ID, activeClinicId: LOCAL_DASHBOARD_CLINIC_ID };
    issueSession(res, demoSession);
    req.session = demoSession;
    return next();
  }

  return res.status(401).json({ error: { code: 'UNAUTHENTICATED', message: 'Sign in required.', retryable: false } });
}

// Double-submit CSRF check for state-changing requests. Must run after
// requireSession. GET/HEAD/OPTIONS are exempt (never mutate).
export function requireCsrf(req, res, next) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  const header = String(req.headers['x-csrf-token'] ?? '');
  const cookie = readCsrfCookie(req);
  if (!header || !cookie || header !== cookie) {
    return res.status(403).json({ error: { code: 'FORBIDDEN', message: 'Missing or invalid CSRF token.', retryable: false } });
  }
  next();
}

// Verifies the session's active clinic (or an explicit ?clinic_id=)
// actually belongs to this user via user_clinic_access - never trusts a
// clinic_id the browser sends on its own. Attaches req.clinicId/req.clinicRole.
export async function requireClinicAccess(req, res, next) {
  const clinicId = String(req.query.clinic_id ?? req.session.activeClinicId ?? '');
  if (!clinicId) {
    return res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'No active clinic selected.', retryable: false } });
  }
  if (LOCAL_DASHBOARD_NO_LOGIN && req.session.userId === LOCAL_DASHBOARD_USER_ID) {
    if (clinicId !== LOCAL_DASHBOARD_CLINIC_ID || req.session.tenantId !== LOCAL_DASHBOARD_TENANT_ID) {
      return res.status(403).json({ error: { code: 'FORBIDDEN', message: 'The local demo is restricted to its configured clinic.', retryable: false } });
    }
    req.clinicId = clinicId;
    req.clinicRole = 'owner';
    return next();
  }
  const access = await prisma.user_clinic_access.findUnique({
    where: { user_id_tenant_id_clinic_id: { user_id: req.session.userId, tenant_id: req.session.tenantId, clinic_id: clinicId } },
  });
  if (!access) {
    return res.status(403).json({ error: { code: 'FORBIDDEN', message: 'You do not have access to this clinic.', retryable: false } });
  }
  req.clinicId = clinicId;
  req.clinicRole = access.role;
  next();
}

export function requireRole(...roles) {
  return (req, res, next) => {
    if (!roles.includes(req.clinicRole)) {
      return res.status(403).json({ error: { code: 'FORBIDDEN', message: 'You do not have permission to do this.', retryable: false } });
    }
    next();
  };
}

export async function verifyCredentials(username, password) {
  if (!username || !password) return null;
  const user = await prisma.users.findUnique({ where: { username: String(username) } });
  if (!user) return null;
  const ok = await bcrypt.compare(String(password), user.password_hash);
  if (!ok) return null;
  return user;
}

export async function clinicsForUser(userId, tenantId) {
  if (LOCAL_DASHBOARD_NO_LOGIN && userId === LOCAL_DASHBOARD_USER_ID && tenantId === LOCAL_DASHBOARD_TENANT_ID) {
    return [{ clinicId: LOCAL_DASHBOARD_CLINIC_ID, clinicName: LOCAL_DASHBOARD_CLINIC_NAME, role: 'owner', status: 'active', timezone: 'America/Toronto' }];
  }
  const access = await prisma.user_clinic_access.findMany({
    where: { user_id: userId, tenant_id: tenantId },
    include: { clinic_configs: true },
  });
  // Sorted by clinic_name (not clinic_id) so the picker/switcher lists
  // clinics the way a human would expect, not by internal id order
  // (multi-clinic-prompt.md §2).
  return access
    .map((a) => ({
      clinicId: a.clinic_id,
      clinicName: a.clinic_configs?.clinic_name ?? a.clinic_id,
      role: a.role,
      status: a.clinic_configs?.status ?? null,
      timezone: a.clinic_configs?.timezone ?? null,
    }))
    .sort((x, y) => x.clinicName.localeCompare(y.clinicName));
}

// Minimal in-memory sliding-window rate limiter (§15: login, settings
// saves, recovery mutations, Retell option lookups). No new infra - fine
// for a single Node process; swap for a shared store (Redis) once this
// server runs more than one instance.
const rateBuckets = new Map();
export function rateLimit(key, max, windowMs) {
  return (req, res, next) => {
    const bucketKey = `${key}:${req.ip}`;
    const now = Date.now();
    const recent = (rateBuckets.get(bucketKey) ?? []).filter((t) => now - t < windowMs);
    if (recent.length >= max) {
      return res.status(429).json({ error: { code: 'RATE_LIMITED', message: 'Too many requests - please slow down.', retryable: true } });
    }
    recent.push(now);
    rateBuckets.set(bucketKey, recent);
    next();
  };
}

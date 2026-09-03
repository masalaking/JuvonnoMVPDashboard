import crypto from 'crypto';

const MAX_SIGNATURE_AGE_MS = 5 * 60 * 1000;

function invalid(message, status = 401) {
  const error = new Error(message);
  error.status = status;
  error.code = status === 503 ? 'RETELL_WEBHOOK_NOT_CONFIGURED' : 'RETELL_SIGNATURE_INVALID';
  return error;
}

function unavailable(message, code = 'RETELL_SCOPE_UNRESOLVED') {
  const error = new Error(message);
  error.status = 503;
  error.code = code;
  return error;
}

function digits(value) {
  return String(value ?? '').replace(/\D/g, '');
}

// Retell call payloads have used both top-level and nested call fields across
// event types. Only a destination phone is a permitted clinic-routing input;
// agent IDs are intentionally excluded because they may be shared by clinics.
export function extractRetellDestinationPhone(payload) {
  const call = payload?.call && typeof payload.call === 'object' ? payload.call : {};
  const inbound = payload?.call_inbound && typeof payload.call_inbound === 'object' ? payload.call_inbound : {};
  const inboundChat = payload?.chat_inbound && typeof payload.chat_inbound === 'object' ? payload.chat_inbound : {};
  const candidate = payload?.to_number
    ?? payload?.destination_number
    ?? payload?.to_phone_number
    ?? inbound.to_number
    ?? inbound.destination_number
    ?? inboundChat.to_number
    ?? inboundChat.destination_number
    ?? call.to_number
    ?? call.destination_number
    ?? call.to_phone_number;
  return digits(candidate);
}

function stripUntrustedScope(value) {
  if (Array.isArray(value)) return value.map(stripUntrustedScope);
  if (!value || typeof value !== 'object') return value;
  const result = {};
  for (const [key, child] of Object.entries(value)) {
    if (['tenant_id', 'tenantId', 'client_id', 'clientId', 'clinic_id', 'clinicId'].includes(key)) continue;
    result[key] = stripUntrustedScope(child);
  }
  return result;
}

export function withVerifiedClinicScope(payload, scope) {
  return {
    ...stripUntrustedScope(payload),
    tenant_id: scope.tenantId,
    client_id: scope.tenantId,
    clinic_id: scope.clinicId,
  };
}

// Retell signs the exact body sent over the wire, plus its millisecond
// timestamp. Verification must therefore happen before express.json() can
// parse and re-serialize the payload.
export function verifyRetellSignature(rawBody, signature, webhookKey, now = Date.now()) {
  if (!webhookKey) throw invalid('Retell webhook verification is not configured.', 503);
  if (typeof signature !== 'string') throw invalid('Missing Retell signature.');
  const match = /^v=(\d+),d=([a-f0-9]{64})$/i.exec(signature.trim());
  if (!match) throw invalid('Malformed Retell signature.');

  const timestamp = Number(match[1]);
  if (!Number.isSafeInteger(timestamp) || Math.abs(now - timestamp) > MAX_SIGNATURE_AGE_MS) {
    throw invalid('Expired Retell signature.');
  }

  const expected = crypto
    .createHmac('sha256', webhookKey)
    .update(Buffer.concat([Buffer.from(rawBody), Buffer.from(match[1])]))
    .digest();
  const received = Buffer.from(match[2], 'hex');
  if (received.length !== expected.length || !crypto.timingSafeEqual(received, expected)) {
    throw invalid('Invalid Retell signature.');
  }
  return true;
}

export function createVerifiedRetellProxy({ webhookKey, targetUrl, authHeader = 'Authorization', authValue = '', fetchImpl = fetch }) {
  return async (req, res) => {
    try {
      const rawBody = Buffer.isBuffer(req.body) ? req.body : Buffer.from('');
      verifyRetellSignature(rawBody, req.headers['x-retell-signature'], webhookKey);
      if (!targetUrl || !authValue) throw invalid('Verified Retell forwarding is not configured.', 503);

      const upstream = await fetchImpl(targetUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          [authHeader]: authValue,
        },
        body: rawBody,
        signal: AbortSignal.timeout(9_000),
      });
      const body = await upstream.text();
      const contentType = upstream.headers.get('content-type');
      if (contentType) res.setHeader('Content-Type', contentType);
      return res.status(upstream.status).send(body);
    } catch (error) {
      const status = error.status ?? 502;
      return res.status(status).json({ error: { code: error.code ?? 'RETELL_WEBHOOK_FORWARD_FAILED', message: status === 401 ? 'Unauthorized.' : 'Webhook unavailable.', retryable: status >= 500 } });
    }
  };
}

// The Receptionist must never use Retell dynamic variables or tool arguments
// as tenant authority. This adapter verifies the vendor signature first, then
// obtains exactly one active clinic scope from a server-side destination-phone
// resolver and forwards a sanitized, canonical scope to n8n.
export function createVerifiedRetellScopedProxy({ webhookKey, targetUrl, authHeader = 'Authorization', authValue = '', scopeResolver, fetchImpl = fetch }) {
  return async (req, res) => {
    try {
      const rawBody = Buffer.isBuffer(req.body) ? req.body : Buffer.from('');
      verifyRetellSignature(rawBody, req.headers['x-retell-signature'], webhookKey);
      if (!targetUrl || !authValue) throw invalid('Verified Retell forwarding is not configured.', 503);
      if (typeof scopeResolver !== 'function') throw unavailable('Receptionist scope resolver is not configured.');

      let payload;
      try { payload = JSON.parse(rawBody.toString('utf8')); } catch { throw unavailable('Retell payload is not valid JSON.'); }
      const destinationPhone = extractRetellDestinationPhone(payload);
      if (!destinationPhone) throw unavailable('Retell destination phone is missing.');
      const scope = await scopeResolver(destinationPhone);
      if (!scope?.tenantId || !scope?.clinicId) throw unavailable('Retell destination phone has no unique active clinic mapping.');

      const upstream = await fetchImpl(targetUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', [authHeader]: authValue },
        body: JSON.stringify(withVerifiedClinicScope(payload, scope)),
        signal: AbortSignal.timeout(9_000),
      });
      const body = await upstream.text();
      const contentType = upstream.headers.get('content-type');
      if (contentType) res.setHeader('Content-Type', contentType);
      return res.status(upstream.status).send(body);
    } catch (error) {
      const status = error.status ?? 502;
      return res.status(status).json({ error: { code: error.code ?? 'RETELL_WEBHOOK_FORWARD_FAILED', message: status === 401 ? 'Unauthorized.' : 'Webhook unavailable.', retryable: status >= 500 } });
    }
  };
}

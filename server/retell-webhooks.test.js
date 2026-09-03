import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'crypto';
import { createVerifiedRetellProxy, createVerifiedRetellScopedProxy, extractRetellDestinationPhone, verifyRetellSignature } from './retell-webhooks.js';

function signature(body, key, timestamp) {
  const digest = crypto.createHmac('sha256', key).update(Buffer.concat([Buffer.from(body), Buffer.from(String(timestamp))])).digest('hex');
  return `v=${timestamp},d=${digest}`;
}

test('Retell webhook verification accepts only the exact signed raw body', () => {
  const now = 1_700_000_000_000;
  const key = 'test-webhook-key';
  const body = '{"event":"call_analyzed","call":{"id":"x"}}';
  assert.equal(verifyRetellSignature(Buffer.from(body), signature(body, key, now), key, now), true);
  assert.throws(() => verifyRetellSignature(Buffer.from('{"event":"call_analyzed"}'), signature(body, key, now), key, now), { code: 'RETELL_SIGNATURE_INVALID' });
});

test('Retell webhook verification rejects absent, stale, and malformed signatures', () => {
  const now = 1_700_000_000_000;
  const key = 'test-webhook-key';
  assert.throws(() => verifyRetellSignature(Buffer.from('{}'), '', key, now), { code: 'RETELL_SIGNATURE_INVALID' });
  assert.throws(() => verifyRetellSignature(Buffer.from('{}'), 'v=bad,d=bad', key, now), { code: 'RETELL_SIGNATURE_INVALID' });
  assert.throws(() => verifyRetellSignature(Buffer.from('{}'), signature('{}', key, now - 300_001), key, now), { code: 'RETELL_SIGNATURE_INVALID' });
});

function responseRecorder() {
  const result = { headers: {}, status: null, body: null };
  return {
    result,
    setHeader(name, value) { result.headers[name] = value; },
    status(code) {
      result.status = code;
      return {
        send(body) { result.body = body; },
        json(body) { result.body = body; },
      };
    },
  };
}

test('verified Retell proxy forwards the exact signed body using internal authentication only', async () => {
  const now = Date.now();
  const key = 'test-webhook-key';
  const body = '{"event":"call_context","call":{"id":"x"}}';
  let forwarded;
  const proxy = createVerifiedRetellProxy({
    webhookKey: key,
    targetUrl: 'https://n8n.example.test/webhook/retell-context',
    authHeader: 'Authorization',
    authValue: 'internal-only',
    fetchImpl: async (url, init) => {
      forwarded = { url, init };
      return new Response('{"success":true}', { status: 200, headers: { 'Content-Type': 'application/json' } });
    },
  });
  const res = responseRecorder();
  await proxy({ body: Buffer.from(body), headers: { 'x-retell-signature': signature(body, key, now) } }, res);
  assert.equal(forwarded.url, 'https://n8n.example.test/webhook/retell-context');
  assert.equal(forwarded.init.headers.Authorization, 'internal-only');
  assert.deepEqual(forwarded.init.body, Buffer.from(body));
  assert.equal(res.result.status, 200);
  assert.equal(res.result.body, '{"success":true}');
});

test('verified Retell proxy fails closed before fetch when forwarding is not configured', async () => {
  const now = Date.now();
  const key = 'test-webhook-key';
  const body = '{}';
  const proxy = createVerifiedRetellProxy({
    webhookKey: key,
    targetUrl: '',
    authValue: '',
    fetchImpl: () => { throw new Error('fetch must not run'); },
  });
  const res = responseRecorder();
  await proxy({ body: Buffer.from(body), headers: { 'x-retell-signature': signature(body, key, now) } }, res);
  assert.equal(res.result.status, 503);
  assert.deepEqual(res.result.body, { error: { code: 'RETELL_WEBHOOK_NOT_CONFIGURED', message: 'Webhook unavailable.', retryable: true } });
});

test('Receptionist proxy derives and injects scope from destination phone only', async () => {
  const now = Date.now();
  const key = 'test-webhook-key';
  const body = JSON.stringify({
    name: 'get_clinic_config',
    tenant_id: 'attacker-tenant',
    clinic_id: 'attacker-clinic',
    call: { to_number: '+1 (416) 555-0199', metadata: { tenant_id: 'also-attacker' } },
    args: { query: 'physiotherapy' },
    dynamic_variables: { clinic_id: 'attacker-again' },
  });
  let forwarded;
  const proxy = createVerifiedRetellScopedProxy({
    webhookKey: key,
    targetUrl: 'https://n8n.example.test/webhook/retell-inbound',
    authValue: 'internal-only',
    scopeResolver: async phone => {
      assert.equal(phone, '14165550199');
      return { tenantId: 'trusted-tenant', clinicId: 'trusted-clinic' };
    },
    fetchImpl: async (_, init) => {
      forwarded = JSON.parse(init.body);
      return new Response('{"success":true}', { status: 200 });
    },
  });
  const res = responseRecorder();
  await proxy({ body: Buffer.from(body), headers: { 'x-retell-signature': signature(body, key, now) } }, res);
  assert.equal(forwarded.tenant_id, 'trusted-tenant');
  assert.equal(forwarded.client_id, 'trusted-tenant');
  assert.equal(forwarded.clinic_id, 'trusted-clinic');
  assert.equal(forwarded.name, 'get_clinic_config');
  assert.deepEqual(forwarded.args, { query: 'physiotherapy' });
  assert.equal('tenant_id' in forwarded.call.metadata, false);
  assert.equal('clinic_id' in forwarded.dynamic_variables, false);
});

test('Receptionist proxy fails closed for a missing or non-unique destination mapping', async () => {
  const now = Date.now();
  const key = 'test-webhook-key';
  const body = JSON.stringify({ call: { to_number: '+14165550199' } });
  const proxy = createVerifiedRetellScopedProxy({
    webhookKey: key,
    targetUrl: 'https://n8n.example.test/webhook/retell-inbound',
    authValue: 'internal-only',
    scopeResolver: async () => null,
    fetchImpl: () => { throw new Error('fetch must not run'); },
  });
  const res = responseRecorder();
  await proxy({ body: Buffer.from(body), headers: { 'x-retell-signature': signature(body, key, now) } }, res);
  assert.equal(res.result.status, 503);
  assert.equal(res.result.body.error.code, 'RETELL_SCOPE_UNRESOLVED');
  assert.equal(extractRetellDestinationPhone({ call: { destination_number: '(416) 555-0199' } }), '4165550199');
  // Retell's documented inbound-webhook shape has no call object yet.
  assert.equal(extractRetellDestinationPhone({ event: 'call_inbound', call_inbound: { to_number: '+1 (416) 555-0199' } }), '14165550199');
});

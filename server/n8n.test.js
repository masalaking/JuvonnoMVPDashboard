import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

const n8nModuleUrl = new URL('./n8n.js', import.meta.url).href;

function runIsolatedN8n(code, env) {
  const result = spawnSync(process.execPath, ['--input-type=module', '--eval', code], {
    env: { ...process.env, ...env },
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout);
}

test('n8n transport fails locally when its server-to-server credential is missing', () => {
  const result = runIsolatedN8n(`
    import { getPublicSettings } from '${n8nModuleUrl}';
    globalThis.fetch = () => { throw new Error('fetch must not run'); };
    try { await getPublicSettings('tenant-a', 'clinic-a'); }
    catch (error) { console.log(JSON.stringify({ status: error.status, code: error.code, message: error.message })); }
  `, { N8N_BASE_URL: 'https://n8n.example.test/webhook', N8N_DASHBOARD_AUTH_VALUE: '' });
  assert.deepEqual(result, {
    status: 503,
    code: 'N8N_AUTH_NOT_CONFIGURED',
    message: 'The upstream dashboard integration is not configured.',
  });
});

test('n8n upstream error bodies are not reflected to the browser', () => {
  const result = runIsolatedN8n(`
    import { getPublicSettings } from '${n8nModuleUrl}';
    globalThis.fetch = async () => new Response(JSON.stringify({ error: { message: 'database host and secret detail' } }), { status: 500, headers: { 'Content-Type': 'application/json' } });
    try { await getPublicSettings('tenant-a', 'clinic-a'); }
    catch (error) { console.log(JSON.stringify({ status: error.status, code: error.code, message: error.message })); }
  `, { N8N_BASE_URL: 'https://n8n.example.test/webhook', N8N_DASHBOARD_AUTH_VALUE: 'test-only' });
  assert.deepEqual(result, {
    status: 502,
    code: 'N8N_UPSTREAM_FAILED',
    message: 'The upstream service could not complete the request.',
  });
});

test('n8n GET transport forwards only verified scope in both legacy aliases', () => {
  const result = runIsolatedN8n(`
    import { n8nGet } from '${n8nModuleUrl}';
    globalThis.fetch = async (url) => {
      const parsed = new URL(url);
      console.log(JSON.stringify({
        tenant_id: parsed.searchParams.get('tenant_id'), tenantId: parsed.searchParams.get('tenantId'),
        clinic_id: parsed.searchParams.get('clinic_id'), clinicId: parsed.searchParams.get('clinicId'),
      }));
      return new Response('{}', { status: 200 });
    };
    await n8nGet('example', 'tenant-a', 'clinic-a');
  `, { N8N_BASE_URL: 'https://n8n.example.test/webhook', N8N_DASHBOARD_AUTH_VALUE: 'test-only' });
  assert.deepEqual(result, { tenant_id: 'tenant-a', tenantId: 'tenant-a', clinic_id: 'clinic-a', clinicId: 'clinic-a' });
});

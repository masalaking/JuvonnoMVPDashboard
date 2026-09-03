/*
 * Published-workflow authorization denial probe.
 *
 * Only fixed fictional identifiers are transmitted. A passing response proves
 * that the workflow rejects unknown scope before preparing any Juvonno calls.
 */
import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { runManagerAnalystTool } from '../server/n8n.js';

const result = await runManagerAnalystTool({
  action: 'advisor.overview',
  userId: 'fictional_advisor_denial_user',
  tenantId: 'fictional_advisor_denial_tenant',
  clinicIds: ['fictional_advisor_denial_clinic'],
  startDate: '2026-08-01',
  endDate: '2026-08-30',
  correlationId: `advisor-fictional-denial-${randomUUID()}`,
});

const passed = result?.success === false
  && result?.error_code === 'CLINIC_ACCESS_FORBIDDEN'
  && Array.isArray(result?.sources)
  && result.sources.length === 0;

console.log(JSON.stringify({
  passed,
  success: result?.success ?? null,
  error_code: result?.error_code ?? null,
  source_count: Array.isArray(result?.sources) ? result.sources.length : null,
  fictional_scope_only: true,
}, null, 2));

if (!passed) process.exitCode = 1;

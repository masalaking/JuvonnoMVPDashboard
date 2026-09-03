import 'dotenv/config';
import fs from 'node:fs';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const workflowPath = 'C:/Users/aarya/Documents/Codex/2026-08-06/i-o/outputs/RivaCare AI Clinic Advisor Production 2026-08-27/RivaCare Manager Analyst Tools - JUVONNO LIVE READS REPLACEMENT.json';

try {
  const workflow = JSON.parse(fs.readFileSync(workflowPath, 'utf8'));
  const sql = workflow.nodes.find(node => node.name === 'Resolve Authorized Scope and Database Metrics')?.parameters?.query;
  if (!sql) throw new Error('Advisor SQL node was not found in workflow file.');
  const [user] = await prisma.$queryRawUnsafe(
    'SELECT id, tenant_id FROM users WHERE username = $1 LIMIT 1',
    process.env.LOCAL_DASHBOARD_USERNAME || 'test_clinic',
  );
  if (!user) throw new Error('Local test user was not found.');
  const rows = await prisma.$queryRawUnsafe(sql, user.id, user.tenant_id, ['clinic_001'], 'advisor.appointment_metrics', '2026-07-28', '2026-08-27', '');
  const row = rows[0] ?? {};
  const configs = typeof row.juvonno_configs === 'string' ? JSON.parse(row.juvonno_configs) : row.juvonno_configs;
  console.log(JSON.stringify({
    sql_runs: true,
    has_access: row.has_access,
    clinic_count: Number(row.clinic_count ?? 0),
    metric_rows: Array.isArray(row.data) ? row.data.length : null,
    configured_juvonno_clinics: Array.isArray(configs) ? configs.map(config => ({
      clinic_id: config.clinic_id,
      has_base_url: Boolean(config.base_url),
      has_branch_code: Boolean(config.branch_code),
      has_api_key: Boolean(config.api_key),
    })) : [],
  }));
} catch (error) {
  console.log(JSON.stringify({ sql_runs: false, code: error?.code ?? null, message: String(error?.message ?? error).split('\n')[0] }));
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}

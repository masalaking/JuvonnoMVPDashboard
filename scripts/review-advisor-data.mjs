import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const tenantId = process.env.LOCAL_DASHBOARD_TENANT_ID || 'clinic_001';
const clinicId = process.env.LOCAL_DASHBOARD_CLINIC_ID || 'clinic_001';

try {
  const [localUser] = await prisma.$queryRawUnsafe(
    'SELECT id, tenant_id FROM users WHERE username = $1 LIMIT 1',
    process.env.LOCAL_DASHBOARD_USERNAME || 'test_clinic',
  );
  const [integration] = await prisma.$queryRawUnsafe(`
    SELECT
      c.juvonno_base_url IS NOT NULL AND c.juvonno_base_url <> '' AS has_base_url,
      c.default_branch_code IS NOT NULL AND c.default_branch_code <> '' AS has_branch_code,
      c.juvonno_api_key_encrypted IS NOT NULL AS has_encrypted_api_key,
      CASE WHEN c.juvonno_api_key_encrypted IS NULL THEN false
           ELSE length(rivacare_decrypt_config_secret(c.juvonno_api_key_encrypted)) > 0 END AS decryptable_api_key
    FROM clinic_configs c
    WHERE c.tenant_id = $1 AND c.clinic_id = $2
    LIMIT 1
  `, tenantId, clinicId);
  const rows = await prisma.$queryRawUnsafe(`
    SELECT 'calls' AS source, count(*)::text AS row_count,
           min(created_at)::text AS first_record_at, max(created_at)::text AS last_record_at
    FROM calls WHERE tenant_id = $1 AND clinic_id = $2
    UNION ALL
    SELECT 'appointment_events', count(*)::text, min(created_at)::text, max(created_at)::text
    FROM appointment_events WHERE tenant_id = $1 AND clinic_id = $2
    UNION ALL
    SELECT 'invoices', count(*)::text, min(generated_at)::text, max(generated_at)::text
    FROM invoices WHERE tenant_id = $1 AND clinic_id = $2
    UNION ALL
    SELECT 'payment_recovery_invoices', count(*)::text, min(created_at)::text, max(created_at)::text
    FROM payment_recovery_invoices WHERE tenant_id = $1 AND clinic_id = $2
    ORDER BY source;
  `, tenantId, clinicId);
  console.log(JSON.stringify({
    tenant_id: tenantId,
    clinic_id: clinicId,
    local_user: localUser ? { id: localUser.id, tenant_id: localUser.tenant_id } : null,
    juvonno_integration: integration ?? null,
    sources: rows,
  }, null, 2));
} catch (error) {
  console.log(JSON.stringify({
    error: true,
    code: error?.code ?? null,
    message: String(error?.message ?? error).split('\n')[0],
  }));
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}

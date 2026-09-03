/*
 * Read-only discovery for clearly labeled non-production Advisor scopes.
 * It deliberately returns identifiers/configuration presence only and never
 * decrypts or prints clinic credentials.
 */
import 'dotenv/config';
import { prisma } from '../server/db.js';

try {
  const [scopes, statusConstraints] = await Promise.all([
    prisma.$queryRawUnsafe(`
    SELECT
      c.tenant_id,
      c.clinic_id,
      c.clinic_name,
      c.status,
      c.default_branch_code IS NOT NULL AS has_branch_code,
      c.juvonno_base_url IS NOT NULL AS has_juvonno_base_url,
      c.juvonno_api_key_encrypted IS NOT NULL AS has_juvonno_api_key,
      EXISTS (
        SELECT 1 FROM user_clinic_access a
        WHERE a.tenant_id = c.tenant_id AND a.clinic_id = c.clinic_id
          AND lower(a.role) IN ('owner', 'admin')
      ) AS has_manager_access
    FROM clinic_configs c
    LEFT JOIN tenants t ON t.id = c.tenant_id
    WHERE concat_ws(' ', c.tenant_id, c.clinic_id, c.clinic_name, t.slug, t.name)
      ~* '(staging|sandbox|synthetic|test|qa)'
    ORDER BY c.tenant_id, c.clinic_id
    LIMIT 50
  `),
    prisma.$queryRawUnsafe(`
      SELECT conrelid::regclass::text AS table_name, conname,
        pg_get_constraintdef(oid) AS definition
      FROM pg_constraint
      WHERE conrelid IN ('tenants'::regclass, 'clinic_configs'::regclass)
        AND contype = 'c' AND pg_get_constraintdef(oid) ILIKE '%status%'
      ORDER BY table_name, conname
    `),
  ]);
  console.log(JSON.stringify({
    candidate_count: scopes.length,
    candidates: scopes,
    status_constraints: statusConstraints,
  }, null, 2));
} finally {
  await prisma.$disconnect();
}

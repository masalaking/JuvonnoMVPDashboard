import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
try {
  const rows = await prisma.$queryRawUnsafe(`
    SELECT
      EXISTS (SELECT 1 FROM pg_extension WHERE extname='vector') AS vector_installed,
      ARRAY(SELECT table_name::text FROM information_schema.tables WHERE table_schema='public' AND table_name IN (
        'advisor_conversations','advisor_messages','advisor_memories','advisor_memory_clinics','advisor_memory_jobs','advisor_audit_events'
      ) ORDER BY table_name) AS advisor_tables,
      ARRAY(SELECT indexname::text FROM pg_indexes WHERE schemaname='public' AND indexname LIKE 'advisor_%' ORDER BY indexname) AS advisor_indexes,
      (SELECT count(*)::int FROM advisor_conversations) AS conversations,
      (SELECT count(*)::int FROM advisor_messages) AS messages,
      (SELECT count(*)::int FROM advisor_memories) AS memories,
      (SELECT count(*)::int FROM advisor_memory_jobs) AS memory_jobs
  `);
  console.log(JSON.stringify(rows));
  const access = await prisma.$queryRawUnsafe(`
    SELECT lower(a.role)::text AS role, count(*)::int AS access_rows,
      count(*) FILTER (WHERE c.status='active')::int AS active_clinic_rows
    FROM user_clinic_access a
    LEFT JOIN clinic_configs c ON c.tenant_id=a.tenant_id AND c.clinic_id=a.clinic_id
    WHERE lower(a.role) IN ('owner','admin')
    GROUP BY lower(a.role) ORDER BY lower(a.role)
  `);
  console.log(JSON.stringify(access));
} finally {
  await prisma.$disconnect();
}

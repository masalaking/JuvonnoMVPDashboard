/*
 * Provision or remove a deliberately isolated Advisor QA scope.
 *
 * This tool is intentionally guarded because it writes to the configured
 * database. It never modifies an existing tenant or clinic, and cleanup only
 * deletes rows whose IDs and names exactly match the built-in QA marker.
 */
import 'dotenv/config';
import { prisma } from '../server/db.js';
import { createRecommendation, updateRecommendation } from '../server/advisor-recommendations.js';

const MARKER = 'SYNTHETIC_ADVISOR_QA_20260829';
const CONFIRMATION = 'I_AUTHORIZE_TEMPORARY_SYNTHETIC_ADVISOR_QA_SCOPE';
const ids = Object.freeze({
  tenant: 'synthetic_advisor_qa_tenant_20260829',
  foreignTenant: 'synthetic_advisor_qa_foreign_tenant_20260829',
  clinic: 'synthetic_advisor_qa_clinic_20260829',
  foreignClinic: 'synthetic_advisor_qa_foreign_clinic_20260829',
  user: 'synthetic_advisor_qa_user_20260829',
  username: 'synthetic-advisor-qa-20260829@invalid.local',
});

function refuse(message) {
  console.error(JSON.stringify({ success: false, error: message }, null, 2));
  process.exitCode = 64;
}

function requireGuard(command) {
  if (!['provision', 'cleanup'].includes(command)) {
    refuse('Usage: node scripts/manage-advisor-synthetic-scope.mjs <provision|cleanup>');
    return false;
  }
  if (process.env.ADVISOR_SYNTHETIC_SCOPE_CONFIRM !== CONFIRMATION) {
    refuse(`Set ADVISOR_SYNTHETIC_SCOPE_CONFIRM=${CONFIRMATION} to ${command} the isolated QA scope.`);
    return false;
  }
  return true;
}

async function findExisting(tx = prisma) {
  return tx.$queryRawUnsafe(`
    SELECT 'tenant' kind, id, name label FROM tenants
      WHERE id = ANY($1::text[]) OR slug = ANY($1::text[])
    UNION ALL
    SELECT 'clinic' kind, tenant_id || '/' || clinic_id id, clinic_name label
      FROM clinic_configs
      WHERE tenant_id = ANY($1::text[]) OR clinic_id = ANY($2::text[])
    UNION ALL
    SELECT 'user' kind, id, username label FROM users
      WHERE id = $3 OR username = $4
    ORDER BY kind, id
  `, [ids.tenant, ids.foreignTenant], [ids.clinic, ids.foreignClinic], ids.user, ids.username);
}

async function provision() {
  const existing = await findExisting();
  if (existing.length) {
    refuse('Refusing to provision because one or more reserved synthetic IDs already exist. Inspect with find-advisor-staging-scope.mjs before cleanup.');
    return;
  }

  await prisma.$transaction(async tx => {
    await tx.$executeRawUnsafe(`
      INSERT INTO tenants (id, slug, name, status, timezone)
      VALUES ($1, $1, $2, 'onboarding', 'America/Toronto'),
             ($3, $3, $4, 'onboarding', 'America/Toronto')
    `, ids.tenant, `${MARKER} Primary Tenant`, ids.foreignTenant, `${MARKER} Foreign Tenant`);
    await tx.$executeRawUnsafe(`
      INSERT INTO clinic_configs
        (tenant_id, client_id, clinic_id, clinic_name, status, timezone, settings)
      VALUES
        ($1, $2, $2, $3, 'inactive', 'America/Toronto', $4::jsonb),
        ($1, $5, $5, $6, 'inactive', 'America/Toronto', $4::jsonb),
        ($7, $2, $2, $8, 'inactive', 'America/Toronto', $4::jsonb)
    `,
      ids.tenant, ids.clinic, `${MARKER} Primary Clinic`, JSON.stringify({ qa_marker: MARKER, non_production: true }),
      ids.foreignClinic, `${MARKER} Foreign Clinic`, ids.foreignTenant, `${MARKER} Foreign Tenant Same Clinic ID`);
    await tx.$executeRawUnsafe(`
      INSERT INTO users (id, tenant_id, username, password_hash)
      VALUES ($1, $2, $3, '!SYNTHETIC_QA_NO_INTERACTIVE_LOGIN!')
    `, ids.user, ids.tenant, ids.username);
    await tx.$executeRawUnsafe(`
      INSERT INTO user_clinic_access (user_id, tenant_id, clinic_id, role)
      VALUES ($1, $2, $3, 'owner')
    `, ids.user, ids.tenant, ids.clinic);
  });

  const recommendation = await createRecommendation({
    tenantId: ids.tenant,
    clinicId: ids.clinic,
    body: {
      category: 'synthetic_qa',
      title: `${MARKER} No-show reminder`,
      problem_identified: 'Synthetic no-show baseline for authenticated Advisor matrix validation.',
      evidence: [{ type: 'synthetic', marker: MARKER }],
      baseline_metric: { name: 'no_show_rate', value: 10, improvement_direction: 'lower_is_better' },
      baseline_start_date: '2026-01-01',
      baseline_end_date: '2026-01-31',
      recommended_action: 'Send a synthetic reminder for QA validation only.',
      target_metric: { name: 'no_show_rate', value: 8, improvement_direction: 'lower_is_better' },
      implementation_status: 'suggested',
    },
    sources: [{ source_name: 'synthetic_qa', marker: MARKER }],
  });
  await updateRecommendation({
    tenantId: ids.tenant,
    clinicIds: [ids.clinic],
    id: recommendation.id,
    body: { implementation_status: 'implemented', implementation_date: '2026-02-01' },
  });
  await updateRecommendation({
    tenantId: ids.tenant,
    clinicIds: [ids.clinic],
    id: recommendation.id,
    body: { implementation_status: 'monitoring', current_metric: { name: 'no_show_rate', value: 6 }, percentage_change: -40 },
  });

  console.log(JSON.stringify({
    success: true,
    action: 'provision',
    marker: MARKER,
    staging_environment: 'staging',
    tenant_id: ids.tenant,
    clinic_id: ids.clinic,
    foreign_tenant_id: ids.foreignTenant,
    foreign_clinic_id: ids.foreignClinic,
    user_id: ids.user,
    juvonno_configured: false,
    recommendation_seeded: true,
  }, null, 2));
}

async function cleanup() {
  const tenants = await prisma.$queryRawUnsafe(`
    SELECT id, name FROM tenants WHERE id = ANY($1::text[]) ORDER BY id
  `, [ids.tenant, ids.foreignTenant]);
  const unexpected = tenants.filter(row => !String(row.name ?? '').startsWith(MARKER));
  if (unexpected.length) {
    refuse('Refusing cleanup because a reserved tenant ID does not carry the exact synthetic QA marker.');
    return;
  }

  const deleted = await prisma.$transaction(async tx => {
    const recommendations = await tx.$executeRawUnsafe(
      'DELETE FROM advisor_recommendations WHERE tenant_id = ANY($1::text[])',
      [ids.tenant, ids.foreignTenant],
    );
    const tenantRows = await tx.$executeRawUnsafe(
      'DELETE FROM tenants WHERE id = ANY($1::text[]) AND name LIKE $2',
      [ids.tenant, ids.foreignTenant], `${MARKER}%`,
    );
    return { recommendations, tenants: tenantRows };
  });
  console.log(JSON.stringify({ success: true, action: 'cleanup', marker: MARKER, deleted }, null, 2));
}

const command = String(process.argv[2] ?? '').toLowerCase();
try {
  if (requireGuard(command)) {
    if (command === 'provision') await provision();
    else await cleanup();
  }
} catch (error) {
  console.error(JSON.stringify({
    success: false,
    action: command || null,
    code: error?.code ?? null,
    database_code: error?.meta?.code ?? null,
    error: String(error?.meta?.message ?? error?.message ?? error).split('\n')[0],
  }, null, 2));
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}

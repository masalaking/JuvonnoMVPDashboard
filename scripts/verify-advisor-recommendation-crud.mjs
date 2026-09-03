/*
 * Deliberate non-production integration check for Advisor recommendations.
 * This script refuses to write unless an operator explicitly identifies a
 * synthetic tenant/clinic and confirms the environment is non-production.
 */
import 'dotenv/config';
import crypto from 'crypto';
import { prisma } from '../server/db.js';
import { createRecommendation, listRecommendations, updateRecommendation } from '../server/advisor-recommendations.js';

const required = [
  'ADVISOR_STAGING_ENVIRONMENT',
  'ADVISOR_STAGING_TENANT_ID',
  'ADVISOR_STAGING_CLINIC_ID',
  'ADVISOR_STAGING_FOREIGN_TENANT_ID',
  'ADVISOR_STAGING_FOREIGN_CLINIC_ID',
  'ADVISOR_STAGING_CONFIRM',
];
const missing = required.filter(name => !String(process.env[name] ?? '').trim());
const nonProduction = /^(staging|test|development|non-production)$/i.test(String(process.env.ADVISOR_STAGING_ENVIRONMENT ?? ''));
const confirmed = String(process.env.ADVISOR_STAGING_CONFIRM ?? '') === 'I_UNDERSTAND_THIS_WRITES_SYNTHETIC_QA_DATA';
const tenantId = String(process.env.ADVISOR_STAGING_TENANT_ID ?? '');
const clinicId = String(process.env.ADVISOR_STAGING_CLINIC_ID ?? '');
const foreignTenantId = String(process.env.ADVISOR_STAGING_FOREIGN_TENANT_ID ?? '');
const foreignClinicId = String(process.env.ADVISOR_STAGING_FOREIGN_CLINIC_ID ?? '');
let createdId = null;

function fail(message, code = 2) {
  console.error(JSON.stringify({ success: false, error: message }, null, 2));
  process.exitCode = code;
}

async function main() {
  if (missing.length || !nonProduction || !confirmed) {
    const reasons = [
      ...(missing.length ? [`missing variables: ${missing.join(', ')}`] : []),
      ...(!nonProduction ? ['ADVISOR_STAGING_ENVIRONMENT must explicitly be staging, test, development, or non-production'] : []),
      ...(!confirmed ? ['ADVISOR_STAGING_CONFIRM must equal I_UNDERSTAND_THIS_WRITES_SYNTHETIC_QA_DATA'] : []),
    ];
    fail(`Refusing recommendation CRUD test: ${reasons.join('; ')}`, 64);
    return;
  }
  if (tenantId === foreignTenantId || clinicId === foreignClinicId) {
    fail('Foreign tenant and clinic identifiers must differ from the synthetic QA scope.', 64);
    return;
  }

  const marker = `advisor-qa-${crypto.randomUUID()}`;
  const created = await createRecommendation({
    tenantId,
    clinicId,
    body: {
      category: 'synthetic_qa',
      title: marker,
      problem_identified: 'Synthetic recommendation-storage validation only.',
      evidence: [{ type: 'synthetic', marker }],
      baseline_metric: { name: 'no_show_rate', value: 10, improvement_direction: 'lower_is_better' },
      baseline_start_date: '2026-01-01',
      baseline_end_date: '2026-01-31',
      recommended_action: 'Synthetic QA action only.',
      target_metric: { name: 'no_show_rate', value: 8, improvement_direction: 'lower_is_better' },
      implementation_status: 'suggested',
    },
    sources: [{ source_name: 'synthetic_qa', marker }],
  });
  createdId = created.id;

  const ownRead = await listRecommendations(tenantId, [clinicId]);
  const readCreated = ownRead.some(row => row.id === createdId);
  const baselineSaved = await updateRecommendation({ tenantId, clinicIds: [clinicId], id: createdId, body: { implementation_status: 'accepted', implementation_date: '2026-02-01' } });
  const statusChanged = await updateRecommendation({ tenantId, clinicIds: [clinicId], id: createdId, body: { implementation_status: 'implemented' } });
  const currentSaved = await updateRecommendation({ tenantId, clinicIds: [clinicId], id: createdId, body: { implementation_status: 'monitoring', current_metric: { name: 'no_show_rate', value: 7 }, percentage_change: -30 } });
  const foreignTenantRows = await listRecommendations(foreignTenantId, [clinicId]);
  const foreignClinicRows = await listRecommendations(tenantId, [foreignClinicId]);
  const foreignTenantUpdate = await updateRecommendation({ tenantId: foreignTenantId, clinicIds: [clinicId], id: createdId, body: { implementation_status: 'reverted' } });
  const foreignClinicUpdate = await updateRecommendation({ tenantId, clinicIds: [foreignClinicId], id: createdId, body: { implementation_status: 'reverted' } });
  const result = {
    success: Boolean(readCreated && baselineSaved?.implementation_status === 'accepted' && statusChanged?.implementation_status === 'implemented' && currentSaved?.implementation_status === 'monitoring' && currentSaved?.measurement?.available && !foreignTenantRows.some(row => row.id === createdId) && !foreignClinicRows.some(row => row.id === createdId) && foreignTenantUpdate === null && foreignClinicUpdate === null),
    create_recommendation: Boolean(createdId),
    read_recommendation: readCreated,
    update_recommendation: baselineSaved?.implementation_status === 'accepted',
    status_transitions: statusChanged?.implementation_status === 'implemented' && currentSaved?.implementation_status === 'monitoring',
    baseline_saved: baselineSaved?.baseline_start_date != null,
    current_metric_saved: currentSaved?.current_metric?.value === 7,
    tenant_scoped_retrieval: !foreignTenantRows.some(row => row.id === createdId),
    clinic_scoped_retrieval: !foreignClinicRows.some(row => row.id === createdId),
    foreign_tenant_rejected: foreignTenantUpdate === null,
    foreign_clinic_rejected: foreignClinicUpdate === null,
  };
  console.log(JSON.stringify(result, null, 2));
  if (!result.success) process.exitCode = 2;
}

try {
  await main();
} finally {
  if (createdId) await prisma.$executeRawUnsafe('DELETE FROM advisor_recommendations WHERE id=$1::uuid AND tenant_id=$2 AND clinic_id=$3', createdId, tenantId, clinicId).catch(() => {});
  await prisma.$disconnect();
}

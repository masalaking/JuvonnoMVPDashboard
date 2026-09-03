/*
 * Opt-in, read-only deployment probe for the Advisor n8n webhook.
 * The operator must explicitly provide an already-authorized non-production
 * scope. The script never prints those identifiers or any returned clinic data.
 */
import 'dotenv/config';
import { runManagerAnalystTool } from '../server/n8n.js';
import { prisma } from '../server/db.js';

const allowedActions = new Set([
  'advisor.capacity_utilization',
  'advisor.cancellation_rebooking',
  'advisor.no_show_analytics',
  'advisor.call_conversion',
  'advisor.call_themes',
  'advisor.retention',
  'advisor.retention_cohorts',
  'advisor.appointment_frequency_changes',
  'advisor.engagement_risk',
  'advisor.engagement_risk_patients',
  'advisor.revenue_risk',
]);

const actionIndex = process.argv.indexOf('--action');
const action = actionIndex >= 0 ? String(process.argv[actionIndex + 1] ?? '') : 'advisor.appointment_frequency_changes';
const required = ['ADVISOR_PROBE_USER_ID', 'ADVISOR_PROBE_TENANT_ID', 'ADVISOR_PROBE_CLINIC_ID'];
const autoScope = process.argv.includes('--auto-sandbox-scope');
const sandboxConfirmed = process.env.ADVISOR_PROBE_ALL_CLINICS_ARE_SANDBOX === 'I_CONFIRM_ALL_JUVONNO_CLINICS_ARE_SANDBOX';
let scope = {
  userId: String(process.env.ADVISOR_PROBE_USER_ID ?? '').trim(),
  tenantId: String(process.env.ADVISOR_PROBE_TENANT_ID ?? '').trim(),
  clinicId: String(process.env.ADVISOR_PROBE_CLINIC_ID ?? '').trim(),
};

if (autoScope && sandboxConfirmed) {
  const rows = await prisma.$queryRawUnsafe(`
    SELECT a.user_id, a.tenant_id, a.clinic_id
    FROM user_clinic_access a
    JOIN clinic_configs c
      ON c.tenant_id = a.tenant_id AND c.clinic_id = a.clinic_id
    WHERE lower(a.role) IN ('owner', 'admin')
      AND c.juvonno_base_url IS NOT NULL
      AND c.default_branch_code IS NOT NULL
      AND c.juvonno_api_key_encrypted IS NOT NULL
    ORDER BY CASE WHEN c.status = 'active' THEN 0 ELSE 1 END,
      c.updated_at DESC, a.created_at DESC
    LIMIT 1
  `);
  if (rows[0]) scope = { userId: rows[0].user_id, tenantId: rows[0].tenant_id, clinicId: rows[0].clinic_id };
}

const missing = Object.entries(scope).filter(([, value]) => !value).map(([name]) => name);

if (!allowedActions.has(action)) {
  console.error(`Unsupported read-only Advisor probe action: ${action}`);
  process.exitCode = 64;
} else if (missing.length) {
  const reason = autoScope && !sandboxConfirmed
    ? 'Auto scope requires ADVISOR_PROBE_ALL_CLINICS_ARE_SANDBOX=I_CONFIRM_ALL_JUVONNO_CLINICS_ARE_SANDBOX.'
    : `Missing required probe scope value(s): ${missing.join(', ')}.`;
  console.error(reason);
  process.exitCode = 64;
} else {
  try {
    const result = await runManagerAnalystTool({
      action,
      userId: scope.userId,
      tenantId: scope.tenantId,
      clinicIds: [scope.clinicId],
      startDate: process.env.ADVISOR_PROBE_START_DATE ?? '2026-07-30',
      endDate: process.env.ADVISOR_PROBE_END_DATE ?? '2026-08-29',
      patientIdentifier: null,
      detailIdentifier: null,
      practitionerIdentifier: null,
      correlationId: `advisor-deployment-probe-${Date.now()}`,
    });
    const summary = {
      action,
      success: result?.success === true,
      error_code: result?.error_code ?? result?.error?.code ?? null,
      data_present: Boolean(result?.data),
      source_count: Array.isArray(result?.sources) ? result.sources.length : 0,
    };
    if (process.argv.includes('--print-scope')) summary.scope = scope;
    const live = Array.isArray(result?.data?.juvonno_live) ? result.data.juvonno_live[0] : null;
    const field = action.replace('advisor.', '');
    const analytics = live?.[field] ?? null;
    if (analytics) {
      summary.analytics = {
        appointment_data_complete: analytics.appointment_data_complete ?? null,
        availability_data_complete: analytics.availability_data_complete ?? null,
        total_available_minutes: analytics.total_available_minutes ?? null,
        total_booked_minutes: analytics.total_booked_minutes ?? null,
        total_unused_minutes: analytics.total_unused_minutes ?? null,
        utilization_rate: analytics.utilization_rate ?? null,
      };
      if (action === 'advisor.capacity_utilization') {
        summary.analytics.breakdown_group_counts = {
          practitioner: Array.isArray(analytics.practitioner_breakdown) ? analytics.practitioner_breakdown.length : 0,
          service: Array.isArray(analytics.service_breakdown) ? analytics.service_breakdown.length : 0,
          weekday: Array.isArray(analytics.day_of_week_breakdown) ? analytics.day_of_week_breakdown.length : 0,
        };
        summary.analytics.available_slot_count = analytics.available_slot_count ?? null;
        summary.analytics.booked_slot_count = analytics.booked_slot_count ?? null;
        summary.analytics.unused_slot_count = analytics.unused_slot_count ?? null;
        summary.analytics.estimated_revenue_opportunity = analytics.estimated_revenue_opportunity ?? null;
      }
      if (action === 'advisor.retention_cohorts') {
        Object.assign(summary.analytics, {
          patient_identifier_coverage: analytics.patient_identifier_coverage ?? null,
          new_patient_count: analytics.new_patient_count ?? null,
          returned_for_visit_2_count: analytics.returned_for_visit_2_count ?? null,
          returned_for_visit_2_rate: analytics.returned_for_visit_2_rate ?? null,
          returned_for_visit_3_count: analytics.returned_for_visit_3_count ?? null,
          returned_for_visit_3_rate: analytics.returned_for_visit_3_rate ?? null,
          retention_180_days: analytics.retention_180_days ?? null,
        });
      }
    }
    if (live?.appointment_source) summary.appointment_source = live.appointment_source;
    if (live?.availability_source) summary.availability_source = live.availability_source;
    if (live?.analytics_source_limits) summary.analytics_source_limits = live.analytics_source_limits;
    console.log(JSON.stringify(summary, null, 2));
    if (process.argv.includes('--require-success') && !summary.success) process.exitCode = 2;
  } catch (error) {
    console.log(JSON.stringify({ action, success: false, error_code: error?.code ?? null, error: error?.message ?? String(error) }, null, 2));
    process.exitCode = 2;
  }
}

await prisma.$disconnect();

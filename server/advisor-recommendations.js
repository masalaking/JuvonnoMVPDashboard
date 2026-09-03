import crypto from 'crypto';
import { prisma } from './db.js';

const STATUSES = new Set(['suggested', 'accepted', 'in_progress', 'implemented', 'monitoring', 'improved', 'no_change', 'declined', 'reverted']);
const MAX_TEXT = 4_000;

function metricValue(metric) {
  const value = Number(metric?.value ?? metric?.metric_value ?? metric?.amount);
  return Number.isFinite(value) ? value : null;
}

// Result interpretation is intentionally deterministic and modest: it says a
// metric changed after implementation, never that the recommendation caused it.
export function measureRecommendation(recommendation) {
  const baseline = metricValue(recommendation?.baseline_metric);
  const current = metricValue(recommendation?.current_metric);
  const direction = String(recommendation?.target_metric?.improvement_direction ?? recommendation?.baseline_metric?.improvement_direction ?? '').toLowerCase();
  if (baseline == null || current == null) return { available: false, baseline_value: baseline, current_value: current, absolute_change: null, percentage_change: null, result: 'insufficient_metric_data' };
  const absoluteChange = current - baseline;
  const percentageChange = baseline === 0 ? null : (absoluteChange / Math.abs(baseline)) * 100;
  const favorable = direction === 'lower_is_better' ? absoluteChange < 0 : direction === 'higher_is_better' ? absoluteChange > 0 : null;
  return {
    available: true,
    baseline_value: baseline,
    current_value: current,
    absolute_change: Number(absoluteChange.toFixed(4)),
    percentage_change: percentageChange == null ? null : Number(percentageChange.toFixed(4)),
    result: favorable === true ? 'improved_after_implementation' : favorable === false ? 'no_improvement_after_implementation' : 'metric_changed_direction_not_specified',
    interpretation: 'This comparison describes a change after implementation and does not establish causation.',
  };
}

function withMeasurement(row) {
  return row ? { ...row, measurement: measureRecommendation(row) } : row;
}

function cleanText(value, field, { required = false, max = MAX_TEXT } = {}) {
  const text = String(value ?? '').trim();
  if (required && !text) {
    const error = new Error(`${field} is required.`); error.status = 400; error.code = 'INVALID_RECOMMENDATION'; throw error;
  }
  if (text.length > max) {
    const error = new Error(`${field} is too long.`); error.status = 400; error.code = 'INVALID_RECOMMENDATION'; throw error;
  }
  return text || null;
}

function cleanDate(value, field) {
  if (value == null || value === '') return null;
  const date = String(value);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    const error = new Error(`${field} must be a YYYY-MM-DD date.`); error.status = 400; error.code = 'INVALID_RECOMMENDATION'; throw error;
  }
  return date;
}

function cleanJson(value, fallback, field) {
  if (value == null) return fallback;
  if (typeof value !== 'object' || Array.isArray(value) !== Array.isArray(fallback)) {
    const error = new Error(`${field} has an invalid shape.`); error.status = 400; error.code = 'INVALID_RECOMMENDATION'; throw error;
  }
  return value;
}

function cleanNumber(value, field) {
  if (value == null || value === '') return null;
  const number = Number(value);
  if (!Number.isFinite(number)) {
    const error = new Error(`${field} must be a number.`); error.status = 400; error.code = 'INVALID_RECOMMENDATION'; throw error;
  }
  return number;
}

function storageError(error) {
  const databaseCode = String(error?.meta?.code ?? '');
  const databaseMessage = String(error?.meta?.message ?? error?.message ?? '');
  const missingStorage = ['42P01', '42703'].includes(databaseCode)
    || /(?:relation|column).*advisor_recommendations.*does not exist/i.test(databaseMessage);
  if (missingStorage) {
    const wrapped = new Error('The Advisor database migration has not been applied.');
    wrapped.status = 503; wrapped.code = 'ADVISOR_STORAGE_NOT_READY'; return wrapped;
  }
  return error;
}

export async function listRecommendations(tenantId, clinicIds, status = '') {
  try {
    const requestedStatus = String(status).trim().toLowerCase();
    if (requestedStatus && !STATUSES.has(requestedStatus)) {
      const error = new Error('Invalid recommendation status.'); error.status = 400; error.code = 'INVALID_RECOMMENDATION_STATUS'; throw error;
    }
    const rows = await prisma.$queryRawUnsafe(`
      SELECT id, clinic_id, category, title, problem_identified, evidence,
        baseline_metric, baseline_start_date, baseline_end_date,
        recommended_action, target_metric, target_improvement,
        implementation_status, implementation_date, review_date,
        current_metric, percentage_change, estimated_financial_impact,
        result_status, sources, created_at, updated_at
      FROM advisor_recommendations
      WHERE tenant_id=$1 AND clinic_id=ANY($2::text[])
        AND ($3='' OR implementation_status=$3)
      ORDER BY CASE WHEN implementation_status IN ('implemented','monitoring') THEN 0 ELSE 1 END,
        review_date ASC NULLS LAST, created_at DESC
      LIMIT 200`, tenantId, clinicIds, requestedStatus);
    return rows.map(withMeasurement);
  } catch (error) { throw storageError(error); }
}

export async function createRecommendation({ tenantId, clinicId, body, sources = [] }) {
  const baselineStart = cleanDate(body?.baseline_start_date, 'baseline_start_date');
  const baselineEnd = cleanDate(body?.baseline_end_date, 'baseline_end_date');
  if (baselineStart && baselineEnd && baselineStart > baselineEnd) {
    const error = new Error('baseline_start_date must not be after baseline_end_date.'); error.status = 400; error.code = 'INVALID_RECOMMENDATION'; throw error;
  }
  const status = String(body?.implementation_status ?? 'suggested').trim().toLowerCase();
  if (!STATUSES.has(status)) {
    const error = new Error('Invalid implementation_status.'); error.status = 400; error.code = 'INVALID_RECOMMENDATION_STATUS'; throw error;
  }
  const values = {
    id: crypto.randomUUID(),
    category: cleanText(body?.category, 'category', { required: true, max: 100 }),
    title: cleanText(body?.title, 'title', { required: true, max: 180 }),
    problem: cleanText(body?.problem_identified, 'problem_identified', { required: true }),
    evidence: cleanJson(body?.evidence, [], 'evidence'),
    baselineMetric: cleanJson(body?.baseline_metric, {}, 'baseline_metric'),
    action: cleanText(body?.recommended_action, 'recommended_action', { required: true }),
    targetMetric: cleanJson(body?.target_metric, {}, 'target_metric'),
    targetImprovement: cleanText(body?.target_improvement, 'target_improvement'),
    implementationDate: cleanDate(body?.implementation_date, 'implementation_date'),
    reviewDate: cleanDate(body?.review_date, 'review_date'),
    currentMetric: cleanJson(body?.current_metric, {}, 'current_metric'),
    percentageChange: cleanNumber(body?.percentage_change, 'percentage_change'),
    financialImpact: cleanJson(body?.estimated_financial_impact, {}, 'estimated_financial_impact'),
    resultStatus: cleanText(body?.result_status, 'result_status', { max: 100 }),
    sources: cleanJson(sources, [], 'sources'),
  };
  try {
    const rows = await prisma.$queryRawUnsafe(`
      INSERT INTO advisor_recommendations
        (id, tenant_id, clinic_id, category, title, problem_identified, evidence,
         baseline_metric, baseline_start_date, baseline_end_date, recommended_action,
         target_metric, target_improvement, implementation_status, implementation_date,
         review_date, current_metric, percentage_change, estimated_financial_impact,
         result_status, sources)
      VALUES ($1::uuid,$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb,$9::date,$10::date,$11,$12::jsonb,$13,$14,$15::date,$16::date,$17::jsonb,$18,$19::jsonb,$20,$21::jsonb)
      RETURNING *`, values.id, tenantId, clinicId, values.category, values.title, values.problem,
      JSON.stringify(values.evidence), JSON.stringify(values.baselineMetric), baselineStart, baselineEnd,
      values.action, JSON.stringify(values.targetMetric), values.targetImprovement, status,
      values.implementationDate, values.reviewDate, JSON.stringify(values.currentMetric),
      values.percentageChange, JSON.stringify(values.financialImpact), values.resultStatus,
      JSON.stringify(values.sources));
    return withMeasurement(rows[0]);
  } catch (error) { throw storageError(error); }
}

export async function updateRecommendation({ tenantId, clinicIds, id, body }) {
  const status = body?.implementation_status == null ? null : String(body.implementation_status).trim().toLowerCase();
  if (status && !STATUSES.has(status)) {
    const error = new Error('Invalid implementation_status.'); error.status = 400; error.code = 'INVALID_RECOMMENDATION_STATUS'; throw error;
  }
  const rows = await prisma.$queryRawUnsafe(`
    UPDATE advisor_recommendations SET
      implementation_status=COALESCE($4, implementation_status),
      implementation_date=CASE WHEN $5::boolean THEN $6::date ELSE implementation_date END,
      review_date=CASE WHEN $7::boolean THEN $8::date ELSE review_date END,
      current_metric=CASE WHEN $9::boolean THEN $10::jsonb ELSE current_metric END,
      percentage_change=CASE WHEN $11::boolean THEN $12 ELSE percentage_change END,
      estimated_financial_impact=CASE WHEN $13::boolean THEN $14::jsonb ELSE estimated_financial_impact END,
      result_status=CASE WHEN $15::boolean THEN $16 ELSE result_status END,
      updated_at=NOW()
    WHERE id=$1::uuid AND tenant_id=$2 AND clinic_id=ANY($3::text[])
    RETURNING *`, id, tenantId, clinicIds, status,
    Object.hasOwn(body ?? {}, 'implementation_date'), cleanDate(body?.implementation_date, 'implementation_date'),
    Object.hasOwn(body ?? {}, 'review_date'), cleanDate(body?.review_date, 'review_date'),
    Object.hasOwn(body ?? {}, 'current_metric'), JSON.stringify(cleanJson(body?.current_metric, {}, 'current_metric')),
    Object.hasOwn(body ?? {}, 'percentage_change'), cleanNumber(body?.percentage_change, 'percentage_change'),
    Object.hasOwn(body ?? {}, 'estimated_financial_impact'), JSON.stringify(cleanJson(body?.estimated_financial_impact, {}, 'estimated_financial_impact')),
    Object.hasOwn(body ?? {}, 'result_status'), cleanText(body?.result_status, 'result_status', { max: 100 }));
  return withMeasurement(rows[0] ?? null);
}

export { STATUSES as RECOMMENDATION_STATUSES };

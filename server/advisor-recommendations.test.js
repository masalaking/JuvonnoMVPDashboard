import test from 'node:test';
import assert from 'node:assert/strict';
import { createRecommendation, measureRecommendation } from './advisor-recommendations.js';
import { prisma } from './db.js';

test('recommendation measurement calculates after-implementation improvement without causation', () => {
  const result = measureRecommendation({ baseline_metric: { value: 10.8 }, current_metric: { value: 7.2 }, target_metric: { improvement_direction: 'lower_is_better' } });
  assert.deepEqual(result, { available: true, baseline_value: 10.8, current_value: 7.2, absolute_change: -3.6, percentage_change: -33.3333, result: 'improved_after_implementation', interpretation: 'This comparison describes a change after implementation and does not establish causation.' });
});

test('recommendation measurement leaves unavailable metrics uncalculated', () => {
  assert.deepEqual(measureRecommendation({ baseline_metric: { value: 4 }, current_metric: {} }), { available: false, baseline_value: 4, current_value: null, absolute_change: null, percentage_change: null, result: 'insufficient_metric_data' });
});

test('recommendation insert binds exactly one correctly typed parameter per column', async t => {
  const original = prisma.$queryRawUnsafe;
  let captured;
  prisma.$queryRawUnsafe = async (sql, ...parameters) => {
    captured = { sql, parameters };
    return [{ id: parameters[0], baseline_metric: { value: 10 }, current_metric: {} }];
  };
  t.after(() => { prisma.$queryRawUnsafe = original; });

  await createRecommendation({
    tenantId: 'synthetic_tenant',
    clinicId: 'synthetic_clinic',
    body: {
      category: 'synthetic_qa',
      title: 'SQL binding regression',
      problem_identified: 'Validate placeholder alignment.',
      baseline_metric: { value: 10 },
      baseline_start_date: '2026-01-01',
      baseline_end_date: '2026-01-31',
      recommended_action: 'Keep the SQL binding aligned.',
      target_metric: { value: 8 },
      implementation_date: '2026-02-01',
      review_date: '2026-03-01',
      current_metric: { value: 7 },
      percentage_change: -30,
      estimated_financial_impact: {},
      result_status: 'improved',
    },
    sources: [{ source_name: 'synthetic_qa' }],
  });

  assert.equal(captured.parameters.length, 21);
  assert.doesNotMatch(captured.sql, /\$22/);
  assert.match(captured.sql, /VALUES \(\$1::uuid,/);
  assert.match(captured.sql, /\$15::date,\$16::date,\$17::jsonb,\$18,\$19::jsonb,\$20,\$21::jsonb/);
});

test('recommendation storage only maps missing schema errors to migration-not-ready', async t => {
  const original = prisma.$queryRawUnsafe;
  t.after(() => { prisma.$queryRawUnsafe = original; });
  const body = {
    category: 'synthetic_qa', title: 'Error mapping',
    problem_identified: 'Preserve non-schema database diagnostics.',
    recommended_action: 'Map only actual missing schema errors.',
  };

  const constraintError = Object.assign(new Error('Raw query failed'), { code: 'P2010', meta: { code: '23514', message: 'check constraint failed' } });
  prisma.$queryRawUnsafe = async () => { throw constraintError; };
  await assert.rejects(
    createRecommendation({ tenantId: 't', clinicId: 'c', body }),
    error => error === constraintError,
  );

  prisma.$queryRawUnsafe = async () => {
    throw Object.assign(new Error('Raw query failed'), { code: 'P2010', meta: { code: '42P01', message: 'relation advisor_recommendations does not exist' } });
  };
  await assert.rejects(
    createRecommendation({ tenantId: 't', clinicId: 'c', body }),
    error => error?.code === 'ADVISOR_STORAGE_NOT_READY' && error?.status === 503,
  );
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { buildBillingOverview } from './inbound-overview.js';

test('inbound overview is tenant-bound, deterministic, and does not invent a missing billing month', () => {
  assert.equal(buildBillingOverview(null), null);
  const overview = buildBillingOverview({
    tenant_id: 'tenant-a', client_name: 'Clinic A', billing_month: '2026-09',
    included_minutes: '1000', base_rate: '500', client_rate_per_min: '0.5', overage_rate: '0.7',
    cumulative_minutes: '1050.25', total_calls: '10', total_recordings: '7', total_transcripts: '8',
  });
  assert.equal(overview.tenantId, 'tenant-a');
  assert.equal(overview.overageMinutes, 50.25);
  assert.equal(overview.overageUSD, 35.18);
  assert.equal(overview.monthlyTotal, 535.18);
  assert.equal(overview.avgCallMin, 105);
  assert.equal(overview.billingPct, 100);
  assert.equal(overview.totalRecordings, 7);
});

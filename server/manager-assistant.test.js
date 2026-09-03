import test from 'node:test';
import assert from 'node:assert/strict';
import { buildManagerSummary, answerManagerQuestion } from './manager-assistant.js';

const clinics = [
  { clinicId: 'clinic_a', clinicName: 'Clinic A' },
  { clinicId: 'clinic_b', clinicName: 'Clinic B' },
];

test('builds deterministic multi-clinic totals without patient data', async () => {
  const summary = await buildManagerSummary({
    tenantId: 'tenant_1',
    clinics,
    inboundOverview: async (_tenant, clinic) => ({
      minutesUsed: clinic === 'clinic_a' ? 100 : 20,
      minutesIncluded: 500,
      totalCalls: clinic === 'clinic_a' ? 25 : 5,
      overageUSD: 0,
      billingPeriod: '2026-08',
    }),
    outboundOverview: async (_tenant, clinic) => ({
      minutesUsed: clinic === 'clinic_a' ? 10 : 5,
      minutesIncluded: 100,
      totalCalls: clinic === 'clinic_a' ? 4 : 2,
      overageUSD: clinic === 'clinic_a' ? 7.5 : 0,
      billingPeriod: '2026-08',
    }),
  });
  assert.equal(summary.totals.totalCalls, 36);
  assert.equal(summary.totals.totalMinutesUsed, 135);
  assert.equal(summary.highlights.busiestClinic.clinicName, 'Clinic A');
  assert.equal(summary.capabilities.clinicRevenue, false);
});

test('keeps a failed clinic visible and distinct from zero activity', async () => {
  const summary = await buildManagerSummary({
    tenantId: 'tenant_1',
    clinics,
    inboundOverview: async (_tenant, clinic) => {
      if (clinic === 'clinic_b') throw new Error('down');
      return { minutesUsed: 0, minutesIncluded: 100, totalCalls: 0, overageUSD: 0 };
    },
    outboundOverview: async () => ({ minutesUsed: 0, minutesIncluded: 100, totalCalls: 0, overageUSD: 0 }),
  });
  assert.equal(summary.clinics[0].ok, true);
  assert.equal(summary.clinics[0].totalCalls, 0);
  assert.equal(summary.clinics[1].ok, false);
  assert.equal(summary.clinics[1].totalCalls, null);
});

test('demo fallback refuses to invent revenue leakage', async () => {
  const summary = await buildManagerSummary({
    tenantId: 'tenant_1',
    clinics,
    inboundOverview: async () => ({ minutesUsed: 10, minutesIncluded: 100, totalCalls: 2, overageUSD: 0 }),
    outboundOverview: async () => ({ minutesUsed: 5, minutesIncluded: 50, totalCalls: 1, overageUSD: 0 }),
  });
  const result = await answerManagerQuestion({ question: 'Where are my revenue leaks?', summary, apiKey: '', model: '' });
  assert.equal(result.mode, 'deterministic_demo');
  assert.match(result.answer, /invoice snapshots are not available/i);
});

test('merges de-identified Juvonno business snapshots without patient fields', async () => {
  const summary = await buildManagerSummary({
    tenantId: 'tenant_1',
    clinics,
    inboundOverview: async () => ({ minutesUsed: 10, minutesIncluded: 100, totalCalls: 2, overageUSD: 0 }),
    outboundOverview: async () => ({ minutesUsed: 5, minutesIncluded: 50, totalCalls: 1, overageUSD: 0 }),
    businessOverview: async (_tenant, clinic) => ({
      success: true,
      snapshot: {
        period_start: '2026-08-01',
        period_end: '2026-08-30',
        appointments: { total: clinic === 'clinic_a' ? 20 : 10, cancelled: clinic === 'clinic_a' ? 4 : 1, cancellation_rate_pct: clinic === 'clinic_a' ? 20 : 10 },
        invoices: { period_count: 2, period_invoiced_usd: 1000, paid_portion_usd: 800, outstanding_usd: 200, outstanding_count: 1 },
        commissions: { total_usd: 150, payable_usd: 50, paid_usd: 100 },
      },
    }),
  });
  assert.equal(summary.totals.appointments, 30);
  assert.equal(summary.totals.cancellations, 5);
  assert.equal(summary.totals.periodInvoicedUSD, 2000);
  assert.equal(summary.totals.outstandingUSD, 400);
  assert.equal(summary.capabilities.invoiceEconomics, true);
  assert.equal(JSON.stringify(summary).includes('patient'), false);
});

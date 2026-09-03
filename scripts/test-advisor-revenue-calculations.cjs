const assert = require('assert/strict');
const fs = require('fs');

// Exercise the deployed read-only n8n formatter with synthetic, non-production
// appointments. This keeps business arithmetic deterministic without writing
// fixture records to the clinic database.
const workflowPath = 'C:/Users/aarya/Documents/Codex/2026-08-06/i-o/outputs/RivaCare AI Clinic Advisor Production 2026-08-27/RivaCare Manager Analyst Tools - RAG PRACTITIONER REVENUE AND LEAKS.json';
const workflow = JSON.parse(fs.readFileSync(workflowPath, 'utf8'));
const code = workflow.nodes.find(node => node.name === 'Format Grounded Advisor Result')?.parameters?.jsCode;
assert.ok(code, 'Format Grounded Advisor Result is required');
const format = new Function('$input', '$', code);

const appointments = [
  { id: 'paid', status: 'completed', date: { start: '2026-08-05T10:00:00-04:00' } },
  { id: 'unbilled', status: 'completed', date: { start: '2026-08-06T10:00:00-04:00' } },
  { id: 'no_invoice', status: 'completed', date: { start: '2026-08-06T11:00:00-04:00' } },
  { id: 'no_show_a', status: 'no-show', date: { start: '2026-08-07T10:00:00-04:00' } },
  { id: 'no_show_b', status: 'no show', date: { start: '2026-08-08T10:00:00-04:00' } },
  { id: 'cancelled', status: 'cancelled', date: { start: '2026-08-09T10:00:00-04:00' } },
  { id: 'canceled', status: 'canceled', date: { start: '2026-08-10T10:00:00-04:00' } },
  { id: 'late_cancel', status: 'late cancellation', date: { start: '2026-08-11T10:00:00-04:00' } },
  { id: 'rescheduled', status: 'rescheduled', date: { start: '2026-08-12T10:00:00-04:00' } },
];
const invoices = [
  { id: 'linked', date: '2026-08-05', status: 'receivable', amount: 150, owing: 50, appointment: { id: 'paid' } },
  { id: 'unassigned', date: '2026-08-01', status: 'receivable', amount: 500, owing: 500, appointment: null },
  { id: 'void', date: '2026-08-06', status: 'void', amount: 200, owing: 200, appointment: { id: 'unbilled' } },
];

const context = {
  has_access: true,
  action: 'advisor.revenue_leaks',
  start_date: '2026-08-01',
  end_date: '2026-08-31',
  database_metrics: [],
  transcript_details: [],
  juvonno_configs: [{ clinic_id: 'synthetic_clinic', clinic_name: 'Synthetic clinic' }],
};
const item = (request_kind, provider_response) => ({ json: { request: { clinic_id: 'synthetic_clinic', clinic_name: 'Synthetic clinic', configured: true, request_kind }, provider_response } });
const output = format({ all: () => [item('appointments_list', appointments), item('invoices_list', invoices)] }, name => {
  assert.equal(name, 'Resolve Authorized Scope and Local Records');
  return { first: () => ({ json: context }) };
})[0].json;

const leaks = output.data.juvonno_live[0].revenue_leaks;
assert.equal(leaks.confirmed_open_receivables_amount, 550, 'only source-backed outstanding balances are dollars');
assert.equal(leaks.open_receivable_count, 2);
assert.equal(leaks.completed_without_linked_invoice_count, 1, 'a void invoice remains linked while an appointment with no invoice is surfaced');
assert.equal(leaks.no_show_count, 2, 'both standard no-show status variants count');
assert.equal(leaks.cancellation_count, 2, 'cancelled/canceled count without treating rescheduled as cancelled');
assert.equal(leaks.late_cancellation_count, 1, 'late cancellations remain separately measurable');
assert.equal(leaks.estimated_lost_revenue, null, 'appointment counts are never converted into invented revenue');
assert.match(leaks.interpretation, /not converted to dollars/i);

console.log('advisor revenue calculation regressions: pass');

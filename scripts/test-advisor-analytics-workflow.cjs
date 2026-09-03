const assert = require('assert/strict');
const fs = require('fs');

const workflowPath = 'C:/Users/aarya/Documents/Codex/2026-08-06/i-o/outputs/RivaCare AI Clinic Advisor Production 2026-08-27/RivaCare Manager Analyst Tools - RAG PRACTITIONER REVENUE AND LEAKS.json';
const workflow = JSON.parse(fs.readFileSync(workflowPath, 'utf8'));
const formatCode = workflow.nodes.find(node => node.name === 'Format Grounded Advisor Result')?.parameters?.jsCode;
const normalizeCode = workflow.nodes.find(node => node.name === 'Normalize and Bound Request')?.parameters?.jsCode;
const attachCode = workflow.nodes.find(node => node.name === 'Attach Safe Juvonno Request Metadata')?.parameters?.jsCode;
const prepareCode = workflow.nodes.find(node => node.name === 'Prepare Native Juvonno HTTP Requests')?.parameters?.jsCode;
assert.ok(formatCode && normalizeCode && attachCode && prepareCode, 'Advisor workflow must contain formatter, request normalizer, request preparation, and metadata attachment');
for (const action of ['advisor.capacity_utilization', 'advisor.cancellation_rebooking', 'advisor.no_show_analytics', 'advisor.call_conversion', 'advisor.call_themes', 'advisor.retention', 'advisor.retention_cohorts', 'advisor.appointment_frequency_changes', 'advisor.engagement_risk', 'advisor.engagement_risk_patients', 'advisor.revenue_risk']) assert.match(normalizeCode, new RegExp(`'${action}'`));
const format = new Function('$input', '$', formatCode);

async function main() {
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
const prepare = new AsyncFunction('$input', '$helpers', prepareCode);
const prepareWithN8nContext = new AsyncFunction('$input', prepareCode);
let n8nContextHelperCalled = false;
const n8nContextPrepared = await prepareWithN8nContext.call({ helpers: { httpRequest: async () => {
  n8nContextHelperCalled = true;
  return [];
} } }, { first: () => ({ json: {
  has_access: true,
  action: 'advisor.retention',
  start_date: '2026-08-01',
  end_date: '2026-08-29',
  juvonno_configs: [{ clinic_id: 'clinic_001', clinic_name: 'Clinic 001', base_url: 'https://sandbox.example', branch_code: '001', api_key: 'secret' }],
} }) });
assert.equal(n8nContextHelperCalled, true, 'historical requests use the HTTP helper exposed on the n8n Code-node context');
assert.ok(n8nContextPrepared.length > 0);
const historyHttpCalls = [];
const retentionPrepared = await prepare({ first: () => ({ json: {
  has_access: true,
  action: 'advisor.retention_cohorts',
  start_date: '2026-03-01',
  end_date: '2026-08-29',
  juvonno_configs: [{ clinic_id: 'clinic_001', clinic_name: 'Clinic 001', base_url: 'https://sandbox.example', branch_code: '001', api_key: 'secret' }],
} }) }, { httpRequest: async options => {
  historyHttpCalls.push(options);
  const url = new URL(options.url);
  const windowStart = url.searchParams.get('start_date');
  if (windowStart === '2000-01-01') return [
    { id: 'window_one', status: 'completed', customer: { id: 'patient_history' }, date: { start: '2000-01-01T10:00:00Z' }, duration: 30 },
    { id: 'overlap_boundary', status: 'completed', customer: { id: 'patient_history' }, date: { start: '2001-12-31T10:00:00Z' }, duration: 30 },
  ];
  if (windowStart === '2001-12-31') return [
    { id: 'overlap_boundary', status: 'completed', customer: { id: 'patient_history' }, date: { start: '2001-12-31T10:00:00Z' }, duration: 30 },
    { id: 'window_two', status: 'completed', customer: { id: 'patient_history' }, date: { start: '2002-01-01T10:00:00Z' }, duration: 30 },
  ];
  return [];
} });
const retentionRequest = retentionPrepared[0].json.request;
assert.match(historyHttpCalls[0].url, /start_date=2000-01-01/);
assert.equal(retentionRequest.appointment_analysis_start_date, '2026-03-01');
assert.equal(retentionRequest.appointment_fetch_end_date, '2026-08-29');
assert.equal(retentionRequest.historical_context_start, '2000-01-01');
assert.equal(retentionRequest.history_global_request_limit, 300);
assert.equal(retentionRequest.history_global_record_limit, 25000);
assert.equal(retentionPrepared.length, 14, 'complete historical context uses one short page in each bounded 24-month window');
assert.equal(historyHttpCalls.length, 14, 'adaptive pagination stops each empty or short window immediately');
assert.equal(retentionPrepared[1].json.request.appointment_window_start_date, retentionPrepared[0].json.request.appointment_window_end_date, 'adjacent history windows overlap by one boundary day');
assert.equal(JSON.stringify(retentionPrepared).includes('secret'), false, 'historical request output must not expose the Juvonno API key');

const retentionContext = { has_access: true, action: 'advisor.retention_cohorts', start_date: '2026-03-01', end_date: '2026-08-29', database_metrics: [], transcript_details: [], call_records: [], juvonno_configs: [{ clinic_id: 'clinic_001', clinic_name: 'Clinic 001' }] };
const partitioned = format({ all: () => retentionPrepared }, name => { assert.equal(name, 'Resolve Authorized Scope and Local Records'); return { first: () => ({ json: retentionContext }) }; })[0].json.data.juvonno_live[0];
assert.equal(partitioned.appointment_source.fetch_status, 'complete');
assert.equal(partitioned.appointment_source.partition_strategy, 'overlapping_time_windows');
assert.equal(partitioned.appointment_source.windows_complete, 14);
assert.equal(partitioned.appointment_source.duplicate_records_removed, 1, 'appointment IDs are deduplicated across overlapping windows');
assert.equal(partitioned.appointment_count, 3);

const attach = new Function('$input', '$', attachCode);
const preparedRequests = [
  { json: { request_kind: 'appointments_list', clinic_id: 'clinic_001', api_key: 'must-not-leak' } },
  { json: { request_kind: 'availability_list', clinic_id: 'clinic_001', availability_day: '2026-08-03', api_key: 'must-not-leak' } },
];
const attached = attach(
  { all: () => [{ json: { list: [{ id: 'appointment' }] } }, { json: { list: [{ staff: { num: 'qa' } }] } }] },
  name => { assert.equal(name, 'Prepare Native Juvonno HTTP Requests'); return { all: () => preparedRequests }; },
);
assert.equal(attached.length, 2, 'metadata attachment must preserve every HTTP response item');
assert.deepEqual(attached.map(item => item.json.request.request_kind), ['appointments_list', 'availability_list']);
assert.equal(attached[0].json.request.api_key, undefined, 'API keys must be removed from attached metadata');
assert.equal(attached[1].json.provider_response.list[0].staff.num, 'qa');

const appointments = [
  { id: 'a1', status: 'cancelled', patient_id: 'p1', amount: 120, date: { start: '2026-08-01T10:00:00Z' }, duration: 30 },
  { id: 'a2', status: 'booked', patient_id: 'p1', date: { start: '2026-08-04T10:00:00Z' }, duration: 30 },
  { id: 'a3', status: 'canceled', patient_id: 'p2', amount: 80, date: { start: '2026-08-02T10:00:00Z' }, duration: 30 },
  { id: 'a4', status: 'no-show', patient_id: 'p3', amount: 60, date: { start: '2026-08-03T10:00:00Z' }, duration: 30 },
  { id: 'a5', status: 'completed', patient_id: 'p3', date: { start: '2026-08-10T10:00:00Z' }, duration: 30 },
  { id: 'a6', status: 'completed', patient_id: 'p3', date: { start: '2026-08-24T10:00:00Z' }, duration: 30 },
];

function run(action, call_records = []) {
  const context = { has_access: true, action, start_date: '2026-08-01', end_date: '2026-08-31', database_metrics: [], transcript_details: [], call_records, juvonno_configs: [{ clinic_id: 'clinic_001', clinic_name: 'Clinic 001' }] };
  const request = (request_kind, provider_response) => ({ json: { request: { clinic_id: 'clinic_001', clinic_name: 'Clinic 001', configured: true, request_kind }, provider_response } });
  const items = [request('appointments_list', appointments), request('invoices_list', [])];
  return format({ all: () => items }, name => { assert.equal(name, 'Resolve Authorized Scope and Local Records'); return { first: () => ({ json: context }) }; })[0].json;
}

const cancellation = run('advisor.cancellation_rebooking').data.juvonno_live[0].cancellation_rebooking;
assert.equal(cancellation.cancellation_count, 2);
assert.equal(cancellation.cancellations_rebooked, 1);
assert.equal(cancellation.cancellations_not_rebooked, 1);
assert.equal(cancellation.recoverable_revenue, 80);

const noShows = run('advisor.no_show_analytics').data.juvonno_live[0].no_show_analytics;
assert.equal(noShows.no_show_count, 1);
assert.equal(noShows.scheduled_count, 3);
assert.equal(noShows.no_show_rate, 33.3333);

const capacity = run('advisor.capacity_utilization').data.juvonno_live[0].capacity_utilization;
assert.equal(capacity.availability_data_available, false);
assert.equal(capacity.utilization_rate, null);

const capacityContext = { has_access: true, action: 'advisor.capacity_utilization', start_date: '2026-08-03', end_date: '2026-08-03', database_metrics: [], transcript_details: [], call_records: [], juvonno_configs: [{ clinic_id: 'clinic_001', clinic_name: 'Clinic 001' }] };
const capacityItems = [
  { json: { request: { clinic_id: 'clinic_001', clinic_name: 'Clinic 001', configured: true, request_kind: 'appointments_list', appointment_page_index: 0, appointment_page_size: 100, appointment_max_pages: 20 }, provider_response: [{ id: 'booked_capacity', status: 'booked', patient_id: 'capacity_patient', date: { start: '2026-08-03T09:00:00Z' }, duration: 60, schedule_type: 'Physio', attendants: [{ id: 'practitioner_a' }] }] } },
  { json: { request: { clinic_id: 'clinic_001', clinic_name: 'Clinic 001', configured: true, request_kind: 'availability_list', availability_day: '2026-08-03', availability_day_index: 0, availability_days_requested: 1, availability_requested_range_days: 1, availability_max_days: 31, availability_max_results: 100 }, provider_response: { list: [{ staff: { num: 'practitioner_a', first_name: 'QA', last_name: 'Practitioner' }, slots: { '2026-08-03': [
    { available: true, time: { time: '10:00', meridiem: 'AM' }, schedule_type: { id: 1, name: 'Physio' } },
    { available: true, time: { time: '10:30', meridiem: 'AM' }, schedule_type: { id: 1, name: 'Physio' } },
    { available: false, time: { time: '11:00', meridiem: 'AM' }, schedule_type: { id: 1, name: 'Physio' } },
  ] } }] } } },
  { json: { request: { clinic_id: 'clinic_001', clinic_name: 'Clinic 001', configured: true, request_kind: 'invoices_list' }, provider_response: [] } },
];
const liveCapacity = format({ all: () => capacityItems }, name => { assert.equal(name, 'Resolve Authorized Scope and Local Records'); return { first: () => ({ json: capacityContext }) }; })[0].json.data.juvonno_live[0];
assert.equal(liveCapacity.availability_source.source_name, 'Juvonno appointment availability API');
assert.equal(liveCapacity.availability_source.complete, true);
assert.equal(liveCapacity.capacity_utilization.total_available_minutes, 120);
assert.equal(liveCapacity.capacity_utilization.total_booked_minutes, 60);
assert.equal(liveCapacity.capacity_utilization.total_unused_minutes, 60);
assert.equal(liveCapacity.capacity_utilization.utilization_rate, 50);
assert.equal(liveCapacity.capacity_utilization.estimated_revenue_opportunity, null);

const frequency = run('advisor.appointment_frequency_changes').data.juvonno_live[0].appointment_frequency_changes;
assert.equal(frequency.evaluated_patient_count, 0);
assert.equal(frequency.insufficient_history_patient_count, 1);
assert.match(frequency.data_quality[0], /At least three completed appointments/);

const calls = [{ clinic_id: 'clinic_001', retell_call_id: 'c1', summary: 'The price is too expensive, I will think about it.', call_status: 'completed' }, { clinic_id: 'clinic_001', retell_call_id: 'c2', summary: 'Appointment booked.', call_status: 'completed' }];
const callAnalytics = run('advisor.call_conversion', calls).data.call_analytics;
assert.equal(callAnalytics.funnel.find(stage => stage.stage === 'appointment_created').count, 1);
assert.equal(callAnalytics.theme_counts.find(theme => theme.key === 'price').count, 1);

const paginationContext = { has_access: true, action: 'advisor.retention', start_date: '2026-02-01', end_date: '2026-08-31', database_metrics: [], transcript_details: [], call_records: [], juvonno_configs: [{ clinic_id: 'clinic_001', clinic_name: 'Clinic 001' }] };
const paginatedRequest = (page, provider_response) => ({ json: { request: { clinic_id: 'clinic_001', clinic_name: 'Clinic 001', configured: true, request_kind: 'appointments_list', appointment_page_index: page, appointment_page_size: 2, appointment_max_pages: 3 }, provider_response } });
const paginated = format({ all: () => [
  paginatedRequest(0, [
    { id: 'page_a', status: 'completed', patient_id: 'patient_a', date: { start: '2026-02-01T10:00:00Z' }, duration: 30 },
    { id: 'duplicate', status: 'completed', patient_id: 'patient_a', date: { start: '2026-03-01T10:00:00Z' }, duration: 30 },
  ]),
  paginatedRequest(1, { error: 'synthetic intermediate page failure' }),
  paginatedRequest(2, [
    { id: 'duplicate', status: 'completed', patient_id: 'patient_a', date: { start: '2026-03-01T10:00:00Z' }, duration: 30 },
    { id: 'page_b', status: 'completed', patient_id: 'patient_a', date: { start: '2026-04-01T10:00:00Z' }, duration: 30 },
  ]),
] }, name => { assert.equal(name, 'Resolve Authorized Scope and Local Records'); return { first: () => ({ json: paginationContext }) }; })[0].json;
const paginatedLive = paginated.data.juvonno_live[0];
assert.equal(paginatedLive.appointment_count, 3, 'appointment IDs are deduplicated across pages');
assert.equal(paginatedLive.appointment_source.fetch_status, 'partial_failed_page');
assert.equal(paginatedLive.appointment_source.duplicate_records_removed, 1);
assert.equal(paginatedLive.retention.appointment_data_complete, false);
assert.match(paginatedLive.retention.data_quality.at(-1), /must not be presented as complete/i);

let failedWindowCalls = 0;
const failedWindowPrepared = await prepare({ first: () => ({ json: {
  has_access: true,
  action: 'advisor.retention',
  start_date: '2026-02-01',
  end_date: '2026-08-29',
  juvonno_configs: [{ clinic_id: 'clinic_001', clinic_name: 'Clinic 001', base_url: 'https://sandbox.example', branch_code: '001', api_key: 'secret' }],
} }) }, { httpRequest: async options => {
  failedWindowCalls++;
  if (options.url.includes('start_date=2003-12-31')) throw Object.assign(new Error('synthetic failure'), { statusCode: 503 });
  return [];
} });
const failedWindow = format({ all: () => failedWindowPrepared }, name => { assert.equal(name, 'Resolve Authorized Scope and Local Records'); return { first: () => ({ json: paginationContext }) }; })[0].json.data.juvonno_live[0];
assert.equal(failedWindow.appointment_source.fetch_status, 'partial_failed_window');
assert.equal(failedWindow.appointment_source.windows_failed, 1);
assert.equal(failedWindow.retention.appointment_data_complete, false);
assert.ok(failedWindowCalls > 1, 'a failed historical window does not discard other bounded windows');

let requestCeilingCalls = 0;
const requestCeilingPrepared = await prepare({ first: () => ({ json: {
  has_access: true,
  action: 'advisor.retention',
  start_date: '2999-01-01',
  end_date: '2999-12-31',
  juvonno_configs: [{ clinic_id: 'clinic_001', clinic_name: 'Clinic 001', base_url: 'https://sandbox.example', branch_code: '001', api_key: 'secret' }],
} }) }, { httpRequest: async () => { requestCeilingCalls++; return []; } });
assert.equal(requestCeilingCalls, 300, 'historical fetching cannot exceed the execution-wide request ceiling');
assert.equal(requestCeilingPrepared[0].json.request.history_global_request_limit_reached, true);
const requestCeilingContext = { ...paginationContext, start_date: '2999-01-01', end_date: '2999-12-31' };
const requestCeiling = format({ all: () => requestCeilingPrepared }, name => { assert.equal(name, 'Resolve Authorized Scope and Local Records'); return { first: () => ({ json: requestCeilingContext }) }; })[0].json.data.juvonno_live[0];
assert.equal(requestCeiling.appointment_source.fetch_status, 'partial_global_request_limit');
assert.equal(requestCeiling.retention.appointment_data_complete, false);

let recordCeilingCalls = 0;
const fullPage = Array.from({ length: 100 }, (_, index) => ({ id: `record_${index}`, status: 'completed', customer: { id: 'patient_record_limit' }, date: { start: '2000-01-01T10:00:00Z' }, duration: 30 }));
const recordCeilingPrepared = await prepare({ first: () => ({ json: {
  has_access: true,
  action: 'advisor.retention',
  start_date: '2026-02-01',
  end_date: '2026-08-29',
  juvonno_configs: [{ clinic_id: 'clinic_001', clinic_name: 'Clinic 001', base_url: 'https://sandbox.example', branch_code: '001', api_key: 'secret' }],
} }) }, { httpRequest: async () => { recordCeilingCalls++; return fullPage; } });
assert.equal(recordCeilingCalls, 250, 'historical fetching stops as soon as the global accepted-record ceiling is reached');
assert.equal(recordCeilingPrepared[0].json.request.history_global_record_limit_reached, true);
const recordCeiling = format({ all: () => recordCeilingPrepared }, name => { assert.equal(name, 'Resolve Authorized Scope and Local Records'); return { first: () => ({ json: paginationContext }) }; })[0].json.data.juvonno_live[0];
assert.equal(recordCeiling.appointment_source.fetch_status, 'partial_global_record_limit');
assert.equal(recordCeiling.retention.appointment_data_complete, false);

console.log('advisor expanded analytics workflow tests: pass');
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});

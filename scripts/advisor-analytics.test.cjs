const test = require('node:test');
const assert = require('node:assert/strict');
const { calculateAdvisorAnalytics } = require('./advisor-analytics.cjs');

const appointment = (id, status, patientId, start, extra = {}) => ({ id, status, patient_id: patientId, date: { start }, duration: 30, ...extra });

test('cancellation recovery distinguishes rebooking, rescheduling, and no-shows', () => {
  const appointments = [
    appointment('cancel_rebook', 'cancelled', 'a', '2026-08-01T10:00:00Z', { amount: 100, service: 'Physio' }),
    appointment('rebook', 'booked', 'a', '2026-08-08T10:00:00Z'),
    appointment('cancel_lost', 'canceled', 'b', '2026-08-02T10:00:00Z', { amount: 125, service: 'Massage' }),
    appointment('rescheduled', 'rescheduled', 'c', '2026-08-03T10:00:00Z'),
    appointment('no_show', 'no-show', 'd', '2026-08-04T10:00:00Z', { amount: 75 }),
  ];
  const analytics = calculateAdvisorAnalytics({ appointments, startDate: '2026-08-01', endDate: '2026-08-31' });
  const cancellation = analytics.cancellation_rebooking;
  assert.equal(cancellation.cancellation_count, 2);
  assert.equal(cancellation.cancellations_rebooked, 1);
  assert.equal(cancellation.cancellations_not_rebooked, 1);
  assert.equal(cancellation.non_rebooking_rate, 50);
  assert.equal(cancellation.recoverable_revenue, 125);
  assert.equal(analytics.revenue_risk.confirmed_lost_revenue.amount, 75);
  assert.equal(analytics.revenue_risk.recoverable_revenue.amount, 125);
  assert.equal(analytics.revenue_risk.revenue_at_risk.amount, null);
});

test('no-show, retention, and engagement metrics keep zero denominators and missing capacity explicit', () => {
  const appointments = [
    appointment('p1-1', 'completed', 'p1', '2026-06-01T10:00:00Z', { service: 'Physio', attendants: [{ id: 'practitioner_a' }], created_at: '2026-05-30T10:00:00Z' }),
    appointment('p1-2', 'completed', 'p1', '2026-06-15T10:00:00Z', { service: 'Physio', attendants: [{ id: 'practitioner_a' }], created_at: '2026-06-01T10:00:00Z' }),
    appointment('p1-3', 'completed', 'p1', '2026-07-15T10:00:00Z', { service: 'Physio', attendants: [{ id: 'practitioner_a' }], created_at: '2026-06-01T10:00:00Z' }),
    appointment('p2-1', 'no show', 'p2', '2026-07-16T10:00:00Z', { service: 'Massage', attendants: [{ id: 'practitioner_b' }], created_at: '2026-07-15T10:00:00Z' }),
    appointment('p2-2', 'completed', 'p2', '2026-07-17T10:00:00Z', { service: 'Massage', attendants: [{ id: 'practitioner_b' }], created_at: '2026-07-15T10:00:00Z' }),
  ];
  const analytics = calculateAdvisorAnalytics({ appointments, startDate: '2026-06-01', endDate: '2026-08-31' });
  assert.equal(analytics.no_show_analytics.no_show_count, 1);
  assert.equal(analytics.no_show_analytics.scheduled_count, 5);
  assert.equal(analytics.no_show_analytics.no_show_rate, 20);
  assert.equal(analytics.capacity_utilization.availability_data_available, false);
  assert.equal(analytics.capacity_utilization.utilization_rate, null);
  assert.equal(analytics.retention.returned_for_visit_2_count, 1);
  assert.equal(analytics.retention.returned_for_visit_3_count, 1);
  assert.equal(analytics.engagement_risk.evaluated_patient_count, 1);
  assert.equal(analytics.engagement_risk.risk_counts.high, 1);
  assert.equal('patient_reference' in analytics.engagement_risk.risk_signal_examples[0], false);
});

test('Juvonno customer identifiers support aggregate cohorts without leaking identity', () => {
  const appointments = [
    { id: 1, status: 'completed', customer: { id: 901, num: 'sandbox-patient-901', first_name: 'Must', last_name: 'Not Leak' }, date: { start: '2026-03-01T10:00:00Z' }, duration: 30 },
    { id: 2, status: 'completed', customer: { id: 901, num: 'sandbox-patient-901', first_name: 'Must', last_name: 'Not Leak' }, date: { start: '2026-04-01T10:00:00Z' }, duration: 30 },
    { id: 3, status: 'completed', customer: { id: 901, num: 'sandbox-patient-901', first_name: 'Must', last_name: 'Not Leak' }, date: { start: '2026-05-01T10:00:00Z' }, duration: 30 },
  ];
  const cohort = calculateAdvisorAnalytics({ appointments, startDate: '2026-03-01', endDate: '2026-08-29' }).retention_cohorts;
  assert.equal(cohort.patient_identifier_coverage, 100);
  assert.equal(cohort.new_patient_count, 1);
  assert.equal(cohort.returned_for_visit_2_rate, 100);
  assert.equal(cohort.returned_for_visit_3_rate, 100);
  assert.doesNotMatch(JSON.stringify(cohort), /sandbox-patient-901|Must|Not Leak/);
});

test('explicit engagement-risk drill-down returns only source-backed display names and ranked reasons', () => {
  const appointments = [
    { id:'s1', status:'completed', customer:{id:'authorized-sarah',first_name:'Sarah',last_name:'Smith'}, date:{start:'2026-06-01T10:00:00Z'} },
    { id:'s2', status:'completed', customer:{id:'authorized-sarah',first_name:'Sarah',last_name:'Smith'}, date:{start:'2026-06-15T10:00:00Z'} },
    { id:'s3', status:'completed', customer:{id:'authorized-sarah',first_name:'Sarah',last_name:'Smith'}, date:{start:'2026-07-25T10:00:00Z'} },
    { id:'s4', status:'cancelled', customer:{id:'authorized-sarah',first_name:'Sarah',last_name:'Smith'}, date:{start:'2026-08-10T10:00:00Z'} },
    { id:'f1', status:'completed', customer:{id:'foreign-patient',first_name:'Foreign',last_name:'Patient'}, date:{start:'2026-06-01T10:00:00Z'} },
  ];
  const aggregate = calculateAdvisorAnalytics({appointments,startDate:'2026-06-01',endDate:'2026-08-31'}).engagement_risk;
  assert.doesNotMatch(JSON.stringify(aggregate),/Sarah Smith|authorized-sarah|Foreign Patient|foreign-patient/);
  const drillDown = calculateAdvisorAnalytics({appointments:appointments.filter(item => item.customer?.id !== 'foreign-patient'),startDate:'2026-06-01',endDate:'2026-08-31',includePatientDetails:true}).engagement_risk;
  assert.deepEqual(drillDown.high_risk_patients.map(item => item.patient_name),['Sarah Smith']);
  assert.equal(drillDown.high_risk_patients[0].has_future_booking,false);
  assert.match(drillDown.high_risk_patients[0].risk_reasons.join(','),/recent_cancellation_without_detected_rebooking/);
  assert.doesNotMatch(JSON.stringify(drillDown),/authorized-sarah|foreign-patient|Foreign Patient/);
});

test('capacity provides 100%, 0%, and partial utilization with deterministic breakdowns', () => {
  const full = calculateAdvisorAnalytics({
    appointments: [appointment('full', 'completed', 'p1', '2026-08-03T10:00:00Z', { duration: 60, service: 'Physio', attendants: [{ id: 'practitioner_a' }] })],
    availability: [{ duration: 60, available_slot_count: 1, start: '2026-08-03T10:00:00Z', service: 'Physio', practitioner: { id: 'practitioner_a' } }],
    startDate: '2026-08-01', endDate: '2026-08-31',
  }).capacity_utilization;
  assert.equal(full.utilization_rate, 100);
  assert.equal(full.unused_slot_count, 0);

  const empty = calculateAdvisorAnalytics({
    appointments: [], availability: [{ duration: 30, available_slot_count: 1, start: '2026-08-04T10:00:00Z', service: 'Massage', practitioner: { id: 'practitioner_b' } }],
    startDate: '2026-08-01', endDate: '2026-08-31',
  }).capacity_utilization;
  assert.equal(empty.utilization_rate, 0);
  assert.equal(empty.unused_slot_count, 1);

  const partial = calculateAdvisorAnalytics({
    appointments: [appointment('partial', 'booked', 'p2', '2026-08-05T10:00:00Z', { duration: 30, service: 'Physio', attendants: [{ id: 'practitioner_a' }] })],
    availability: [
      { duration: 60, available_slot_count: 2, start: '2026-08-05T10:00:00Z', service: 'Physio', practitioner: { id: 'practitioner_a' } },
      { duration: 60, available_slot_count: 2, start: '2026-08-05T11:00:00Z', service: 'Massage', practitioner: { id: 'practitioner_b' } },
    ],
    startDate: '2026-08-01', endDate: '2026-08-31',
  }).capacity_utilization;
  assert.equal(partial.utilization_rate, 12.5);
  assert.equal(partial.practitioner_breakdown.find(item => item.key === 'practitioner_a').total_unused_minutes, 90);
  assert.equal(partial.practitioner_breakdown.find(item => item.key === 'practitioner_b').total_unused_minutes, 120);
  assert.equal(partial.service_breakdown.find(item => item.key === 'Physio').utilization_rate, 25);
  assert.equal(partial.estimated_revenue_opportunity, null);
});

test('verified Juvonno unused slots combine with booked appointments into total capacity', () => {
  const capacity = calculateAdvisorAnalytics({
    appointments: [appointment('booked', 'booked', 'p1', '2026-08-03T09:00:00Z', { duration: 60, service: 'Physio', attendants: [{ id: 'practitioner_a' }] })],
    availability: [{ availability_kind: 'unused_slot', duration: 30, available_slot_count: 2, start: '2026-08-03T10:00:00Z', service: 'Physio', practitioner: { id: 'practitioner_a' } }],
    availabilitySource: { verified: true, basis: 'unused_slots', source_name: 'Juvonno appointment availability API', complete: true },
    startDate: '2026-08-03', endDate: '2026-08-03',
  }).capacity_utilization;
  assert.equal(capacity.availability_data_available, true);
  assert.equal(capacity.availability_data_complete, true);
  assert.equal(capacity.total_available_minutes, 120);
  assert.equal(capacity.total_booked_minutes, 60);
  assert.equal(capacity.total_unused_minutes, 60);
  assert.equal(capacity.utilization_rate, 50);
  assert.equal(capacity.available_slot_count, 3);
  assert.equal(capacity.unused_slot_count, 2);
  assert.equal(capacity.estimated_revenue_opportunity, null);
});

test('no-show analytics keeps a zero denominator and unavailable lead-time data explicit', () => {
  const analytics = calculateAdvisorAnalytics({ appointments: [], startDate: '2026-08-01', endDate: '2026-08-31' }).no_show_analytics;
  assert.equal(analytics.scheduled_count, 0);
  assert.equal(analytics.no_show_rate, null);
  assert.equal(analytics.booking_lead_time_available, true);
});

test('frequency changes remain deterministic, de-identified, and explain engagement signals', () => {
  const appointments = [
    appointment('stable-1', 'completed', 'stable', '2026-06-01T10:00:00Z'), appointment('stable-2', 'completed', 'stable', '2026-06-15T10:00:00Z'), appointment('stable-3', 'completed', 'stable', '2026-06-29T10:00:00Z'),
    appointment('increase-1', 'completed', 'increase', '2026-06-01T10:00:00Z'), appointment('increase-2', 'completed', 'increase', '2026-06-08T10:00:00Z'), appointment('increase-3', 'completed', 'increase', '2026-07-08T10:00:00Z'), appointment('increase-cancel', 'cancelled', 'increase', '2026-08-01T10:00:00Z'),
    appointment('decrease-1', 'completed', 'decrease', '2026-06-01T10:00:00Z'), appointment('decrease-2', 'completed', 'decrease', '2026-07-01T10:00:00Z'), appointment('decrease-3', 'completed', 'decrease', '2026-07-15T10:00:00Z'),
    appointment('few-1', 'completed', 'few', '2026-07-01T10:00:00Z'), appointment('few-2', 'completed', 'few', '2026-07-15T10:00:00Z'),
  ];
  const analytics = calculateAdvisorAnalytics({ appointments, startDate: '2026-06-01', endDate: '2026-08-31' });
  const frequency = analytics.appointment_frequency_changes;
  assert.deepEqual(frequency.change_counts, { increasing_interval: 1, stable_interval: 1, decreasing_interval: 1 });
  assert.equal(frequency.insufficient_history_patient_count, 1);
  assert.equal('patient_reference' in frequency.signal_examples[0], false);
  const atRisk = analytics.engagement_risk.risk_signal_examples.find(signal => signal.interval_change_percent > 300);
  assert.equal(atRisk.recent_cancellation_count, 1);
  assert.match(atRisk.reasons.join(','), /recent_cancellation_without_detected_rebooking/);
});

test('call funnel and themes remain structured and leave ambiguous calls unclassified', () => {
  const calls = [
    { retell_call_id: 'booked', summary: 'I have an available appointment at 3 PM. Yes, that works. Appointment booked.', call_status: 'completed' },
    { retell_call_id: 'price', summary: 'The price is too expensive, I will think about it.', call_status: 'completed' },
    { retell_call_id: 'location', transcript_excerpt: 'Parking and location are difficult for me.', call_status: 'completed' },
    { retell_call_id: 'unknown', summary: '', transcript_excerpt: '', call_status: 'completed' },
  ];
  const callAnalytics = calculateAdvisorAnalytics({ calls, startDate: '2026-08-01', endDate: '2026-08-31' }).call_analytics;
  assert.equal(callAnalytics.call_count, 4);
  assert.equal(callAnalytics.unknown_or_unclassified_count, 1);
  assert.equal(callAnalytics.funnel.find(stage => stage.stage === 'appointment_created').count, 1);
  assert.deepEqual(callAnalytics.theme_counts, [{ key: 'price', count: 1 }, { key: 'patient_indecision', count: 1 }, { key: 'location', count: 1 }]);
});

test('partial paginated appointment retrieval is explicit and cannot look complete', () => {
  const appointments = [
    appointment('page-1', 'completed', 'p1', '2026-02-01T10:00:00Z'),
    appointment('page-2', 'completed', 'p1', '2026-03-01T10:00:00Z'),
  ];
  const analytics = calculateAdvisorAnalytics({
    appointments,
    startDate: '2026-02-01',
    endDate: '2026-08-01',
    appointmentSource: {
      page_size: 100,
      pages_requested: 3,
      pages_received: 2,
      max_pages: 20,
      duplicate_records_removed: 1,
      results_may_be_incomplete: true,
      fetch_status: 'partial_failed_page',
      fetch_reason: 'An intermediate Juvonno appointment page failed.',
    },
  });
  assert.equal(analytics.source_limits.appointment_fetch_status, 'partial_failed_page');
  assert.equal(analytics.source_limits.appointment_pages_requested, 3);
  assert.equal(analytics.source_limits.appointment_duplicate_records_removed, 1);
  assert.equal(analytics.retention.appointment_data_complete, false);
  assert.match(analytics.retention.data_quality.at(-1), /must not be presented as complete/i);
});

test('retention source metadata distinguishes bounded historical context from the analysis period', () => {
  const analytics = calculateAdvisorAnalytics({
    appointments: [],
    startDate: '2026-03-01',
    endDate: '2026-08-29',
    appointmentSource: {
      fetch_start_date: '2000-01-01',
      fetch_end_date: '2026-08-29',
      analysis_start_date: '2026-03-01',
      analysis_end_date: '2026-08-29',
      historical_context_start: '2000-01-01',
      results_may_be_incomplete: false,
      fetch_status: 'complete',
    },
  });
  assert.equal(analytics.source_limits.appointment_fetch_start_date, '2000-01-01');
  assert.equal(analytics.source_limits.appointment_analysis_start_date, '2026-03-01');
  assert.equal(analytics.source_limits.appointment_historical_context_start, '2000-01-01');
});

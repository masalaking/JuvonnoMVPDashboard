const test = require('node:test');
const assert = require('node:assert/strict');
const fixture = require('./synthetic-advisor-staging-fixture.cjs');
const { calculateAdvisorAnalytics } = require('./advisor-analytics.cjs');

test('synthetic Advisor staging fixture is isolated and covers the required appointment and schedule scenarios', () => {
  assert.match(fixture.tenant_id, /^synthetic_/);
  assert.match(fixture.clinic_id, /^synthetic_/);
  assert.notEqual(fixture.clinic_id, fixture.second_clinic_id);
  for (const record of [...fixture.appointments, ...fixture.availability, ...fixture.calls, ...fixture.recommendations]) assert.equal(record.qa_marker, fixture.marker);
  const statuses = new Set(fixture.appointments.map(row => row.status));
  for (const status of ['completed', 'cancelled', 'canceled', 'rescheduled', 'no-show', 'late cancellation']) assert.ok(statuses.has(status));
  const patientIds = fixture.appointments.map(row => row.patient_id).filter(Boolean);
  assert.ok(patientIds.some(id => id.includes('stable_patient')));
  assert.ok(patientIds.some(id => id.includes('declining_patient')));
  assert.ok(patientIds.some(id => id.includes('increasing_patient')));
  assert.ok(patientIds.some(id => id.includes('insufficient_history')));
  assert.equal(new Set(fixture.availability.map(row => row.practitioner.id)).size, 3);
  assert.ok(fixture.availability.some(row => row.start.includes('T18:')));
  assert.ok(fixture.availability.some(row => row.blocked));
  assert.ok(fixture.appointments.some(row => row.id.endsWith('fully_booked_slot') && row.duration === 60));
  assert.ok(fixture.appointments.some(row => row.id.endsWith('partial_slot') && row.duration === 30));
  assert.ok(fixture.availability.some(row => row.source_backed_revenue_opportunity != null));
  assert.ok(fixture.availability.some(row => row.source_backed_revenue_opportunity == null));
});

test('synthetic Advisor staging fixture covers call themes and recommendation outcome states', () => {
  const callText = fixture.calls.map(row => row.summary).join(' ').toLowerCase();
  for (const phrase of ['appointment booked', 'expensive', 'location', 'insurance', 'not available', 'practitioner', 'do not offer', 'think about it', 'another clinic', 'technical issue', 'disconnected', 'only need your address', 'does not work']) assert.match(callText, new RegExp(phrase));
  assert.ok(fixture.calls.some(row => !row.summary));
  const statuses = new Set(fixture.recommendations.map(row => row.implementation_status));
  for (const status of ['suggested', 'accepted', 'implemented', 'monitoring', 'improved', 'no_change', 'reverted']) assert.ok(statuses.has(status));
  assert.equal(fixture.recommendations.find(row => row.implementation_status === 'improved').current_metric.value, 6);
  assert.equal(fixture.recommendations.find(row => row.implementation_status === 'no_change').current_metric.value, 10);
  assert.equal(fixture.recommendations.find(row => row.implementation_status === 'reverted').current_metric.value, 12);
});

test('synthetic schedule fixture calculates slot minutes from duration times slot count', () => {
  const capacity = calculateAdvisorAnalytics({
    appointments: fixture.appointments.filter(row => /fully_booked_slot|partial_slot/.test(row.id)),
    availability: fixture.availability,
    startDate: '2026-03-01',
    endDate: '2026-03-31',
  }).capacity_utilization;
  assert.equal(capacity.total_available_minutes, 255);
  assert.equal(capacity.total_booked_minutes, 90);
  assert.equal(capacity.total_unused_minutes, 165);
  assert.equal(capacity.available_slot_count, 5);
  assert.equal(capacity.utilization_rate, 35.2941);
  assert.equal(capacity.estimated_revenue_opportunity, null, 'a partial set of source-backed slot values cannot be converted into a total');
});

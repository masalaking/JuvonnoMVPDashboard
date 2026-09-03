/*
 * Deliberately fictional Advisor QA data. This module is an offline fixture,
 * not a production seeder: an operator must map it to a dedicated Juvonno
 * sandbox and the non-production RivaCare tenant before any live QA run.
 */
const marker = 'SYNTHETIC_ADVISOR_QA_20260829';
const tenant_id = 'synthetic_advisor_qa_tenant';
const clinic_id = 'synthetic_advisor_qa_clinic';
const second_clinic_id = 'synthetic_advisor_qa_second_clinic';

const appointment = (id, status, patient_id, start, extra = {}) => ({
  id: `${marker}_${id}`,
  qa_marker: marker,
  status,
  patient_id: `${marker}_${patient_id}`,
  date: { start },
  duration: 30,
  created_at: '2026-01-01T09:00:00Z',
  attendants: [{ id: 'qa_practitioner_a', name: 'QA Practitioner A' }],
  schedule_type: 'Physiotherapy',
  ...extra,
});

const appointments = [
  // Cancellation, reschedule, no-show, and rebooking coverage.
  appointment('completed_a', 'completed', 'new_patient', '2026-02-01T10:00:00Z', { amount: 120 }),
  appointment('cancel_rebook', 'cancelled', 'rebooked_patient', '2026-03-02T10:00:00Z', { amount: 140, schedule_type: 'Massage' }),
  appointment('rebook_after_cancel', 'booked', 'rebooked_patient', '2026-03-12T10:00:00Z', { amount: 140, schedule_type: 'Massage' }),
  appointment('cancel_no_rebook', 'canceled', 'lost_patient', '2026-03-03T10:00:00Z', { amount: 150, schedule_type: 'Massage' }),
  appointment('rescheduled', 'rescheduled', 'rescheduled_patient', '2026-03-04T10:00:00Z'),
  appointment('late_cancel', 'late cancellation', 'late_cancel_patient', '2026-03-05T18:00:00Z', { attendants: [{ id: 'qa_practitioner_b', name: 'QA Practitioner B' }], schedule_type: 'Acupuncture' }),
  appointment('no_show', 'no-show', 'no_show_patient', '2026-03-06T11:00:00Z', { amount: 110, created_at: '2026-02-01T11:00:00Z', attendants: [{ id: 'qa_practitioner_b', name: 'QA Practitioner B' }] }),
  appointment('fully_booked_slot', 'booked', 'full_capacity_patient', '2026-03-02T09:00:00Z', { duration: 60 }),
  appointment('partial_slot', 'booked', 'partial_capacity_patient', '2026-03-04T10:00:00Z'),
  // Stable cadence.
  appointment('stable_1', 'completed', 'stable_patient', '2026-01-05T10:00:00Z'),
  appointment('stable_2', 'completed', 'stable_patient', '2026-02-05T10:00:00Z'),
  appointment('stable_3', 'completed', 'stable_patient', '2026-03-07T10:00:00Z'),
  // Declining booking frequency with no future booking.
  appointment('declining_1', 'completed', 'declining_patient', '2026-01-01T10:00:00Z', { customer: { id: `${marker}_declining_patient`, first_name: 'Avery', last_name: 'Jordan' } }),
  appointment('declining_2', 'completed', 'declining_patient', '2026-01-15T10:00:00Z', { customer: { id: `${marker}_declining_patient`, first_name: 'Avery', last_name: 'Jordan' } }),
  appointment('declining_3', 'completed', 'declining_patient', '2026-03-16T10:00:00Z', { customer: { id: `${marker}_declining_patient`, first_name: 'Avery', last_name: 'Jordan' } }),
  // Increasing engagement.
  appointment('increasing_1', 'completed', 'increasing_patient', '2026-01-01T10:00:00Z'),
  appointment('increasing_2', 'completed', 'increasing_patient', '2026-02-01T10:00:00Z'),
  appointment('increasing_3', 'completed', 'increasing_patient', '2026-02-15T10:00:00Z'),
  appointment('insufficient_1', 'completed', 'insufficient_history', '2026-03-01T10:00:00Z'),
  appointment('insufficient_2', 'completed', 'insufficient_history', '2026-03-20T10:00:00Z'),
  // Second synthetic clinic proves fixture separation.
  { ...appointment('second_clinic_completed', 'completed', 'second_clinic_patient', '2026-03-21T10:00:00Z'), clinic_id: second_clinic_id },
];

const availability = [
  { qa_marker: marker, clinic_id, id: 'full', start: '2026-03-02T09:00:00Z', duration: 60, available_slot_count: 1, practitioner: { id: 'qa_practitioner_a' }, service: 'Physiotherapy', blocked: false },
  { qa_marker: marker, clinic_id, id: 'empty', start: '2026-03-03T18:00:00Z', duration: 30, available_slot_count: 1, practitioner: { id: 'qa_practitioner_b' }, service: 'Acupuncture', blocked: false, source_backed_revenue_opportunity: 90 },
  { qa_marker: marker, clinic_id, id: 'partial_a', start: '2026-03-04T10:00:00Z', duration: 60, available_slot_count: 2, practitioner: { id: 'qa_practitioner_a' }, service: 'Physiotherapy', blocked: false },
  { qa_marker: marker, clinic_id, id: 'partial_b', start: '2026-03-05T11:00:00Z', duration: 45, available_slot_count: 1, practitioner: { id: 'qa_practitioner_c' }, service: 'Massage', blocked: false },
  { qa_marker: marker, clinic_id, id: 'blocked', start: '2026-03-06T09:00:00Z', duration: 30, available_slot_count: 0, practitioner: { id: 'qa_practitioner_b' }, service: 'Massage', blocked: true },
];

const calls = [
  ['successful_booking', 'I have an available appointment at 3 PM. Yes, that works. Appointment booked.'],
  ['pricing_objection', 'The price is too expensive. I will think about it.'],
  ['location_objection', 'The location and parking are difficult.'],
  ['insurance_question', 'Do you take insurance coverage?'],
  ['time_unavailable', 'That requested appointment time is not available.'],
  ['practitioner_unavailable', 'That practitioner is unavailable.'],
  ['service_unavailable', 'We do not offer that service.'],
  ['think', 'I need to think about it and call back.'],
  ['competitor', 'I am comparing another clinic before booking.'],
  ['failure', 'The transfer failed because of a technical issue.'],
  ['disconnected', 'The call disconnected before an appointment was offered.'],
  ['ambiguous', ''],
  ['no_booking_intent', 'I only need your address and hours.'],
  ['intent_no_booking', 'I want to book, but no appointment was created.'],
  ['availability_rejected', 'We have an available time at 4 PM, but that does not work for me.'],
].map(([id, summary]) => ({ qa_marker: marker, clinic_id, retell_call_id: `${marker}_${id}`, summary, call_status: 'completed' }));

const recommendations = [
  { qa_marker: marker, title: 'Suggested synthetic reminder', implementation_status: 'suggested', baseline_metric: { value: 10, improvement_direction: 'lower_is_better' }, current_metric: null },
  { qa_marker: marker, title: 'Accepted synthetic reminder', implementation_status: 'accepted', baseline_metric: { value: 10, improvement_direction: 'lower_is_better' }, current_metric: null },
  { qa_marker: marker, title: 'Implemented synthetic reminder', implementation_status: 'implemented', baseline_metric: { value: 10, improvement_direction: 'lower_is_better' }, current_metric: { value: 8 } },
  { qa_marker: marker, title: 'Monitoring synthetic reminder', implementation_status: 'monitoring', baseline_metric: { value: 10, improvement_direction: 'lower_is_better' }, current_metric: { value: 7 } },
  { qa_marker: marker, title: 'Improved synthetic reminder', implementation_status: 'improved', baseline_metric: { value: 10, improvement_direction: 'lower_is_better' }, current_metric: { value: 6 } },
  { qa_marker: marker, title: 'Unchanged synthetic reminder', implementation_status: 'no_change', baseline_metric: { value: 10, improvement_direction: 'lower_is_better' }, current_metric: { value: 10 } },
  { qa_marker: marker, title: 'Worsened synthetic reminder', implementation_status: 'reverted', baseline_metric: { value: 10, improvement_direction: 'lower_is_better' }, current_metric: { value: 12 } },
];

module.exports = { marker, tenant_id, clinic_id, second_clinic_id, appointments, availability, calls, recommendations };

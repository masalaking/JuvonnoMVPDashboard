const test = require('node:test');
const assert = require('node:assert/strict');
const fixture = require('./synthetic-advisor-staging-fixture.cjs');
const { calculateAdvisorAnalytics } = require('./advisor-analytics.cjs');

const agentModule = import('../server/advisor-agent.js');
const recommendationModule = import('../server/advisor-recommendations.js');
const primaryAppointments = fixture.appointments.filter(row => !row.clinic_id || row.clinic_id === fixture.clinic_id);
const analytics = calculateAdvisorAnalytics({
  appointments: primaryAppointments,
  availability: fixture.availability,
  calls: fixture.calls,
  startDate: '2026-01-01',
  endDate: '2026-08-31',
  appointmentSource: { page_size: 100, pages_requested: 1, pages_received: 1, max_pages: 20, results_may_be_incomplete: false, fetch_status: 'complete' },
});
const patientRiskAnalytics = calculateAdvisorAnalytics({
  appointments: primaryAppointments,
  startDate: '2026-01-01',
  endDate: '2026-08-31',
  appointmentSource: { page_size: 100, pages_requested: 1, pages_received: 1, max_pages: 20, results_may_be_incomplete: false, fetch_status: 'complete' },
  includePatientDetails: true,
});
const capacityFixture = calculateAdvisorAnalytics({
  appointments: primaryAppointments.filter(row => /fully_booked_slot|partial_slot/.test(row.id)),
  availability: fixture.availability,
  startDate: '2026-03-01',
  endDate: '2026-03-07',
  appointmentSource: { page_size: 100, pages_requested: 1, pages_received: 1, max_pages: 20, results_may_be_incomplete: false, fetch_status: 'complete' },
});

const response = json => ({ ok: true, json: async () => json });
const source = { source_name: 'Synthetic Advisor QA fixture', clinic_id: fixture.clinic_id, qa_marker: fixture.marker };

async function syntheticTool(action, args) {
  const { measureRecommendation } = await recommendationModule;
  const fields = {
    'advisor.revenue_risk': analytics.revenue_risk,
    'advisor.cancellation_rebooking': analytics.cancellation_rebooking,
    'advisor.no_show_analytics': analytics.no_show_analytics,
    'advisor.capacity_utilization': capacityFixture.capacity_utilization,
    'advisor.retention': analytics.retention,
    'advisor.retention_cohorts': analytics.retention_cohorts,
    'advisor.appointment_frequency_changes': analytics.appointment_frequency_changes,
    'advisor.engagement_risk': analytics.engagement_risk,
    'advisor.engagement_risk_patients': patientRiskAnalytics.engagement_risk,
    'advisor.call_conversion': analytics.call_analytics,
    'advisor.call_themes': analytics.call_analytics,
  };
  if (action === 'advisor.call_transcript_details') {
    const call = fixture.calls.find(row => row.retell_call_id === args.detail_identifier);
    return { success: Boolean(call), action, transcript_details: call ? [{ retell_call_id: call.retell_call_id, transcript_excerpt: call.summary.slice(0, 1200), qa_marker: fixture.marker }] : [], sources: [source] };
  }
  if (action === 'advisor.recommendation_measurement' || action === 'advisor.recommendation_tracking') {
    const recommendation = fixture.recommendations.find(row => row.implementation_status === 'improved');
    return { success: true, action, recommendations: [{ ...recommendation, measurement: measureRecommendation(recommendation) }], sources: [source] };
  }
  const field = fields[action];
  return { success: Boolean(field), action, synthetic_result: field ?? null, source_limits: analytics.source_limits, sources: [source] };
}

const baseArgs = action => ({
  action,
  clinic_ids: [fixture.clinic_id, 'foreign_clinic_must_be_clipped'],
  start_date: '1900-01-01',
  end_date: '2200-01-01',
  patient_identifier: null,
  detail_identifier: action === 'advisor.call_transcript_details' ? fixture.calls[1].retell_call_id : null,
  practitioner_identifier: null,
});

async function runChain(t, chain) {
  const { runAdvisor } = await agentModule;
  const priorFetch = global.fetch;
  t.after(() => { global.fetch = priorFetch; });
  const messages = [];
  const observed = [];
  for (let index = 0; index < chain.questions.length; index++) {
    const question = chain.questions[index];
    const expectedAction = chain.actions[index];
    let fetchTurn = 0;
    global.fetch = async (_url, options) => {
      const body = JSON.parse(options.body);
      if (fetchTurn++ === 0) {
        if (index > 0) assert.ok(body.input.some(item => item.role === 'assistant'), 'follow-up keeps prior assistant context');
        return response({ output: [{ type: 'function_call', name: 'query_clinic_data', call_id: `call_${chain.id}_${index}`, arguments: JSON.stringify(baseArgs(expectedAction)) }] });
      }
      const output = body.input.findLast(item => item.type === 'function_call_output');
      assert.ok(output, 'structured tool output is returned to the Advisor');
      const structured = JSON.parse(output.output);
      assert.equal(structured.success, true);
      assert.equal(structured.action, expectedAction);
      observed.push(structured);
      return response({ output_text: `Synthetic grounded response for ${expectedAction}.` });
    };
    messages.push({ role: 'user', content: question });
    const result = await runAdvisor({
      apiKey: 'synthetic-test-key',
      messages,
      memories: [],
      authorizedClinicIds: [fixture.clinic_id],
      dateRange: { start: '2026-01-01', end: '2026-08-31' },
      executeTool: async args => {
        assert.deepEqual(args.clinic_ids, [fixture.clinic_id]);
        assert.equal(args.start_date, '2026-01-01');
        assert.equal(args.end_date, '2026-08-31');
        assert.equal(args.action, expectedAction);
        return syntheticTool(expectedAction, args);
      },
    });
    assert.equal(result.toolCalls.length, 1);
    assert.equal(result.toolCalls[0].arguments.action, expectedAction);
    assert.deepEqual(result.sources, [source]);
    messages.push({ role: 'assistant', content: result.answer });
  }
  chain.validate(observed);
}

const chains = [
  {
    id: 'revenue_leakage',
    questions: ['Where am I losing the most money?', 'Why?', 'Show me exactly where.', 'What should I fix first?'],
    actions: ['advisor.revenue_risk', 'advisor.revenue_risk', 'advisor.revenue_risk', 'advisor.revenue_risk'],
    validate: rows => {
      const risk = rows[0].synthetic_result;
      assert.equal(risk.confirmed_lost_revenue.amount, 110);
      assert.equal(risk.recoverable_revenue.amount, 150);
      assert.equal(risk.revenue_at_risk.amount, null);
      assert.equal(risk.revenue_opportunity.amount, null);
    },
  },
  {
    id: 'cancellations',
    questions: ['How many cancelled patients never rebooked?', 'Which service is the worst?', 'How much revenue could we recover?', 'What should we do?'],
    actions: Array(4).fill('advisor.cancellation_rebooking'),
    validate: rows => {
      const cancellation = rows[0].synthetic_result;
      assert.equal(cancellation.cancellation_count, 2);
      assert.equal(cancellation.cancellations_rebooked, 1);
      assert.equal(cancellation.cancellations_not_rebooked, 1);
      assert.equal(cancellation.recoverable_revenue, 150);
    },
  },
  {
    id: 'no_shows',
    questions: ['What is our no-show rate?', 'Which practitioner is highest?', 'Do longer lead-time appointments no-show more?', 'What should we change?'],
    actions: Array(4).fill('advisor.no_show_analytics'),
    validate: rows => {
      const noShows = rows[0].synthetic_result;
      assert.equal(noShows.no_show_count, 1);
      assert.ok(noShows.scheduled_count > noShows.no_show_count);
      assert.ok(noShows.practitioner_breakdown.length >= 2);
      assert.ok(noShows.booking_lead_time_breakdown.length > 0);
    },
  },
  {
    id: 'call_conversion',
    questions: ["Why aren't callers booking?", 'What is the biggest reason?', 'Show me the calls behind that.', 'How much opportunity are we losing?'],
    actions: ['advisor.call_themes', 'advisor.call_themes', 'advisor.call_transcript_details', 'advisor.call_conversion'],
    validate: rows => {
      assert.ok(rows[0].synthetic_result.theme_counts.length >= 8);
      assert.ok(rows[0].synthetic_result.unknown_or_unclassified_count >= 1);
      assert.equal(rows[2].transcript_details.length, 1);
      assert.equal(rows[3].synthetic_result.funnel.find(stage => stage.stage === 'appointment_created').count, 1);
    },
  },
  {
    id: 'capacity',
    questions: ['Which practitioner has the most unused availability?', 'What days are worst?', 'How much revenue opportunity is there?'],
    actions: Array(3).fill('advisor.capacity_utilization'),
    validate: rows => {
      const capacity = rows[0].synthetic_result;
      assert.equal(capacity.total_available_minutes, 255);
      assert.equal(capacity.total_unused_minutes, 165);
      assert.equal(capacity.estimated_revenue_opportunity, null);
    },
  },
  {
    id: 'retention',
    questions: ['Are patients returning less frequently?', 'Which group is changing the most?', 'How many patients are high engagement risk?', 'Which patients?'],
    actions: ['advisor.retention', 'advisor.appointment_frequency_changes', 'advisor.engagement_risk', 'advisor.engagement_risk_patients'],
    validate: rows => {
      assert.ok(rows[1].synthetic_result.evaluated_patient_count >= 3);
      assert.ok(rows[2].synthetic_result.risk_counts.high >= 1);
      assert.ok(rows[2].synthetic_result.risk_signal_examples.every(signal => !Object.hasOwn(signal, 'patient_reference')));
      assert.ok(rows[3].synthetic_result.high_risk_patients.length >= 1);
      assert.ok(rows[3].synthetic_result.high_risk_patients.every(patient => patient.patient_name));
      assert.doesNotMatch(JSON.stringify(rows[3]), /foreign_clinic_must_be_clipped/);
    },
  },
  {
    id: 'cohorts',
    questions: ['What percentage of new patients return for a second appointment?', 'What about a third?', 'Which service retains patients best?', 'How has this changed over six months?'],
    actions: Array(4).fill('advisor.retention_cohorts'),
    validate: rows => {
      assert.equal(rows[0].source_limits.appointment_fetch_status, 'complete');
      assert.equal(rows[0].synthetic_result.appointment_data_complete, true);
      assert.ok(rows[0].synthetic_result.new_patient_count > 0);
    },
  },
  {
    id: 'recommendation_measurement',
    questions: ['Did the no-show reminder recommendation work?', 'What was the baseline?', 'What happened after implementation?', 'How much did it improve?', 'How much revenue did that recover?'],
    actions: Array(5).fill('advisor.recommendation_measurement'),
    validate: rows => {
      const measured = rows[0].recommendations[0].measurement;
      assert.equal(measured.baseline_value, 10);
      assert.equal(measured.current_value, 6);
      assert.equal(measured.percentage_change, -40);
      assert.match(measured.interpretation, /does not establish causation/i);
    },
  },
];

for (const chain of chains) test(`synthetic conversation matrix: ${chain.id}`, async t => runChain(t, chain));

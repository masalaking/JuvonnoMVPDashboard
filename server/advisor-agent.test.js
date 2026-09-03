import test from 'node:test';
import assert from 'node:assert/strict';

const { runAdvisor, createEmbedding, extractMemories } = await import('./advisor-agent.js');

function response(json, ok = true) {
  return { ok, json: async () => json };
}

test('RAG advisor uses scoped memory, one structured tool, and a natural grounded answer', async t => {
  const requests = [];
  const priorFetch = global.fetch;
  t.after(() => { global.fetch = priorFetch; });
  global.fetch = async (_url, options) => {
    const body = JSON.parse(options.body);
    requests.push(body);
    if (requests.length === 1) {
      return response({ output:[{ type:'function_call', name:'query_clinic_data', call_id:'call_1', arguments:JSON.stringify({ action:'advisor.appointment_metrics', clinic_ids:['clinic_001','clinic_forbidden'], start_date:'1990-01-01', end_date:'2099-12-31', patient_identifier:null, detail_identifier:null, practitioner_identifier:null }) }] });
    }
    return response({ output_text:'Clinic 001 booked 14 appointments this week, up three from last week. Monday was the busiest day.' });
  };

  const toolInputs = [];
  const result = await runAdvisor({
    apiKey:'test-key',
    messages:[{role:'user',content:'How did bookings look this week?'}],
    memories:[{type:'business_preference',content:'The owner prefers week-over-week comparisons.'}],
    authorizedClinicIds:['clinic_001'],
    dateRange:{start:'2026-08-17',end:'2026-08-23'},
    executeTool:async args => {
      toolInputs.push(args);
      return {success:true,appointments:14,sources:[{source_name:'Appointments',clinic_id:'clinic_001'}]};
    },
  });

  assert.equal(toolInputs.length, 1);
  assert.deepEqual(toolInputs[0].clinic_ids, ['clinic_001']);
  assert.equal(toolInputs[0].start_date, '2026-08-17');
  assert.equal(toolInputs[0].end_date, '2026-08-23');
  assert.match(requests[0].instructions, /retrieved_memory_context/);
  assert.match(requests[0].instructions, /week-over-week comparisons/);
  assert.match(requests[0].instructions, /untrusted quoted data/);
  assert.match(requests[0].instructions, /Key finding, evidence, financial impact/i);
  assert.match(requests[0].instructions, /prioritize revenue magnitude first/i);
  assert.equal(requests[0].store, false);
  assert.equal(requests[0].parallel_tool_calls, false);
  assert.match(result.answer, /14 appointments/);
  assert.equal(result.sources.length, 1);
});

test('RAG advisor answers a greeting naturally without querying clinic data', async t => {
  const priorFetch = global.fetch;
  t.after(() => { global.fetch = priorFetch; });
  global.fetch = async () => response({output_text:'Hi! What would you like to understand about the clinic today?'});
  let calls = 0;
  const result = await runAdvisor({apiKey:'test-key',messages:[{role:'user',content:'Hi'}],memories:[],authorizedClinicIds:['clinic_001'],dateRange:{start:'2026-08-01',end:'2026-08-28'},executeTool:async()=>{calls++;}});
  assert.equal(calls, 0);
  assert.equal(result.answer, 'Hi! What would you like to understand about the clinic today?');
});

test('a follow-up retains the prior finding as conversation context', async t => {
  const priorFetch = global.fetch;
  t.after(() => { global.fetch = priorFetch; });
  const requests = [];
  global.fetch = async (_url, options) => {
    const body = JSON.parse(options.body);
    requests.push(body);
    if (requests.length === 1) return response({ output:[{ type:'function_call', name:'query_clinic_data', call_id:'call_followup', arguments:JSON.stringify({ action:'advisor.cancellation_rebooking', clinic_ids:['clinic_a'], start_date:null, end_date:null, patient_identifier:null, detail_identifier:null, practitioner_identifier:null }) }] });
    return response({ output_text:'The structured result shows cancelled appointments without a later booking; it does not establish why they did not rebook.' });
  };
  await runAdvisor({
    apiKey:'test-key',
    messages:[
      { role:'user', content:'Where am I losing the most money?' },
      { role:'assistant', content:'Cancellations are the largest measurable recovery opportunity.' },
      { role:'user', content:'Why?' },
    ],
    memories:[], authorizedClinicIds:['clinic_a'], dateRange:{start:'2026-08-01',end:'2026-08-28'},
    executeTool:async () => ({ success:true, cancellation_rebooking:{ cancellations_not_rebooked:4 }, sources:[] }),
  });
  assert.deepEqual(requests[0].input.map(item => item.content), [
    'Where am I losing the most money?',
    'Cancellations are the largest measurable recovery opportunity.',
    'Why?',
  ]);
});

test('partial source coverage is disclosed even when the model omits the limitation', async t => {
  const priorFetch = global.fetch;
  t.after(() => { global.fetch = priorFetch; });
  let requestCount = 0;
  global.fetch = async (_url, options) => {
    const body = JSON.parse(options.body);
    requestCount++;
    assert.match(body.instructions, /state that limitation before ranking/i);
    if (requestCount === 1) return response({ output:[{ type:'function_call', name:'query_clinic_data', call_id:'call_capacity_partial', arguments:JSON.stringify({ action:'advisor.capacity_utilization', clinic_ids:['clinic_a'], start_date:null, end_date:null, patient_identifier:null, detail_identifier:null, practitioner_identifier:null }) }] });
    return response({ output_text:'Practitioner A has the most unused availability.' });
  };
  const result = await runAdvisor({
    apiKey:'test-key', messages:[{role:'user',content:'Who has the most unused availability?'}], memories:[],
    authorizedClinicIds:['clinic_a'], dateRange:{start:'2026-08-01',end:'2026-08-28'},
    executeTool:async () => ({
      success:true,
      data:{juvonno_live:[{availability_source:{complete:false,reason:'Six daily responses reached the source cap.'}}]},
      sources:[{source_name:'Juvonno appointment availability API',clinic_id:'clinic_a'}],
    }),
  });
  assert.match(result.answer, /^Data coverage is partial:/);
  assert.match(result.answer, /Six daily responses reached the source cap/);
  assert.match(result.answer, /Practitioner A/);
});

test('recommendation-progress questions are tenant-scoped and use stored tracking data', async t => {
  const priorFetch = global.fetch;
  t.after(() => { global.fetch = priorFetch; });
  let requestCount = 0;
  global.fetch = async (_url, options) => {
    requestCount++;
    if (requestCount === 1) return response({ output:[{ type:'function_call', name:'query_clinic_data', call_id:'call_progress', arguments:JSON.stringify({ action:'advisor.recommendation_tracking', clinic_ids:['clinic_a','foreign_clinic'], start_date:null, end_date:null, patient_identifier:null, detail_identifier:null, practitioner_identifier:null }) }] });
    const body=JSON.parse(options.body);
    assert.match(body.instructions, /do not claim causation/i);
    return response({output_text:'The no-show metric improved after implementation. The stored record does not establish that the reminder caused the change.'});
  };
  const calls=[];
  const result=await runAdvisor({apiKey:'test-key',messages:[{role:'user',content:'Did the reminder change work?'}],memories:[],authorizedClinicIds:['clinic_a'],dateRange:{start:'2026-08-01',end:'2026-08-28'},executeTool:async args=>{calls.push(args);return {success:true,recommendations:[{implementation_status:'monitoring'}],sources:[{source_name:'Recommendation tracking',clinic_id:'clinic_a'}]};}});
  assert.equal(calls.length,1);
  assert.deepEqual(calls[0].clinic_ids,['clinic_a']);
  assert.equal(calls[0].action,'advisor.recommendation_tracking');
  assert.match(result.answer,/does not establish/i);
});

test('every added analytics operation is clipped to the authorized clinic scope', async t => {
  const actions = ['advisor.recommendation_measurement','advisor.capacity_utilization','advisor.cancellation_rebooking','advisor.no_show_analytics','advisor.call_conversion','advisor.call_themes','advisor.retention','advisor.retention_cohorts','advisor.appointment_frequency_changes','advisor.engagement_risk','advisor.engagement_risk_patients','advisor.revenue_risk'];
  const priorFetch = global.fetch;
  t.after(() => { global.fetch = priorFetch; });
  let turn = 0;
  global.fetch = async () => {
    const action = actions[Math.floor(turn / 2)];
    if (turn++ % 2 === 0) return response({ output: [{ type:'function_call', name:'query_clinic_data', call_id:`call_${action}`, arguments:JSON.stringify({ action, clinic_ids:['clinic_a','foreign_clinic'], start_date:'1900-01-01', end_date:'2200-01-01', patient_identifier:null, detail_identifier:null, practitioner_identifier:null }) }] });
    return response({ output_text:'The requested metric is unavailable without the required source data.' });
  };
  const calls = [];
  for (const action of actions) {
    await runAdvisor({ apiKey:'test-key', messages:[{role:'user',content:`Test ${action}`}], memories:[], authorizedClinicIds:['clinic_a'], dateRange:{start:'2026-08-01',end:'2026-08-28'}, executeTool:async args => { calls.push(args); return {success:true,sources:[]};} });
  }
  assert.equal(calls.length, actions.length);
  for (const [index, call] of calls.entries()) {
    assert.equal(call.action, actions[index]);
    assert.deepEqual(call.clinic_ids, ['clinic_a']);
    assert.equal(call.start_date, '2026-08-01');
    assert.equal(call.end_date, '2026-08-28');
  }
});

test('an explicit high-risk patient request receives the authorized patient-list action and conversational instructions', async t => {
  const priorFetch = global.fetch;
  t.after(() => { global.fetch = priorFetch; });
  let turn = 0;
  global.fetch = async (_url, options) => {
    const body = JSON.parse(options.body);
    if (turn++ === 0) {
      assert.match(body.instructions, /Engagement-risk privacy is contextual/);
      assert.match(body.instructions, /avoid report-style headings/i);
      return response({ output:[{ type:'function_call', name:'query_clinic_data', call_id:'risk_patients', arguments:JSON.stringify({ action:'advisor.engagement_risk_patients', clinic_ids:['clinic_a','foreign_clinic'], start_date:null, end_date:null, patient_identifier:null, detail_identifier:null, practitioner_identifier:null }) }] });
    }
    return response({output_text:'Two patients stand out: Sarah Smith has a much longer gap between visits and no future booking. I’d contact her first.'});
  };
  const calls=[];
  const result=await runAdvisor({apiKey:'test-key',messages:[{role:'user',content:'Which patients are considered high engagement risk?'}],memories:[],authorizedClinicIds:['clinic_a'],dateRange:{start:'2026-08-01',end:'2026-08-28'},executeTool:async args=>{calls.push(args);return {success:true,data:{juvonno_live:[{engagement_risk:{high_risk_patients:[{patient_name:'Sarah Smith',risk_level:'high'}]}}]},sources:[{clinic_id:'clinic_a'}]};}});
  assert.equal(calls.length,1);
  assert.equal(calls[0].action,'advisor.engagement_risk_patients');
  assert.deepEqual(calls[0].clinic_ids,['clinic_a']);
  assert.doesNotMatch(JSON.stringify(calls[0]),/foreign_clinic/);
  assert.match(result.answer,/Sarah Smith/);
});

test('detail and patient requests cannot be widened or populated by the model', async t => {
  const priorFetch = global.fetch;
  t.after(() => { global.fetch = priorFetch; });
  let requestCount=0;
  global.fetch=async()=>{
    requestCount++;
    if (requestCount===1) return response({output:[{type:'function_call',name:'query_clinic_data',call_id:'call_detail',arguments:JSON.stringify({action:'advisor.call_transcript_details',clinic_ids:['clinic_a','clinic_b'],start_date:'1900-01-01',end_date:'2200-01-01',patient_identifier:'other-tenant-patient',detail_identifier:'x',practitioner_identifier:null})}]});
    return response({output_text:'I need a specific call identifier before I can retrieve transcript details.'});
  };
  const calls=[];
  await runAdvisor({apiKey:'test-key',messages:[{role:'user',content:'Why did someone cancel?'}],memories:[],authorizedClinicIds:['clinic_a'],dateRange:{start:'2026-08-01',end:'2026-08-28'},executeTool:async args=>{calls.push(args);return {success:false,error_code:'SPECIFIC_DETAIL_IDENTIFIER_REQUIRED',sources:[]};}});
  assert.equal(calls.length,1);
  assert.deepEqual(calls[0].clinic_ids,['clinic_a']);
  assert.equal(calls[0].start_date,'2026-08-01');
  assert.equal(calls[0].end_date,'2026-08-28');
  assert.equal(calls[0].detail_identifier,null);
});

test('embedding responses must contain exactly 1,536 finite values', async t => {
  const priorFetch = global.fetch;
  t.after(() => { global.fetch = priorFetch; });
  global.fetch = async () => response({data:[{embedding:[0.1,0.2]}]});
  await assert.rejects(() => createEmbedding('test-key','hello'), error => error.code === 'INVALID_EMBEDDING');
});

test('memory extraction accepts fenced JSON but removes unsupported memory types', async t => {
  const priorFetch = global.fetch;
  t.after(() => { global.fetch = priorFetch; });
  global.fetch = async () => response({output_text:'```json\n{"memories":[{"type":"business_preference","content":"Prefers concise weekly comparisons.","patient_external_id":null},{"type":"credential","content":"secret","patient_external_id":null}]}\n```'});
  const result = await extractMemories('test-key',[{role:'user',content:'Keep answers concise.'}]);
  assert.deepEqual(result,[{type:'business_preference',content:'Prefers concise weekly comparisons.',patient_external_id:null}]);
});

test('memory extraction rejects contact data and temporary date payloads', async t => {
  const priorFetch = global.fetch;
  t.after(() => { global.fetch = priorFetch; });
  global.fetch = async () => response({output_text:'{"memories":[{"type":"patient","content":"Call 647-555-0101 tomorrow","patient_external_id":"x"},{"type":"clinic","content":"The owner prefers concise answers.","patient_external_id":null}]}' });
  const result = await extractMemories('test-key',[{role:'user',content:'Keep this for later'}]);
  assert.deepEqual(result,[{type:'clinic',content:'The owner prefers concise answers.',patient_external_id:null}]);
});

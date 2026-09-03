const assert = require('assert/strict');
const fs = require('fs');

const path = 'C:/Users/aarya/Documents/Codex/2026-08-06/i-o/outputs/RivaCare AI Clinic Advisor Production 2026-08-27/RivaCare Manager Analyst Tools - RAG PRACTITIONER REVENUE AND LEAKS.json';
const workflow = JSON.parse(fs.readFileSync(path, 'utf8'));
const formatCode = workflow.nodes.find(node => node.name === 'Format Grounded Advisor Result')?.parameters?.jsCode;
assert.ok(formatCode, 'formatter Code node is present');
const format = new Function('$input', '$', formatCode);

const appointments = [
  {id:101,status:'completed',date:{start:'2026-08-05T09:00:00-04:00'},duration:'60',attendants:[{id:'12',num:'122',first_name:'Russ',last_name:'Baron'}]},
  {id:102,status:'no-show',date:{start:'2026-08-06T09:00:00-04:00'},duration:'30',attendants:[{id:'12',num:'122',first_name:'Russ',last_name:'Baron'}]},
  {id:103,status:'late cancellation',date:{start:'2026-08-07T09:00:00-04:00'},duration:'30',attendants:[{id:'13',num:'5656',first_name:'Alan',last_name:'Hsu'}]},
];
const invoices = [
  {id:'i1',date:'2026-08-05',status:'receivable',amount:150,owing:40,appointment:{id:101,attendants:[{id:'12',num:'122',first_name:'Russ',last_name:'Baron'}]}},
  {id:'i2',date:'2026-06-01',status:'receivable',amount:200,owing:200,appointment:null},
];
const staff = [{id:'12',num:'122',first_name:'Russ',last_name:'Baron',status:'active',staff_type:'practitioner'}];

function run(action, practitionerIdentifier = null) {
  const row = {
    has_access:true,
    action,
    start_date:'2026-08-01',
    end_date:'2026-08-31',
    database_metrics:[],
    transcript_details:[],
    juvonno_configs:[{clinic_id:'clinic_001',clinic_name:'Clinic 001',practitioner_identifier:practitionerIdentifier}],
  };
  const request = (request_kind, provider_response) => ({json:{request:{clinic_id:'clinic_001',clinic_name:'Clinic 001',configured:true,request_kind},provider_response}});
  const items = [request('appointments_list',appointments),request('invoices_list',invoices),request('staff_list',staff)];
  return format({all:()=>items}, name => {
    assert.equal(name, 'Resolve Authorized Scope and Local Records');
    return {first:()=>({json:row})};
  })[0].json;
}

const practitioner = run('advisor.practitioner_revenue','Russ Baron').data.juvonno_live[0].practitioner;
assert.equal(practitioner.appointment_count,2);
assert.equal(practitioner.attributed_invoice_count,1);
assert.equal(practitioner.billed_amount,150);
assert.equal(practitioner.collected_amount,110);
assert.equal(practitioner.owing_amount,40);
assert.equal(practitioner.attribution_status,'appointment_attendant_link');

const leaks = run('advisor.revenue_leaks').data.juvonno_live[0].revenue_leaks;
assert.equal(leaks.confirmed_open_receivables_amount,40);
assert.equal(leaks.open_receivable_count,1);
assert.equal(leaks.completed_without_linked_invoice_count,0);
assert.equal(leaks.no_show_count,1);
assert.equal(leaks.late_cancellation_count,1);
assert.equal(leaks.estimated_lost_revenue,null);

console.log('advisor revenue workflow tests: pass');

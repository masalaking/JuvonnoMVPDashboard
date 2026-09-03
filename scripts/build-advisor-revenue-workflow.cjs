const fs = require('fs');
const path = require('path');

const outputs = 'C:/Users/aarya/Documents/Codex/2026-08-06/i-o/outputs/RivaCare AI Clinic Advisor Production 2026-08-27';
const source = path.join(outputs, 'RivaCare Manager Analyst Tools - APPOINTMENTS TRANSCRIPTS PRACTITIONER REVENUE.json');
const target = path.join(outputs, 'RivaCare Manager Analyst Tools - RAG PRACTITIONER REVENUE AND LEAKS.json');
const workflow = JSON.parse(fs.readFileSync(source, 'utf8'));
const analyticsCode = fs.readFileSync(path.join(__dirname, 'advisor-analytics.cjs'), 'utf8')
  .replace(/module\.exports\s*=\s*\{[^}]+\};?\s*$/m, '');

workflow.name = 'RivaCare Manager Analyst Tools - RAG PRACTITIONER REVENUE AND LEAKS';
workflow.description = 'Read-only, multi-client/multi-clinic Advisor tools. Returns scoped live Juvonno appointments, practitioner-attributed invoice revenue, receivables and measurable revenue-leak signals. Dollar values are never estimated.';

const node = name => {
  const found = workflow.nodes.find(item => item.name === name);
  if (!found) throw new Error(`Missing workflow node: ${name}`);
  return found;
};

// One scoped, read-only query supplies only the bounded fields required by
// deterministic transcript analytics. Full transcript retrieval remains the
// separate specific-identifier action below.
node('Resolve Authorized Scope and Local Records').parameters.query = String.raw`
WITH req AS (
  SELECT $1::text user_id,$2::text tenant_id,$3::text[] clinic_ids,$4::text action,
    $5::date start_date,$6::date end_date,NULLIF($7::text,'') patient_identifier,
    NULLIF($8::text,'') detail_identifier,NULLIF($9::text,'') practitioner_identifier
), scope AS (
  SELECT a.tenant_id,a.clinic_id,c.clinic_name,c.timezone,c.juvonno_base_url,
    c.default_branch_code,rivacare_decrypt_config_secret(c.juvonno_api_key_encrypted) juvonno_api_key,
    r.action,r.start_date,r.end_date,r.patient_identifier,r.detail_identifier,r.practitioner_identifier
  FROM req r JOIN user_clinic_access a ON a.user_id=r.user_id AND a.tenant_id=r.tenant_id
    AND a.clinic_id=ANY(r.clinic_ids) AND lower(a.role) IN ('owner','admin')
  JOIN clinic_configs c ON c.tenant_id=a.tenant_id AND c.clinic_id=a.clinic_id
), transcript_match AS (
  SELECT x.tenant_id,x.clinic_id,x.retell_call_id,x.started_at,x.call_status,x.sentiment,x.summary,x.transcript,x.from_number,x.to_number,'inbound'::text direction
  FROM calls x JOIN scope s ON s.tenant_id=x.tenant_id AND s.clinic_id=x.clinic_id
  WHERE s.action='advisor.call_transcript_details' AND (x.retell_call_id ILIKE '%'||s.detail_identifier||'%' OR x.from_number ILIKE '%'||s.detail_identifier||'%' OR x.to_number ILIKE '%'||s.detail_identifier||'%')
  UNION ALL
  SELECT x.tenant_id,x.clinic_id,x.retell_call_id,x.started_at,x.call_status,x.sentiment,x.summary,x.transcript,x.from_number,x.to_number,'outbound'::text direction
  FROM outbound_calls x JOIN scope s ON s.tenant_id=x.tenant_id AND s.clinic_id=x.clinic_id
  WHERE s.action='advisor.call_transcript_details' AND (x.retell_call_id ILIKE '%'||s.detail_identifier||'%' OR x.from_number ILIKE '%'||s.detail_identifier||'%' OR x.to_number ILIKE '%'||s.detail_identifier||'%')
), call_records AS (
  SELECT * FROM (
    SELECT x.tenant_id,x.clinic_id,x.retell_call_id,x.started_at,x.call_status,x.summary,left(COALESCE(x.transcript,''),1200) transcript_excerpt,'inbound'::text direction
    FROM calls x JOIN scope s ON s.tenant_id=x.tenant_id AND s.clinic_id=x.clinic_id
    WHERE s.action IN ('advisor.call_conversion','advisor.call_themes') AND x.created_at>=s.start_date AND x.created_at<s.end_date+1
    UNION ALL
    SELECT x.tenant_id,x.clinic_id,x.retell_call_id,x.started_at,x.call_status,x.summary,left(COALESCE(x.transcript,''),1200) transcript_excerpt,'outbound'::text direction
    FROM outbound_calls x JOIN scope s ON s.tenant_id=x.tenant_id AND s.clinic_id=x.clinic_id
    WHERE s.action IN ('advisor.call_conversion','advisor.call_themes') AND x.created_at>=s.start_date AND x.created_at<s.end_date+1
  ) calls_limited ORDER BY started_at DESC NULLS LAST LIMIT 500
), rollup AS (
  SELECT s.*,
    (SELECT count(*) FROM calls x WHERE x.tenant_id=s.tenant_id AND x.clinic_id=s.clinic_id AND x.created_at>=s.start_date AND x.created_at<s.end_date+1) call_count,
    (SELECT COALESCE(round(sum(x.duration_minutes),2),0) FROM calls x WHERE x.tenant_id=s.tenant_id AND x.clinic_id=s.clinic_id AND x.created_at>=s.start_date AND x.created_at<s.end_date+1) call_minutes,
    (SELECT count(*) FROM appointment_events x WHERE x.tenant_id=s.tenant_id AND x.clinic_id=s.clinic_id AND x.created_at>=s.start_date AND x.created_at<s.end_date+1) appointment_event_count
  FROM scope s
)
SELECT EXISTS(SELECT 1 FROM scope) has_access,(SELECT action FROM req) action,
  (SELECT start_date::text FROM req) start_date,(SELECT end_date::text FROM req) end_date,
  COALESCE((SELECT jsonb_agg(jsonb_build_object('clinic_id',r.clinic_id,'clinic_name',r.clinic_name,'timezone',r.timezone,'call_count',r.call_count,'call_minutes',r.call_minutes,'appointment_event_count',r.appointment_event_count) ORDER BY r.clinic_name) FROM rollup r),'[]'::jsonb) database_metrics,
  COALESCE((SELECT jsonb_agg(jsonb_build_object('clinic_id',s.clinic_id,'clinic_name',s.clinic_name,'base_url',s.juvonno_base_url,'branch_code',s.default_branch_code,'api_key',s.juvonno_api_key,'detail_identifier',s.detail_identifier,'practitioner_identifier',s.practitioner_identifier) ORDER BY s.clinic_name) FROM scope s),'[]'::jsonb) juvonno_configs,
  COALESCE((SELECT jsonb_agg(jsonb_build_object('retell_call_id',t.retell_call_id,'started_at',t.started_at,'direction',t.direction,'call_status',t.call_status,'sentiment',t.sentiment,'summary',t.summary,'transcript_excerpt',left(COALESCE(t.transcript,''),2500)) ORDER BY t.started_at DESC) FROM (SELECT * FROM transcript_match ORDER BY started_at DESC LIMIT 1) t),'[]'::jsonb) transcript_details,
  COALESCE((SELECT jsonb_agg(jsonb_build_object('tenant_id',c.tenant_id,'clinic_id',c.clinic_id,'retell_call_id',c.retell_call_id,'started_at',c.started_at,'direction',c.direction,'call_status',c.call_status,'summary',c.summary,'transcript_excerpt',c.transcript_excerpt) ORDER BY c.started_at DESC) FROM call_records c),'[]'::jsonb) call_records;
`.trim();

node('Normalize and Bound Request').parameters.jsCode = String.raw`
const incoming=$input.first().json||{};
const b=incoming.body&&typeof incoming.body==='object'?incoming.body:incoming;
const actions=['advisor.overview','advisor.compare_periods','advisor.call_metrics','advisor.appointment_metrics','advisor.appointment_lookup','advisor.appointment_details','advisor.call_transcript_details','advisor.practitioner_revenue','advisor.practitioner_comparison','advisor.revenue_leaks','advisor.invoice_metrics','advisor.receivables','advisor.payment_recovery','advisor.staff_queue','advisor.automation_health','advisor.clinic_configuration','advisor.patient_lookup','advisor.capacity_utilization','advisor.cancellation_rebooking','advisor.no_show_analytics','advisor.call_conversion','advisor.call_themes','advisor.retention','advisor.retention_cohorts','advisor.appointment_frequency_changes','advisor.engagement_risk','advisor.engagement_risk_patients','advisor.revenue_risk'];
const action=String(b.action||'');
const clinic_ids=[...new Set((Array.isArray(b.clinic_ids)?b.clinic_ids:[]).map(v=>String(v).trim()).filter(Boolean))].slice(0,50);
const validDate=v=>/^\d{4}-\d{2}-\d{2}$/.test(String(v||''));
const start_date=validDate(b.start_date)?String(b.start_date):new Date(Date.now()-30*864e5).toISOString().slice(0,10);
const end_date=validDate(b.end_date)?String(b.end_date):new Date().toISOString().slice(0,10);
const patient_identifier=String(b.patient_identifier||'').trim();
const detail_identifier=String(b.detail_identifier||'').trim();
const practitioner_identifier=String(b.practitioner_identifier||'').trim();
const detailActions=['advisor.appointment_details','advisor.call_transcript_details'];
const valid=actions.includes(action)&&Boolean(b.user_id&&b.tenant_id&&clinic_ids.length&&start_date<=end_date)&&(action!=='advisor.patient_lookup'||patient_identifier.length>=5)&&(!detailActions.includes(action)||detail_identifier.length>=3)&&(action!=='advisor.practitioner_revenue'||practitioner_identifier.length>=2);
return [{json:{action,user_id:String(b.user_id||'').trim(),tenant_id:String(b.tenant_id||'').trim(),clinic_ids,start_date,end_date,patient_identifier,detail_identifier,practitioner_identifier,correlation_id:String(b.correlation_id||'').trim(),valid}}];`.trim();

node('Prepare Native Juvonno HTTP Requests').parameters.jsCode = String.raw`
const row=$input.first().json||{};
const parse=v=>typeof v==='string'?JSON.parse(v):v;
const normalizeBase=v=>{let base=String(v||'').trim();if(base&&!/^https?:\/\//i.test(base))base='https://'+base;while(base.endsWith('/'))base=base.slice(0,-1);if(base.toLowerCase().endsWith('/api'))base=base.slice(0,-4);return base;};
const action=String(row.action||'');
const liveActions=new Set(['advisor.appointment_details','advisor.appointment_lookup','advisor.appointment_metrics','advisor.overview','advisor.practitioner_revenue','advisor.practitioner_comparison','advisor.revenue_leaks','advisor.invoice_metrics','advisor.receivables','advisor.capacity_utilization','advisor.cancellation_rebooking','advisor.no_show_analytics','advisor.retention','advisor.retention_cohorts','advisor.appointment_frequency_changes','advisor.engagement_risk','advisor.engagement_risk_patients','advisor.revenue_risk']);
const appointmentPageSize=100;
const appointmentMaxPages=20;
const availabilityMaxDays=31;
const historicalContextActions=new Set(['advisor.retention','advisor.retention_cohorts','advisor.appointment_frequency_changes','advisor.engagement_risk','advisor.engagement_risk_patients']);
const historicalContextStart='2000-01-01';
const historyWindowMonths=24;
const historyWindowOverlapDays=1;
const historyGlobalRequestLimit=300;
const historyGlobalRecordLimit=25000;
const historyWindowPlanLimit=1000;
const isoDate=value=>new Date(value).toISOString().slice(0,10);
const addUtcDays=(value,days)=>{const date=new Date(value+'T00:00:00Z');date.setUTCDate(date.getUTCDate()+days);return isoDate(date);};
const addUtcMonths=(value,months)=>{const date=new Date(value+'T00:00:00Z');date.setUTCMonth(date.getUTCMonth()+months);return isoDate(date);};
const responseList=v=>Array.isArray(v)?v:(Array.isArray(v?.list)?v.list:(Array.isArray(v?.data)?v.data:[]));
if(!row.has_access||!liveActions.has(action))return [{json:{needs_http:false}}];
const configs=parse(row.juvonno_configs)||[];
const out=[];
if(historicalContextActions.has(action)){
  let globalRequestsIssued=0;
  let globalRecordsAccepted=0;
  let globalRequestLimitReached=false;
  let globalRecordLimitReached=false;
  let windowPlanLimitReached=false;
  const clinicState=new Map();
  for(const c of configs){
    const base=normalizeBase(c.base_url),branch=String(c.branch_code||'').trim(),apiKey=String(c.api_key||'').trim();
    const configured=Boolean(base&&branch&&apiKey);
    const overallStart=historicalContextStart<=row.end_date?historicalContextStart:row.start_date;
    const overallEnd=String(row.end_date);
    const windows=[];
    let logicalStart=overallStart;
    while(logicalStart<=overallEnd&&windows.length<historyWindowPlanLimit){
      const candidateEnd=addUtcDays(addUtcMonths(logicalStart,historyWindowMonths),-1);
      const logicalEnd=candidateEnd<overallEnd?candidateEnd:overallEnd;
      windows.push({
        logicalStart,
        logicalEnd,
        requestStart:windows.length?addUtcDays(logicalStart,-historyWindowOverlapDays):logicalStart,
        requestEnd:logicalEnd,
      });
      logicalStart=addUtcDays(logicalEnd,1);
    }
    if(logicalStart<=overallEnd)windowPlanLimitReached=true;
    const state={requestsIssued:0,windowsStarted:0,windowsPlanned:windows.length,items:[]};
    clinicState.set(String(c.clinic_id),state);
    if(!configured){
      state.items.push({json:{needs_http:false,request:{configured:false,clinic_id:c.clinic_id,clinic_name:c.clinic_name,request_kind:'appointments_list',appointment_page_index:0,appointment_window_index:0,appointment_window_count_planned:windows.length,appointment_page_size:appointmentPageSize,appointment_max_pages:appointmentMaxPages,appointment_fetch_start_date:overallStart,appointment_fetch_end_date:overallEnd,appointment_analysis_start_date:row.start_date,appointment_analysis_end_date:row.end_date,historical_context_start:historicalContextStart},provider_response:[]}});
      out.push(...state.items);
      continue;
    }
    for(let windowIndex=0;windowIndex<windows.length;windowIndex++){
      if(globalRequestsIssued>=historyGlobalRequestLimit){globalRequestLimitReached=true;break;}
      if(globalRecordsAccepted>=historyGlobalRecordLimit){globalRecordLimitReached=true;break;}
      const window=windows[windowIndex];
      state.windowsStarted++;
      for(let pageIndex=0;pageIndex<appointmentMaxPages;pageIndex++){
        if(globalRequestsIssued>=historyGlobalRequestLimit){globalRequestLimitReached=true;break;}
        if(globalRecordsAccepted>=historyGlobalRecordLimit){globalRecordLimitReached=true;break;}
        const query='start_date='+encodeURIComponent(window.requestStart)+'&end_date='+encodeURIComponent(window.requestEnd)+'&status=all&start='+String(pageIndex*appointmentPageSize)+'&results='+String(appointmentPageSize);
        const url=base+'/api/appointments/list/'+encodeURIComponent(branch)+'?'+query;
        const request={configured:true,clinic_id:c.clinic_id,clinic_name:c.clinic_name,request_kind:'appointments_list',appointment_page_index:pageIndex,appointment_window_index:windowIndex,appointment_window_count_planned:windows.length,appointment_window_logical_start_date:window.logicalStart,appointment_window_logical_end_date:window.logicalEnd,appointment_window_start_date:window.requestStart,appointment_window_end_date:window.requestEnd,appointment_page_size:appointmentPageSize,appointment_max_pages:appointmentMaxPages,appointment_fetch_start_date:overallStart,appointment_fetch_end_date:overallEnd,appointment_analysis_start_date:row.start_date,appointment_analysis_end_date:row.end_date,historical_context_start:historicalContextStart,history_window_months:historyWindowMonths,history_window_overlap_days:historyWindowOverlapDays,history_global_request_limit:historyGlobalRequestLimit,history_global_record_limit:historyGlobalRecordLimit};
        globalRequestsIssued++;
        state.requestsIssued++;
        try{
          // n8n exposes HTTP helpers on the Code-node execution context. Keep
          // the injected $helpers fallback for the isolated workflow harness.
          const requestHelper=(typeof $helpers!=='undefined'&&$helpers?.httpRequest)
            ? $helpers.httpRequest.bind($helpers)
            : this?.helpers?.httpRequest?.bind(this.helpers);
          if(!requestHelper)throw new Error('n8n_http_request_helper_unavailable');
          const response=await requestHelper({method:'GET',url,headers:{Accept:'application/json','Content-Type':'application/json','X-API-Key':apiKey},timeout:20000});
          const records=responseList(response);
          const remaining=Math.max(0,historyGlobalRecordLimit-globalRecordsAccepted);
          const accepted=records.slice(0,remaining);
          globalRecordsAccepted+=accepted.length;
          if(accepted.length<records.length||globalRecordsAccepted>=historyGlobalRecordLimit)globalRecordLimitReached=true;
          state.items.push({json:{needs_http:false,request,provider_response:accepted}});
          if(records.length<appointmentPageSize||globalRecordLimitReached)break;
        }catch(error){
          const statusCode=Number(error?.statusCode??error?.response?.status??error?.httpCode??0)||null;
          state.items.push({json:{needs_http:false,request,provider_response:{error:'juvonno_request_failed',statusCode}}});
          break;
        }
      }
      if(globalRequestLimitReached||globalRecordLimitReached)break;
    }
    if(!state.items.length){
      state.items.push({json:{needs_http:false,request:{configured:true,clinic_id:c.clinic_id,clinic_name:c.clinic_name,request_kind:'appointments_list',appointment_page_index:0,appointment_window_index:0,appointment_window_count_planned:windows.length,appointment_page_size:appointmentPageSize,appointment_max_pages:appointmentMaxPages,appointment_fetch_start_date:overallStart,appointment_fetch_end_date:overallEnd,appointment_analysis_start_date:row.start_date,appointment_analysis_end_date:row.end_date,historical_context_start:historicalContextStart,appointment_request_skipped_global_limit:true,history_window_months:historyWindowMonths,history_window_overlap_days:historyWindowOverlapDays,history_global_request_limit:historyGlobalRequestLimit,history_global_record_limit:historyGlobalRecordLimit},provider_response:[]}});
    }
    out.push(...state.items);
  }
  for(const item of out){
    const request=item.json?.request;
    if(!request)continue;
    const state=clinicState.get(String(request.clinic_id));
    Object.assign(request,{history_requests_issued_for_clinic:state?.requestsIssued??0,history_windows_started_for_clinic:state?.windowsStarted??0,history_global_requests_issued:globalRequestsIssued,history_global_records_accepted:globalRecordsAccepted,history_global_request_limit_reached:globalRequestLimitReached,history_global_record_limit_reached:globalRecordLimitReached,history_window_plan_limit_reached:windowPlanLimitReached});
  }
  return out;
}
for(const c of configs){
  const base=normalizeBase(c.base_url),branch=String(c.branch_code||'').trim(),apiKey=String(c.api_key||'').trim();
  const common={needs_http:true,configured:Boolean(base&&branch&&apiKey),clinic_id:c.clinic_id,clinic_name:c.clinic_name,practitioner_identifier:c.practitioner_identifier||null,api_key:apiKey};
  const add=(request_kind,requestPath,metadata={})=>out.push({json:{...common,request_kind,url:base+requestPath,...metadata}});
  if(action==='advisor.appointment_details'){
    add('appointment_details','/api/appointments/'+encodeURIComponent(c.detail_identifier||''));
  }else{
    // Juvonno caps this endpoint at 100 rows. Request a bounded sequence of
    // pages and make the formatter explicitly mark a response partial if the
    // source never yields a short final page, a page fails, or a page is lost.
    const appointmentFetchStart=historicalContextActions.has(action)?historicalContextStart:row.start_date;
    for(let pageIndex=0;pageIndex<appointmentMaxPages;pageIndex++){
      const dates='start_date='+encodeURIComponent(appointmentFetchStart)+'&end_date='+encodeURIComponent(row.end_date)+'&status=all&start='+String(pageIndex*appointmentPageSize)+'&results='+String(appointmentPageSize);
      add('appointments_list','/api/appointments/list/'+encodeURIComponent(branch)+'?'+dates,{appointment_page_index:pageIndex,appointment_page_size:appointmentPageSize,appointment_max_pages:appointmentMaxPages,appointment_fetch_start_date:appointmentFetchStart,appointment_fetch_end_date:row.end_date,appointment_analysis_start_date:row.start_date,appointment_analysis_end_date:row.end_date,historical_context_start:historicalContextActions.has(action)?historicalContextStart:null});
    }
    if(action==='advisor.capacity_utilization'){
      const requestedStart=new Date(row.start_date+'T00:00:00Z');
      const requestedEnd=new Date(row.end_date+'T00:00:00Z');
      const requestedDays=Math.floor((requestedEnd-requestedStart)/86400000)+1;
      const daysToFetch=Math.min(Math.max(requestedDays,0),availabilityMaxDays);
      for(let dayIndex=0;dayIndex<daysToFetch;dayIndex++){
        const day=new Date(requestedStart.getTime()+dayIndex*86400000).toISOString().slice(0,10);
        const query='start_date='+encodeURIComponent(day)+'&end_date='+encodeURIComponent(day)+'&available_only=true&max_results=100';
        add('availability_list','/api/appointments/availability/'+encodeURIComponent(branch)+'?'+query,{availability_day:day,availability_day_index:dayIndex,availability_days_requested:daysToFetch,availability_requested_range_days:requestedDays,availability_max_days:availabilityMaxDays,availability_max_results:100});
      }
    }
    if(['advisor.practitioner_revenue','advisor.practitioner_comparison','advisor.revenue_leaks','advisor.invoice_metrics','advisor.receivables','advisor.cancellation_rebooking','advisor.revenue_risk'].includes(action)){
      add('invoices_list','/api/invoices/list/'+encodeURIComponent(branch));
    }
    if(['advisor.practitioner_revenue','advisor.practitioner_comparison'].includes(action)) add('staff_list','/api/staff?page=1');
  }
}
if(!out.length)out.push({json:{needs_http:true,configured:false,clinic_id:null,clinic_name:null,request_kind:'appointments_list',url:'https://invalid.invalid',api_key:''}});
return out;`.trim();

node('Format Grounded Advisor Result').parameters.jsCode = String.raw`
const row=$('Resolve Authorized Scope and Local Records').first().json||{};
const parse=v=>typeof v==='string'?JSON.parse(v):v;
const asList=v=>Array.isArray(v)?v:(Array.isArray(v?.list)?v.list:(Array.isArray(v?.data)?v.data:[]));
const number=v=>Number.isFinite(Number(v))?Number(v):0;
const money=v=>Math.round((number(v)+Number.EPSILON)*100)/100;
const dateOnly=v=>String(v||'').slice(0,10);
const inPeriod=(value)=>{const date=dateOnly(value);return Boolean(date&&date>=row.start_date&&date<=row.end_date);};
const staffTokens=value=>{
  const values=Array.isArray(value)?value:[value];
  return values.flatMap(item=>{
    if(item==null)return [];
    if(typeof item!=='object')return [String(item).toLowerCase()];
    return [item.id,item.num,item.staff_num,item.staff_number,item.name,[item.first_name,item.last_name].filter(Boolean).join(' ')].filter(Boolean).map(v=>String(v).toLowerCase());
  });
};
const practitionerMatches=(value,term,tokens=[])=>{
  const haystack=staffTokens(value);
  const needle=String(term||'').toLowerCase();
  return haystack.some(value=>tokens.includes(value)||(needle&&value.includes(needle)));
};
const appointmentId=a=>String(a?.id??a?.num??'');
const availabilityTimeMinutes=slot=>{
  const raw=slot?.time;
  let text=String(raw&&typeof raw==='object'?(raw.time??raw.value??raw.display??''):(raw??slot?.start_time??slot?.time_value??slot?.start??slot?.datetime??'')).trim().toLowerCase().replace(/\./g,'');
  let meridiem=String(raw&&typeof raw==='object'?(raw.meridiem??raw.ampm??''):(slot?.meridiem??slot?.ampm??'')).trim().toLowerCase().replace(/\./g,'');
  const inText=text.match(/\b([ap])\s*m\b/);if(inText&&!meridiem)meridiem=inText[1]+'m';
  text=text.replace(/\b[ap]\s*m\b/g,'').trim();
  const match=text.match(/(?:T|^)(\d{1,2}):(\d{2})/);if(!match)return null;
  let hour=Number(match[1]);const minute=Number(match[2]);
  if(meridiem.startsWith('p')&&hour<12)hour+=12;if(meridiem.startsWith('a')&&hour===12)hour=0;
  return hour*60+minute;
};
const availabilityStaffBlocks=response=>{
  if(Array.isArray(response))return response;
  if(Array.isArray(response?.list))return response.list;
  if(response?.list&&typeof response.list==='object')return [response.list];
  if(Array.isArray(response?.data))return response.data;
  if(response?.data&&typeof response.data==='object')return [response.data];
  return [];
};
const availabilityDateEntries=staffBlock=>{
  const slots=staffBlock?.slots;
  if(slots&&typeof slots==='object'&&!Array.isArray(slots))return Object.entries(slots).filter(([,value])=>Array.isArray(value));
  if(!Array.isArray(slots))return [];
  const out=[];
  for(const entry of slots){
    if(!entry||typeof entry!=='object')continue;
    if(typeof entry.date==='string'&&Array.isArray(entry.slots))out.push([entry.date,entry.slots]);
    for(const [key,value] of Object.entries(entry))if(/^\d{4}-\d{2}-\d{2}$/.test(key)&&Array.isArray(value))out.push([key,value]);
  }
  return out;
};
const normalizeAvailabilityResponse=(response,request)=>{
  const rows=[];let inspectedSlotCount=0;let durationUnavailableCount=0;
  for(const staffBlock of availabilityStaffBlocks(response)){
    const staff=staffBlock?.staff??{};
    const staffNum=String(staff?.num??staff?.staff_num??staff?.id??'Unassigned');
    const staffName=[staff?.first_name,staff?.last_name].filter(Boolean).join(' ')||staff?.name||staffNum;
    for(const [date,slots] of availabilityDateEntries(staffBlock)){
      inspectedSlotCount+=slots.length;
      const groups=new Map();
      for(const slot of slots){
        const typeId=String(slot?.schedule_type?.id??slot?.schedule_type_id??'');
        const typeName=String(slot?.schedule_type?.name??slot?.schedule_type_name??'Unspecified');
        const key=typeId+'|'+typeName;const group=groups.get(key)??{typeId,typeName,slots:[]};group.slots.push(slot);groups.set(key,group);
      }
      for(const group of groups.values()){
        const timed=group.slots.map(slot=>({slot,minute:availabilityTimeMinutes(slot)})).filter(item=>item.minute!=null).sort((a,b)=>a.minute-b.minute);
        const diffs=timed.slice(1).map((item,index)=>item.minute-timed[index].minute).filter(value=>value>0);
        const interval=diffs.length?Math.min(...diffs):null;
        if(interval==null){durationUnavailableCount+=timed.filter(item=>item.slot?.available===true).length;continue;}
        for(const item of timed){
          if(item.slot?.available!==true)continue;
          const hh=String(Math.floor(item.minute/60)).padStart(2,'0'),mm=String(item.minute%60).padStart(2,'0');
          rows.push({availability_kind:'unused_slot',duration_minutes:interval,available_slot_count:1,start:date+'T'+hh+':'+mm+':00',date:{start:date+'T'+hh+':'+mm+':00'},clinic_id:request?.clinic_id,practitioner:{id:staffNum,name:staffName},service:{id:group.typeId||null,name:group.typeName}});
        }
      }
    }
  }
  return {rows,inspectedSlotCount,durationUnavailableCount};
};
${analyticsCode}
if(!row.has_access)return [{json:{success:false,error_code:'CLINIC_ACCESS_FORBIDDEN',message:'Owner or administrator clinic access was not verified.',sources:[]}}];
const action=String(row.action||'');
const configs=parse(row.juvonno_configs)||[];
const localMetrics=parse(row.database_metrics)||[];
const transcriptDetails=parse(row.transcript_details)||[];
const callRecords=parse(row.call_records)||[];
const generatedAt=new Date().toISOString();
const sources=localMetrics.map(m=>({source_name:'RivaCare operational database',generated_at:generatedAt,freshness:'database',clinic_id:m.clinic_id,clinic_name:m.clinic_name,date_start:row.start_date,date_end:row.end_date}));
const http=$input.all().map(i=>i.json||{}).filter(x=>x.request);
const live=[];
const isFailed=x=>!x||x.provider_response?.error||Number(x.provider_response?.statusCode||x.provider_response?.status_code||0)>=400;
const statusOf=x=>Number(x?.provider_response?.statusCode||x?.provider_response?.status_code||0)||null;
for(const c of configs){
  const rows=http.filter(x=>x.request?.clinic_id===c.clinic_id);
  const mainKind=action==='advisor.appointment_details'?'appointment_details':'appointments_list';
  const main=rows.find(x=>x.request?.request_kind===mainKind);
  if(!main||!main.request?.configured){live.push({clinic_id:c.clinic_id,available:false,reason:'clinic_connection_not_configured'});continue;}
  if(mainKind==='appointment_details'&&isFailed(main)){live.push({clinic_id:c.clinic_id,available:false,reason:'juvonno_endpoint_failed',failed_endpoint:mainKind,http_status:statusOf(main)});continue;}
  const result={clinic_id:c.clinic_id,available:true};
  if(mainKind==='appointment_details'){
    const a=main.provider_response||{};
    result.appointment={appointment_id:a?.id??a?.num??null,start_at:a?.date?.start??a?.start??null,duration_minutes:a?.duration??null,status:a?.status??null,service:a?.schedule_type??a?.service??null,practitioners:a?.attendants??[]};
  }else{
    const appointmentPages=rows.filter(x=>x.request?.request_kind==='appointments_list').sort((a,b)=>Number(a.request?.appointment_window_index??0)-Number(b.request?.appointment_window_index??0)||Number(a.request?.appointment_page_index??0)-Number(b.request?.appointment_page_index??0));
    const firstRequest=appointmentPages[0]?.request??{};
    const pageSize=Number(firstRequest.appointment_page_size??100);
    const maxPages=Number(firstRequest.appointment_max_pages??1);
    const historyMode=Boolean(firstRequest.historical_context_start);
    const plannedWindows=Math.max(1,Number(firstRequest.appointment_window_count_planned??1));
    const windowGroups=new Map();
    for(const page of appointmentPages){const index=Number(page.request?.appointment_window_index??0);const group=windowGroups.get(index)??[];group.push(page);windowGroups.set(index,group);}
    const windowStates=[];
    for(let windowIndex=0;windowIndex<plannedWindows;windowIndex++){
      const pages=(windowGroups.get(windowIndex)??[]).sort((a,b)=>Number(a.request?.appointment_page_index??0)-Number(b.request?.appointment_page_index??0));
      if(!pages.length){windowStates.push({windowIndex,failed:false,missing:true,capped:false,complete:false});continue;}
      const shortPage=pages.find(page=>!isFailed(page)&&asList(page.provider_response).length<pageSize);
      const relevantLastIndex=shortPage?Number(shortPage.request?.appointment_page_index??0):maxPages-1;
      const relevantPages=pages.filter(page=>Number(page.request?.appointment_page_index??0)<=relevantLastIndex);
      const failed=relevantPages.some(isFailed);
      const present=new Set(relevantPages.map(page=>Number(page.request?.appointment_page_index??0)));
      let missing=false;for(let index=0;index<=relevantLastIndex;index++)if(!present.has(index)){missing=true;break;}
      const capped=!shortPage&&!failed&&!missing&&relevantLastIndex===maxPages-1;
      windowStates.push({windowIndex,failed,missing,capped,complete:Boolean(shortPage&&!failed&&!missing)});
    }
    const fetchedRows=appointmentPages.flatMap(page=>isFailed(page)?[]:asList(page.provider_response));
    const globalRecordLimit=Math.max(1,Number(firstRequest.history_global_record_limit??25000));
    const globalRecordLimitReached=appointmentPages.some(page=>page.request?.history_global_record_limit_reached===true)||fetchedRows.length>globalRecordLimit;
    const acceptedRows=fetchedRows.slice(0,globalRecordLimit);
    const seenAppointmentIds=new Set();let duplicateRecordsRemoved=0;let recordsWithoutStableId=0;
    const appointmentFetchStart=String(firstRequest.appointment_fetch_start_date??row.start_date);
    const appointmentFetchEnd=String(firstRequest.appointment_fetch_end_date??row.end_date);
    const appointments=acceptedRows.filter(a=>{
      const id=appointmentId(a);
      // An ID-less row cannot safely be deduplicated, so retain it and report
      // the limitation rather than guessing a composite identity.
      if(!id){recordsWithoutStableId++;return true;}
      if(seenAppointmentIds.has(id)){duplicateRecordsRemoved++;return false;}
      seenAppointmentIds.add(id);return true;
    }).filter(a=>{const date=dateOnly(a?.date?.start??a?.start);return Boolean(date&&date>=appointmentFetchStart&&date<=appointmentFetchEnd);});
    const failedWindows=windowStates.filter(state=>state.failed).length;
    const missingWindows=windowStates.filter(state=>state.missing).length;
    const cappedWindows=windowStates.filter(state=>state.capped).length;
    const completeWindows=windowStates.filter(state=>state.complete).length;
    const globalRequestLimitReached=appointmentPages.some(page=>page.request?.history_global_request_limit_reached===true||page.request?.history_window_plan_limit_reached===true);
    let fetchStatus='complete';let fetchReason=null;
    if(globalRecordLimitReached){fetchStatus='partial_global_record_limit';fetchReason='The bounded historical appointment record ceiling was reached before every partition could be proven complete.';}
    else if(globalRequestLimitReached){fetchStatus='partial_global_request_limit';fetchReason='The bounded historical appointment request ceiling was reached before every partition could be proven complete.';}
    else if(failedWindows){fetchStatus=historyMode?'partial_failed_window':'partial_failed_page';fetchReason=historyMode?failedWindows+' historical appointment window(s) contained a failed Juvonno page.':'An intermediate Juvonno appointment page failed.';}
    else if(missingWindows||windowStates.some(state=>state.missing)){fetchStatus=historyMode?'partial_missing_window':'partial_missing_page';fetchReason=historyMode?'One or more historical appointment windows or required pages were not returned.':'One or more expected Juvonno appointment pages were not returned.';}
    else if(cappedWindows){fetchStatus=historyMode?'partial_window_page_limit':'partial_max_page_limit';fetchReason=historyMode?cappedWindows+' historical appointment window(s) reached the per-window page ceiling before a short final page confirmed completion.':'The bounded Juvonno appointment page limit was reached before a short final page confirmed completion.';}
    else if(recordsWithoutStableId){fetchStatus='partial_missing_appointment_id';fetchReason=recordsWithoutStableId+' appointment record(s) lacked the stable Juvonno ID required for deterministic cross-window de-duplication.';}
    const pagesRequested=historyMode?Number(firstRequest.history_requests_issued_for_clinic??appointmentPages.length):Math.min(maxPages,Math.max(1,appointmentPages.length));
    const appointmentSource={page_size:pageSize,pages_requested:pagesRequested,pages_received:appointmentPages.filter(page=>!isFailed(page)&&page.request?.appointment_request_skipped_global_limit!==true).length,max_pages:maxPages,max_pages_per_window:maxPages,partition_strategy:historyMode?'overlapping_time_windows':null,partition_window_months:historyMode?Number(firstRequest.history_window_months??24):null,partition_overlap_days:historyMode?Number(firstRequest.history_window_overlap_days??1):null,windows_planned:plannedWindows,windows_started:historyMode?Number(firstRequest.history_windows_started_for_clinic??windowGroups.size):1,windows_complete:completeWindows,windows_failed:failedWindows,windows_missing:missingWindows,windows_capped:cappedWindows,global_request_limit:historyMode?Number(firstRequest.history_global_request_limit??300):null,global_record_limit:historyMode?globalRecordLimit:null,records_fetched_before_dedup:acceptedRows.length,records_without_stable_id:recordsWithoutStableId,duplicate_records_removed:duplicateRecordsRemoved,results_may_be_incomplete:fetchStatus!=='complete',fetch_status:fetchStatus,fetch_reason:fetchReason,fetch_start_date:appointmentFetchStart,fetch_end_date:appointmentFetchEnd,analysis_start_date:row.start_date,analysis_end_date:row.end_date,historical_context_start:firstRequest.historical_context_start??null};
    const availabilityRequests=rows.filter(x=>x.request?.request_kind==='availability_list').sort((a,b)=>Number(a.request?.availability_day_index??0)-Number(b.request?.availability_day_index??0));
    let availability=[];let availabilitySource=null;let analyticsAppointments=appointments;
    if(action==='advisor.capacity_utilization'){
      const expectedAvailabilityDays=Number(availabilityRequests[0]?.request?.availability_days_requested??0);
      const requestedRangeDays=Number(availabilityRequests[0]?.request?.availability_requested_range_days??0);
      const availabilityMaxDays=Number(availabilityRequests[0]?.request?.availability_max_days??31);
      const availabilityMaxResults=Number(availabilityRequests[0]?.request?.availability_max_results??100);
      const failedAvailability=availabilityRequests.filter(isFailed);
      const successfulAvailabilityDays=availabilityRequests.length-failedAvailability.length;
      const normalizedAvailability=availabilityRequests.filter(page=>!isFailed(page)).map(page=>normalizeAvailabilityResponse(page.provider_response,page.request));
      const inspectedSlotCount=normalizedAvailability.reduce((sum,item)=>sum+item.inspectedSlotCount,0);
      const durationUnavailableCount=normalizedAvailability.reduce((sum,item)=>sum+item.durationUnavailableCount,0);
      const dedupe=new Set();
      availability=normalizedAvailability.flatMap(item=>item.rows).filter(slot=>{const key=[slot.clinic_id,slot.practitioner?.id,slot.start,slot.service?.id??slot.service?.name].join('|');if(dedupe.has(key))return false;dedupe.add(key);return true;});
      const missingAvailabilityDays=Math.max(0,expectedAvailabilityDays-availabilityRequests.length);
      const cappedAvailabilityDays=availabilityRequests.filter(page=>!isFailed(page)).filter((page,index)=>normalizedAvailability[index]?.inspectedSlotCount>=availabilityMaxResults).length;
      const rangeLimited=requestedRangeDays>availabilityMaxDays;
      const reasonParts=[];
      if(failedAvailability.length)reasonParts.push(failedAvailability.length+' daily availability request(s) failed');
      if(missingAvailabilityDays)reasonParts.push(missingAvailabilityDays+' daily availability request(s) were missing');
      if(cappedAvailabilityDays)reasonParts.push(cappedAvailabilityDays+' daily response(s) reached Juvonno\'s 100-result cap');
      if(durationUnavailableCount)reasonParts.push(durationUnavailableCount+' available slot(s) had no source-derived grid duration');
      if(rangeLimited)reasonParts.push('the requested range exceeded the bounded '+availabilityMaxDays+'-day capacity window');
      const coverageStart=availabilityRequests[0]?.request?.availability_day??row.start_date;
      const coverageEnd=availabilityRequests.at(-1)?.request?.availability_day??row.end_date;
      const availabilityComplete=successfulAvailabilityDays>0&&!reasonParts.length;
      availabilitySource={verified:successfulAvailabilityDays>0,basis:'unused_slots',source_name:'Juvonno appointment availability API',complete:availabilityComplete,reason:reasonParts.length?reasonParts.join('; '):null,coverage_start:coverageStart,coverage_end:coverageEnd,days_requested:expectedAvailabilityDays,days_received:successfulAvailabilityDays,inspected_slot_count:inspectedSlotCount,unused_slot_count:availability.length,max_results_per_day:availabilityMaxResults};
      analyticsAppointments=appointments.filter(a=>{const date=dateOnly(a?.date?.start??a?.start);return Boolean(date&&date>=coverageStart&&date<=coverageEnd);});
      result.availability_source=availabilitySource;
    }
    result.appointment_count=appointments.length;
    result.appointment_source=appointmentSource;
    result.recent_appointments=appointments.filter(a=>inPeriod(a?.date?.start??a?.start)).slice().sort((a,b)=>String(b?.date?.start??b?.start??'').localeCompare(String(a?.date?.start??a?.start??''))).slice(0,10).map(a=>({appointment_id:a?.id??a?.num??null,start_at:a?.date?.start??a?.start??null,duration_minutes:a?.duration??null,status:a?.status??null,service:a?.schedule_type??a?.service??null,practitioners:a?.attendants??[]}));
    const invoiceRow=rows.find(x=>x.request?.request_kind==='invoices_list');
    const invoices=isFailed(invoiceRow)?[]:asList(invoiceRow?.provider_response).filter(invoice=>inPeriod(invoice?.date??invoice?.created));
    if(['advisor.practitioner_revenue','advisor.practitioner_comparison'].includes(action)){
      const staffRow=rows.find(x=>x.request?.request_kind==='staff_list');
      const staff=isFailed(staffRow)?[]:asList(staffRow.provider_response);
      const term=String(c.practitioner_identifier||'').toLowerCase();
      const matchedStaff=staff.filter(s=>practitionerMatches(s,term));
      const tokens=[...new Set(matchedStaff.flatMap(staffTokens))];
      const matches=a=>practitionerMatches(a?.attendants||a?.appointment?.attendants,term,tokens);
      const providerAppointments=appointments.filter(matches);
      const attributedInvoices=invoices.filter(invoice=>invoice?.appointment&&matches(invoice.appointment));
      const unassignedInvoices=invoices.filter(invoice=>!invoice?.appointment||!Array.isArray(invoice.appointment?.attendants)||invoice.appointment.attendants.length!==1);
      result.practitioner={
        identifier:c.practitioner_identifier||null,
        appointment_count:providerAppointments.length,
        billed_amount:money(attributedInvoices.filter(i=>String(i?.status||'').toLowerCase()!=='void').reduce((sum,i)=>sum+number(i?.amount),0)),
        collected_amount:money(attributedInvoices.filter(i=>String(i?.status||'').toLowerCase()!=='void').reduce((sum,i)=>sum+Math.max(0,number(i?.amount)-number(i?.owing)),0)),
        owing_amount:money(attributedInvoices.filter(i=>String(i?.status||'').toLowerCase()!=='void').reduce((sum,i)=>sum+number(i?.owing),0)),
        attributed_invoice_count:attributedInvoices.length,
        unassigned_amount:money(unassignedInvoices.filter(i=>String(i?.status||'').toLowerCase()!=='void').reduce((sum,i)=>sum+number(i?.amount),0)),
        attribution_status:attributedInvoices.length?'appointment_attendant_link':'no_provider_linked_invoices_found',
        matched_staff:matchedStaff.slice(0,5).map(s=>({id:s?.id??null,num:s?.num??null,first_name:s?.first_name??null,last_name:s?.last_name??null,status:s?.status??null,staff_type:s?.staff_type??null})),
        invoice_records_checked:invoices.length
      };
      const warnings=[invoiceRow,staffRow].filter(isFailed).map(x=>({endpoint:x?.request?.request_kind||'unknown',http_status:statusOf(x)}));
      if(warnings.length)result.warnings=warnings;
    }
    if(action==='advisor.revenue_leaks'){
      const normalizedStatus=a=>String(a?.status||'').toLowerCase();
      const invoicesByAppointment=new Set(invoices.map(i=>appointmentId(i?.appointment)).filter(Boolean));
      const activeInvoices=invoices.filter(i=>String(i?.status||'').toLowerCase()!=='void');
      const outstanding=activeInvoices.filter(i=>number(i?.owing)>0);
      const ageDays=i=>Math.max(0,Math.floor((Date.parse(row.end_date+'T23:59:59Z')-Date.parse(dateOnly(i?.date??i?.created)+'T00:00:00Z'))/864e5));
      const completedUnbilled=appointments.filter(a=>['completed','arrived'].includes(normalizedStatus(a))&&!invoicesByAppointment.has(appointmentId(a)));
      const noShows=appointments.filter(a=>normalizedStatus(a)==='no-show'||normalizedStatus(a)==='no show');
      const lateCancels=appointments.filter(a=>normalizedStatus(a)==='late cancellation');
      const cancellations=appointments.filter(a=>normalizedStatus(a).includes('cancelled')||normalizedStatus(a)==='canceled');
      result.revenue_leaks={
        confirmed_open_receivables_amount:money(outstanding.reduce((sum,i)=>sum+number(i?.owing),0)),
        open_receivable_count:outstanding.length,
        receivables_31_to_60_days_amount:money(outstanding.filter(i=>ageDays(i)>=31&&ageDays(i)<=60).reduce((sum,i)=>sum+number(i?.owing),0)),
        receivables_61_to_90_days_amount:money(outstanding.filter(i=>ageDays(i)>=61&&ageDays(i)<=90).reduce((sum,i)=>sum+number(i?.owing),0)),
        receivables_over_90_days_amount:money(outstanding.filter(i=>ageDays(i)>90).reduce((sum,i)=>sum+number(i?.owing),0)),
        completed_without_linked_invoice_count:completedUnbilled.length,
        no_show_count:noShows.length,
        late_cancellation_count:lateCancels.length,
        cancellation_count:cancellations.length,
        unassigned_invoice_amount:money(activeInvoices.filter(i=>!i?.appointment||!Array.isArray(i.appointment?.attendants)||i.appointment.attendants.length!==1).reduce((sum,i)=>sum+number(i?.amount),0)),
        estimated_lost_revenue:null,
        interpretation:'Counts are measurable workflow opportunities. No-show, cancellation, and unbilled appointment counts are not converted to dollars without a source-backed fee.'
      };
      if(isFailed(invoiceRow)) result.warnings=[...(result.warnings||[]),{endpoint:'invoices_list',http_status:statusOf(invoiceRow),effect:'receivable and invoice-link signals unavailable'}];
    }
    if(['advisor.invoice_metrics','advisor.receivables'].includes(action)){
      const active=invoices.filter(i=>String(i?.status||'').toLowerCase()!=='void');
      result.invoices={invoice_count:active.length,billed_amount:money(active.reduce((sum,i)=>sum+number(i?.amount),0)),collected_amount:money(active.reduce((sum,i)=>sum+Math.max(0,number(i?.amount)-number(i?.owing)),0)),owing_amount:money(active.reduce((sum,i)=>sum+number(i?.owing),0))};
    }
    const analyticsActions=new Set(['advisor.capacity_utilization','advisor.cancellation_rebooking','advisor.no_show_analytics','advisor.retention','advisor.retention_cohorts','advisor.appointment_frequency_changes','advisor.engagement_risk','advisor.engagement_risk_patients','advisor.revenue_risk']);
    if(analyticsActions.has(action)){
      const analytics=calculateAdvisorAnalytics({appointments:analyticsAppointments,invoices,availability,calls:callRecords.filter(call=>call.clinic_id===c.clinic_id),startDate:action==='advisor.capacity_utilization'?(availabilitySource?.coverage_start??row.start_date):row.start_date,endDate:action==='advisor.capacity_utilization'?(availabilitySource?.coverage_end??row.end_date):row.end_date,appointmentSource,availabilitySource,includePatientDetails:action==='advisor.engagement_risk_patients'});
      const field={
        'advisor.capacity_utilization':'capacity_utilization',
        'advisor.cancellation_rebooking':'cancellation_rebooking',
        'advisor.no_show_analytics':'no_show_analytics',
        'advisor.retention':'retention',
        'advisor.retention_cohorts':'retention_cohorts',
        'advisor.appointment_frequency_changes':'appointment_frequency_changes',
        'advisor.engagement_risk':'engagement_risk',
        'advisor.engagement_risk_patients':'engagement_risk',
        'advisor.revenue_risk':'revenue_risk'
      }[action];
      result[field]=analytics[field];
      result.analytics_source_limits=analytics.source_limits;
      if(action==='advisor.capacity_utilization')sources.push({source_name:'Juvonno appointment availability API',clinic_id:c.clinic_id,clinic_name:c.clinic_name,date_start:availabilitySource?.coverage_start??row.start_date,date_end:availabilitySource?.coverage_end??row.end_date,generated_at:generatedAt,freshness:'live',complete:availabilitySource?.complete===true});
    }
  }
  live.push(result);
  sources.push({source_name:'Juvonno API',clinic_id:c.clinic_id,clinic_name:c.clinic_name,date_start:row.start_date,date_end:row.end_date,generated_at:generatedAt,freshness:'live'});
}
const response={success:true,action,generated_at:generatedAt,data:{database_metrics:localMetrics,juvonno_live:live},sources};
if(action==='advisor.call_transcript_details')response.data.transcript_details=transcriptDetails;
if(['advisor.call_conversion','advisor.call_themes'].includes(action))response.data.call_analytics=calculateAdvisorAnalytics({calls:callRecords,startDate:row.start_date,endDate:row.end_date}).call_analytics;
return [{json:response}];`.trim();

// A failed page must reach the formatter so it can mark appointment-derived
// analytics partial; allowing the HTTP node to abort would hide that state.
node('GET Juvonno Advisor Data').onError = 'continueRegularOutput';

// Code nodes run once for all incoming items by default. Preserve every HTTP
// response and pair it with the corresponding safe request metadata; returning
// only one item here silently discards later appointment and availability
// responses before the formatter sees them.
node('Attach Safe Juvonno Request Metadata').parameters.jsCode = String.raw`
const requests=$('Prepare Native Juvonno HTTP Requests').all();
const responses=$input.all();
return responses.map((item,index)=>{
  const pairedIndex=Number.isInteger(item?.pairedItem?.item)?item.pairedItem.item:index;
  const meta=requests[pairedIndex]?.json??requests[index]?.json??{};
  const {api_key,...safeMeta}=meta;
  return {json:{request:safeMeta,provider_response:item?.json??{}},pairedItem:{item:index}};
});`.trim();

workflow.settings = {
  ...(workflow.settings || {}),
  executionOrder: 'v1',
  saveDataErrorExecution: 'none',
  saveDataSuccessExecution: 'none',
  saveManualExecutions: false,
  saveExecutionProgress: false,
};

fs.writeFileSync(target, JSON.stringify(workflow, null, 2) + '\n');
console.log(target);

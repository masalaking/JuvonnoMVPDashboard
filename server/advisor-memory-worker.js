import { claimMemoryJob, finishMemoryJob, getJobContext, upsertMemory, purgeExpiredMemories } from './advisor-store.js';
import { extractMemories, createEmbedding } from './advisor-agent.js';

let working = false;
export async function processAdvisorMemoryJobs(apiKey) {
  if (working || !apiKey) return;
  working = true;
  try {
    const job = await claimMemoryJob();
    if (!job) return;
    try {
      const context = await getJobContext(job);
      if (!context) return finishMemoryJob(job.id, job.tenant_id);
      const memories = await extractMemories(apiKey, context.messages);
      for (const memory of memories) {
        if (!memory?.content || !['patient','clinic','business_preference','operational_insight'].includes(memory.type)) continue;
        const embedding = await createEmbedding(apiKey, memory.content);
        await upsertMemory({ tenantId:context.tenant_id,userId:context.user_id,clinicIds:context.clinic_scope,memoryType:memory.type,content:memory.content,embedding,patientExternalId:memory.patient_external_id,conversationId:job.conversation_id,messageId:job.source_message_id });
      }
      await finishMemoryJob(job.id, job.tenant_id);
    } catch (error) { await finishMemoryJob(job.id, job.tenant_id, error?.message ?? error); }
  } finally { working=false; }
}

export function startAdvisorMemoryWorker(apiKey) {
  const timer=setInterval(()=>processAdvisorMemoryJobs(apiKey).catch(()=>{}),30_000);
  timer.unref?.();
  // Retention is enforced independently of normal chat traffic. This remains
  // safe to run from multiple instances because the UPDATE is idempotent.
  const retentionTimer=setInterval(()=>purgeExpiredMemories().catch(()=>{}),60 * 60_000);
  retentionTimer.unref?.();
  return timer;
}

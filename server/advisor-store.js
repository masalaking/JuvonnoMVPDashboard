import crypto from 'crypto';
import { prisma } from './db.js';
import { encryptAdvisorText, decryptAdvisorText, advisorSensitiveHash } from './advisor-crypto.js';

const EMBEDDING_DIMENSIONS = 1536;
const MEMORY_DISTANCE_THRESHOLD = Number(process.env.ADVISOR_MEMORY_DISTANCE_THRESHOLD ?? 0.55);
const MEMORY_DEDUPE_DISTANCE = Number(process.env.ADVISOR_MEMORY_DEDUPE_DISTANCE ?? 0.12);

function vectorLiteral(embedding) {
  if (!Array.isArray(embedding) || embedding.length !== EMBEDDING_DIMENSIONS || embedding.some(value => !Number.isFinite(value))) {
    const error = new Error(`Advisor memory requires a valid ${EMBEDDING_DIMENSIONS}-dimension embedding.`);
    error.status = 422;
    error.code = 'INVALID_ADVISOR_EMBEDDING';
    throw error;
  }
  return `[${embedding.map(Number).join(',')}]`;
}

function storageError(error) {
  if (error?.code === 'P2010' || /advisor_(conversations|messages|memories)/i.test(error?.message ?? '')) {
    const wrapped = new Error('The Advisor database migration has not been applied.');
    wrapped.status = 503;
    wrapped.code = 'ADVISOR_STORAGE_NOT_READY';
    return wrapped;
  }
  return error;
}

export async function createConversation({ tenantId, userId, title, clinicIds }) {
  const id = crypto.randomUUID();
  try {
    const rows = await prisma.$queryRawUnsafe(`
      INSERT INTO advisor_conversations (id, tenant_id, user_id, title, clinic_scope)
      VALUES ($1,$2,$3,$4,$5::jsonb)
      RETURNING id, title, status, clinic_scope, created_at, updated_at, last_message_at`,
      id, tenantId, userId, title || 'New conversation', JSON.stringify(clinicIds));
    return rows[0];
  } catch (error) { throw storageError(error); }
}

export async function listConversations(tenantId, userId) {
  try {
    return await prisma.$queryRawUnsafe(`
      SELECT id,title,status,clinic_scope,created_at,updated_at,last_message_at
      FROM advisor_conversations
      WHERE tenant_id=$1 AND user_id=$2 AND status <> 'deleted' AND deleted_at IS NULL
      ORDER BY last_message_at DESC NULLS LAST, created_at DESC LIMIT 100`, tenantId, userId);
  } catch (error) { throw storageError(error); }
}

export async function getConversation(tenantId, userId, id) {
  try {
    const rows = await prisma.$queryRawUnsafe(`SELECT * FROM advisor_conversations WHERE id=$1 AND tenant_id=$2 AND user_id=$3 AND deleted_at IS NULL`, id, tenantId, userId);
    return rows[0] ?? null;
  } catch (error) { throw storageError(error); }
}

export async function listMessages(tenantId, userId, conversationId, limit = 100) {
  try {
    const rows = await prisma.$queryRawUnsafe(`
      SELECT recent.* FROM (
        SELECT m.* FROM advisor_messages m JOIN advisor_conversations c ON c.id=m.conversation_id
        WHERE m.conversation_id=$1 AND m.tenant_id=$2 AND c.user_id=$3 AND m.deleted_at IS NULL
        ORDER BY m.created_at DESC LIMIT $4
      ) recent ORDER BY recent.created_at ASC`, conversationId, tenantId, userId, Math.max(1, Math.min(Number(limit) || 100, 100)));
    return rows.map(row => ({ id: row.id, role: row.role, content: decryptAdvisorText(row), model: row.model, responseMode: row.response_mode, sources: row.sources ?? [], createdAt: row.created_at }));
  } catch (error) { throw storageError(error); }
}

export async function saveMessage({ conversationId, tenantId, userId, role, content, model = null, responseMode = 'live', toolCalls = [], sources = [], tokenUsage = {} }) {
  const id = crypto.randomUUID();
  const encrypted = encryptAdvisorText(content);
  try {
    await prisma.$executeRawUnsafe(`
      INSERT INTO advisor_messages (id,conversation_id,tenant_id,user_id,role,content_ciphertext,content_iv,content_auth_tag,encryption_key_version,model,response_mode,tool_calls,sources,token_usage)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb,$13::jsonb,$14::jsonb)`,
      id, conversationId, tenantId, userId, role, encrypted.ciphertext, encrypted.iv, encrypted.authTag, encrypted.keyVersion, model, responseMode, JSON.stringify(toolCalls), JSON.stringify(sources), JSON.stringify(tokenUsage));
    await prisma.$executeRawUnsafe(`UPDATE advisor_conversations SET updated_at=NOW(),last_message_at=NOW(),title=CASE WHEN title='New conversation' AND $2='user' THEN LEFT($3,80) ELSE title END WHERE id=$1`, conversationId, role, content);
    return id;
  } catch (error) { throw storageError(error); }
}

export async function archiveConversation(tenantId, userId, id) {
  const count = await prisma.$executeRawUnsafe(`UPDATE advisor_conversations SET status='archived',updated_at=NOW() WHERE id=$1 AND tenant_id=$2 AND user_id=$3 AND deleted_at IS NULL`, id, tenantId, userId);
  return count > 0;
}

export async function deleteConversation(tenantId, userId, id) {
  return prisma.$transaction(async tx => {
    const owned = await tx.$queryRawUnsafe(`SELECT id FROM advisor_conversations WHERE id=$1 AND tenant_id=$2 AND user_id=$3 AND deleted_at IS NULL FOR UPDATE`, id, tenantId, userId);
    if (!owned[0]) return false;
    // Preserve an auditable, recoverable deletion trail. The retention worker
    // performs the final purge after the configured recovery window.
    await tx.$executeRawUnsafe(`UPDATE advisor_memories SET deleted_at=NOW(),updated_at=NOW() WHERE source_conversation_id=$1 AND user_id=$2 AND deleted_at IS NULL`, id, userId);
    await tx.$executeRawUnsafe(`UPDATE advisor_conversations SET status='deleted',deleted_at=NOW(),updated_at=NOW() WHERE id=$1`, id);
    return true;
  });
}

export async function queueMemoryJob(tenantId, conversationId, sourceMessageId) {
  await prisma.$executeRawUnsafe(`INSERT INTO advisor_memory_jobs (id,tenant_id,conversation_id,source_message_id) VALUES ($1,$2,$3,$4) ON CONFLICT (source_message_id) DO NOTHING`, crypto.randomUUID(), tenantId, conversationId, sourceMessageId);
}

export async function claimMemoryJob() {
  return prisma.$transaction(async tx => {
    const rows = await tx.$queryRawUnsafe(`SELECT * FROM advisor_memory_jobs WHERE status IN ('pending','retry') AND available_at<=NOW() ORDER BY created_at LIMIT 1 FOR UPDATE SKIP LOCKED`);
    if (!rows[0]) return null;
    await tx.$executeRawUnsafe(`UPDATE advisor_memory_jobs SET status='processing',attempt_count=attempt_count+1 WHERE id=$1`, rows[0].id);
    return rows[0];
  });
}

export async function finishMemoryJob(id, tenantId, error = null) {
  if (!error) return prisma.$executeRawUnsafe(`UPDATE advisor_memory_jobs SET status='completed',completed_at=NOW(),last_error=NULL WHERE id=$1 AND tenant_id=$2`, id, tenantId);
  return prisma.$executeRawUnsafe(`UPDATE advisor_memory_jobs SET status=CASE WHEN attempt_count>=5 THEN 'failed' ELSE 'retry' END,last_error=$3,available_at=NOW()+(LEAST(attempt_count,5)*INTERVAL '5 minutes') WHERE id=$1 AND tenant_id=$2`, id, tenantId, String(error).slice(0, 500));
}

export async function getJobContext(job) {
  const conversation = await prisma.$queryRawUnsafe(`SELECT tenant_id,user_id,clinic_scope FROM advisor_conversations WHERE id=$1 AND tenant_id=$2 AND deleted_at IS NULL`, job.conversation_id, job.tenant_id);
  if (!conversation[0]) return null;
  const messages = await listMessages(conversation[0].tenant_id, conversation[0].user_id, job.conversation_id, 12);
  return { ...conversation[0], messages };
}

export async function upsertMemory({ tenantId, userId, clinicIds, memoryType, content, embedding, patientExternalId = null, conversationId, messageId }) {
  const contentHash = advisorSensitiveHash(content);
  const patientHash = patientExternalId ? advisorSensitiveHash(patientExternalId) : null;
  const encrypted = encryptAdvisorText(content);
  const vector = vectorLiteral(embedding);
  const id = crypto.randomUUID();
  // Patient context is intentionally never tenant-shared. Business context is
  // useful across an owner's authorized clinics, but remains tenant-bound.
  const visibility = memoryType === 'patient' ? 'clinic_shared' : 'tenant_shared';
  const sensitivity = memoryType === 'patient' ? 'patient' : 'business';
  await prisma.$transaction(async tx => {
    let existing = await tx.$queryRawUnsafe(`SELECT id FROM advisor_memories WHERE tenant_id=$1 AND user_id=$2 AND content_hash=$3 AND deleted_at IS NULL LIMIT 1`, tenantId, userId, contentHash);
    if (!existing[0] && clinicIds.length) {
      existing = await tx.$queryRawUnsafe(`
        SELECT DISTINCT m.id, (m.embedding <=> $5::vector) AS distance
        FROM advisor_memories m JOIN advisor_memory_clinics mc ON mc.memory_id=m.id
        WHERE m.tenant_id=$1 AND m.user_id=$2 AND m.memory_type=$3
          AND mc.clinic_id=ANY($4::text[]) AND m.deleted_at IS NULL AND m.embedding IS NOT NULL
          AND (m.embedding <=> $5::vector) <= $6
        ORDER BY distance LIMIT 1`, tenantId, userId, memoryType, clinicIds, vector, MEMORY_DEDUPE_DISTANCE);
    }
    const memoryId = existing[0]?.id ?? id;
    if (existing[0]) {
      await tx.$executeRawUnsafe(`UPDATE advisor_memories SET content_ciphertext=$2,content_iv=$3,content_auth_tag=$4,embedding=$5::vector,visibility=$6,sensitivity=$7,retention_until=NOW()+INTERVAL '12 months',updated_at=NOW(),deleted_at=NULL WHERE id=$1`, memoryId, encrypted.ciphertext, encrypted.iv, encrypted.authTag, vector, visibility, sensitivity);
    } else {
      await tx.$executeRawUnsafe(`INSERT INTO advisor_memories (id,tenant_id,user_id,owner_user_id,memory_type,visibility,sensitivity,retention_until,content_ciphertext,content_iv,content_auth_tag,encryption_key_version,embedding,content_hash,patient_external_id_hash,source_conversation_id,source_message_id) VALUES ($1,$2,$3,$3,$4,$5,$6,NOW()+INTERVAL '12 months',$7,$8,$9,$10,$11::vector,$12,$13,$14,$15)`, memoryId, tenantId, userId, memoryType, visibility, sensitivity, encrypted.ciphertext, encrypted.iv, encrypted.authTag, encrypted.keyVersion, vector, contentHash, patientHash, conversationId, messageId);
    }
    await tx.$executeRawUnsafe(`DELETE FROM advisor_memory_clinics WHERE memory_id=$1`, memoryId);
    for (const clinicId of clinicIds) await tx.$executeRawUnsafe(`INSERT INTO advisor_memory_clinics (memory_id,tenant_id,clinic_id) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING`, memoryId, tenantId, clinicId);
  });
}

export async function searchMemories({ tenantId, userId, clinicIds, embedding, limit = 6 }) {
  if (!clinicIds.length) return [];
  const vector = vectorLiteral(embedding);
  const rows = await prisma.$queryRawUnsafe(`
    SELECT DISTINCT m.id, m.memory_type, m.content_ciphertext, m.content_iv,
      m.content_auth_tag, m.encryption_key_version,
      (m.embedding <=> $4::vector) AS distance
    FROM advisor_memories m JOIN advisor_memory_clinics mc ON mc.memory_id=m.id
    WHERE m.tenant_id=$1
      AND (
        (m.visibility='private' AND m.user_id=$2)
        OR (m.visibility='tenant_shared' AND mc.clinic_id=ANY($3::text[]))
        OR (m.visibility='clinic_shared' AND mc.clinic_id=ANY($3::text[]))
      )
      AND m.deleted_at IS NULL AND m.embedding IS NOT NULL
      AND (m.embedding <=> $4::vector) <= $6
    ORDER BY distance LIMIT $5`, tenantId, userId, clinicIds, vector, Math.max(1, Math.min(Number(limit) || 6, 12)), MEMORY_DISTANCE_THRESHOLD);
  await Promise.all(rows.map(row => prisma.$executeRawUnsafe(`UPDATE advisor_memories SET last_used_at=NOW() WHERE id=$1`, row.id)));
  return rows.map(row => ({ id: row.id, type: row.memory_type, content: decryptAdvisorText(row), distance: Number(row.distance) }));
}

export async function listMemories(tenantId, userId, search = '') {
  try {
    // Never select the vector itself: Prisma 5 cannot deserialize pgvector's
    // native type. Similarity stays inside PostgreSQL and only supported
    // scalar/encrypted columns cross the ORM boundary.
    const rows = await prisma.$queryRawUnsafe(`
      SELECT id,memory_type,visibility,sensitivity,content_ciphertext,content_iv,content_auth_tag,
        encryption_key_version,created_at,updated_at,retention_until
      FROM advisor_memories
      WHERE tenant_id=$1 AND (user_id=$2 OR visibility='tenant_shared') AND deleted_at IS NULL
      ORDER BY updated_at DESC LIMIT 100`, tenantId, userId);
    const clean = String(search).trim().toLowerCase();
    return rows.map(row => ({ id: row.id, type: row.memory_type, visibility: row.visibility, sensitivity: row.sensitivity, content: decryptAdvisorText(row), createdAt: row.created_at, updatedAt: row.updated_at, retentionUntil: row.retention_until })).filter(row => !clean || row.content.toLowerCase().includes(clean));
  } catch (error) { throw storageError(error); }
}

export async function deleteMemory(tenantId, userId, id) {
  return (await prisma.$executeRawUnsafe(`UPDATE advisor_memories SET deleted_at=NOW(),updated_at=NOW() WHERE id=$1 AND tenant_id=$2 AND (user_id=$3 OR visibility='tenant_shared') AND deleted_at IS NULL`, id, tenantId, userId)) > 0;
}

export async function purgeExpiredMemories() {
  return prisma.$executeRawUnsafe(`
    UPDATE advisor_memories
    SET deleted_at=NOW(),updated_at=NOW()
    WHERE retention_until IS NOT NULL
      AND retention_until <= NOW()
      AND deleted_at IS NULL
  `);
}

export async function auditAdvisor({ tenantId, userId, clinicIds = [], eventType, toolName = null, status = 'success', correlationId, metadata = {} }) {
  await prisma.$executeRawUnsafe(`INSERT INTO advisor_audit_events (id,tenant_id,user_id,clinic_scope,event_type,tool_name,result_status,correlation_id,metadata) VALUES ($1,$2,$3,$4::jsonb,$5,$6,$7,$8,$9::jsonb)`, crypto.randomUUID(), tenantId, userId, JSON.stringify(clinicIds), eventType, toolName, status, correlationId, JSON.stringify(metadata));
}

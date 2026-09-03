import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const migrationUrl = new URL('../prisma/migrations/20260828000000_add_clinic_advisor_storage/migration.sql', import.meta.url);
const tenantScopeMigrationUrl = new URL('../prisma/migrations/20260903000000_scope_advisor_memory_jobs/migration.sql', import.meta.url);

test('Advisor storage migration provisions every encrypted, tenant-scoped store', async () => {
  const sql = await readFile(fileURLToPath(migrationUrl), 'utf8');
  for (const table of [
    'advisor_conversations',
    'advisor_messages',
    'advisor_memories',
    'advisor_memory_clinics',
    'advisor_memory_jobs',
    'advisor_audit_events',
    'advisor_recommendations',
  ]) {
    assert.match(sql, new RegExp(`CREATE TABLE IF NOT EXISTS ${table}\\b`));
  }
  assert.match(sql, /CREATE EXTENSION IF NOT EXISTS vector/);
  assert.match(sql, /embedding vector\(1536\)/);
  assert.match(sql, /tenant_id TEXT NOT NULL REFERENCES tenants\(id\)/);
  assert.match(sql, /FOREIGN KEY \(tenant_id, clinic_id\)\s+REFERENCES clinic_configs\(tenant_id, clinic_id\)/);
  assert.match(sql, /content_ciphertext TEXT NOT NULL/);
  assert.match(sql, /content_iv TEXT NOT NULL/);
  assert.match(sql, /content_auth_tag TEXT NOT NULL/);
  assert.match(sql, /implementation_status TEXT NOT NULL DEFAULT 'suggested'/);
  assert.match(sql, /FOREIGN KEY \(tenant_id, clinic_id\)\s+REFERENCES clinic_configs\(tenant_id, clinic_id\)/);
  assert.match(sql, /FROM pg_indexes/);
  assert.match(sql, /USING hnsw \(embedding vector_cosine_ops\)/);
  assert.doesNotMatch(sql, /CREATE INDEX IF NOT EXISTS advisor_memories_embedding_hnsw_idx/);
});

test('Advisor memory jobs receive durable tenant scope with an integrity-preserving backfill', async () => {
  const sql = await readFile(fileURLToPath(tenantScopeMigrationUrl), 'utf8');
  assert.match(sql, /ADD COLUMN IF NOT EXISTS tenant_id TEXT/);
  assert.match(sql, /SET tenant_id = conversation\.tenant_id/);
  assert.match(sql, /Cannot scope existing advisor_memory_jobs to a tenant/);
  assert.match(sql, /ALTER COLUMN tenant_id SET NOT NULL/);
  assert.match(sql, /advisor_memory_jobs_tenant_fk/);
  assert.match(sql, /FOREIGN KEY \(source_message_id, conversation_id, tenant_id\)/);
  assert.match(sql, /REFERENCES advisor_messages\(id, conversation_id, tenant_id\)/);
  assert.match(sql, /advisor_memory_jobs_tenant_status_idx/);
});

test('Advisor memory-job runtime writes and completes work under tenant scope', async () => {
  const [store, worker, server] = await Promise.all([
    readFile(fileURLToPath(new URL('./advisor-store.js', import.meta.url)), 'utf8'),
    readFile(fileURLToPath(new URL('./advisor-memory-worker.js', import.meta.url)), 'utf8'),
    readFile(fileURLToPath(new URL('./index.js', import.meta.url)), 'utf8'),
  ]);
  assert.match(store, /queueMemoryJob\(tenantId, conversationId, sourceMessageId\)/);
  assert.match(store, /INSERT INTO advisor_memory_jobs \(id,tenant_id,conversation_id,source_message_id\)/);
  assert.match(store, /WHERE id=\$1 AND tenant_id=\$2/);
  assert.match(store, /WHERE id=\$1 AND tenant_id=\$2 AND deleted_at IS NULL/);
  assert.match(worker, /finishMemoryJob\(job\.id, job\.tenant_id/);
  assert.match(server, /queueMemoryJob\(req\.session\.tenantId, conversation\.id, assistantMessageId\)/);
});

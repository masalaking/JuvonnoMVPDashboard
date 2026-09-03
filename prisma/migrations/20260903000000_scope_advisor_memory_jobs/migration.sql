-- Advisor memory jobs are tenant-owned work items.  The original additive
-- Advisor storage migration safely derived scope through the conversation,
-- but did not persist it on the job itself.  Backfill before adding NOT NULL
-- and composite integrity constraints so existing queued work is preserved.

ALTER TABLE advisor_memory_jobs
  ADD COLUMN IF NOT EXISTS tenant_id TEXT;

UPDATE advisor_memory_jobs job
SET tenant_id = conversation.tenant_id
FROM advisor_conversations conversation
WHERE conversation.id = job.conversation_id
  AND job.tenant_id IS NULL;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM advisor_memory_jobs WHERE tenant_id IS NULL) THEN
    RAISE EXCEPTION 'Cannot scope existing advisor_memory_jobs to a tenant';
  END IF;
END $$;

ALTER TABLE advisor_memory_jobs
  ALTER COLUMN tenant_id SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'advisor_memory_jobs_tenant_fk'
      AND conrelid = 'advisor_memory_jobs'::regclass
  ) THEN
    ALTER TABLE advisor_memory_jobs
      ADD CONSTRAINT advisor_memory_jobs_tenant_fk
      FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;
  END IF;

  -- This triple ensures a job cannot pair a message with another
  -- conversation or tenant, even if a future runtime query is changed.
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'advisor_messages_id_conversation_tenant_uidx'
      AND conrelid = 'advisor_messages'::regclass
  ) THEN
    ALTER TABLE advisor_messages
      ADD CONSTRAINT advisor_messages_id_conversation_tenant_uidx
      UNIQUE (id, conversation_id, tenant_id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'advisor_memory_jobs_message_scope_fk'
      AND conrelid = 'advisor_memory_jobs'::regclass
  ) THEN
    ALTER TABLE advisor_memory_jobs
      ADD CONSTRAINT advisor_memory_jobs_message_scope_fk
      FOREIGN KEY (source_message_id, conversation_id, tenant_id)
      REFERENCES advisor_messages(id, conversation_id, tenant_id)
      ON DELETE CASCADE;
  END IF;
END $$;

-- Preserves the existing global worker claim order while making tenant
-- attribution available for audited processing and scoped updates.
CREATE INDEX IF NOT EXISTS advisor_memory_jobs_tenant_status_idx
  ON advisor_memory_jobs (tenant_id, status, available_at, created_at);

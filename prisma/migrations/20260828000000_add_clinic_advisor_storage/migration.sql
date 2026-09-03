-- RivaCare Clinic Advisor: encrypted conversations, auditable semantic memory,
-- and background memory jobs.  The Advisor deliberately uses its own storage
-- instead of copying Juvonno patient or appointment records into the app DB.
-- All read/write paths must still derive tenant and clinic scope from the
-- authenticated session and user_clinic_access.

CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS advisor_conversations (
  id UUID PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title TEXT NOT NULL DEFAULT 'New conversation',
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived', 'deleted')),
  clinic_scope JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_message_at TIMESTAMPTZ,
  deleted_at TIMESTAMPTZ,
  CONSTRAINT advisor_conversations_scope_is_array CHECK (jsonb_typeof(clinic_scope) = 'array')
);

CREATE INDEX IF NOT EXISTS advisor_conversations_owner_recent_idx
  ON advisor_conversations (tenant_id, user_id, last_message_at DESC, created_at DESC)
  WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS advisor_messages (
  id UUID PRIMARY KEY,
  conversation_id UUID NOT NULL REFERENCES advisor_conversations(id) ON DELETE CASCADE,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
  content_ciphertext TEXT NOT NULL,
  content_iv TEXT NOT NULL,
  content_auth_tag TEXT NOT NULL,
  encryption_key_version TEXT NOT NULL,
  model TEXT,
  response_mode TEXT NOT NULL DEFAULT 'live',
  tool_calls JSONB NOT NULL DEFAULT '[]'::jsonb,
  sources JSONB NOT NULL DEFAULT '[]'::jsonb,
  token_usage JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ,
  CONSTRAINT advisor_messages_tool_calls_is_array CHECK (jsonb_typeof(tool_calls) = 'array'),
  CONSTRAINT advisor_messages_sources_is_array CHECK (jsonb_typeof(sources) = 'array')
);

CREATE INDEX IF NOT EXISTS advisor_messages_conversation_recent_idx
  ON advisor_messages (conversation_id, tenant_id, created_at DESC)
  WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS advisor_memories (
  id UUID PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  owner_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  memory_type TEXT NOT NULL CHECK (memory_type IN ('business_preference', 'clinic', 'patient', 'operational_insight')),
  visibility TEXT NOT NULL CHECK (visibility IN ('private', 'tenant_shared', 'clinic_shared')),
  sensitivity TEXT NOT NULL CHECK (sensitivity IN ('business', 'patient')),
  retention_until TIMESTAMPTZ NOT NULL,
  content_ciphertext TEXT NOT NULL,
  content_iv TEXT NOT NULL,
  content_auth_tag TEXT NOT NULL,
  encryption_key_version TEXT NOT NULL,
  embedding vector(1536),
  content_hash TEXT NOT NULL,
  patient_external_id_hash TEXT,
  source_conversation_id UUID REFERENCES advisor_conversations(id) ON DELETE SET NULL,
  source_message_id UUID REFERENCES advisor_messages(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_used_at TIMESTAMPTZ,
  deleted_at TIMESTAMPTZ,
  CONSTRAINT advisor_memories_patient_scope CHECK (
    (sensitivity = 'patient' AND visibility = 'clinic_shared')
    OR (sensitivity = 'business' AND visibility IN ('private', 'tenant_shared', 'clinic_shared'))
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS advisor_memories_owner_content_uidx
  ON advisor_memories (tenant_id, user_id, content_hash)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS advisor_memories_retrieval_idx
  ON advisor_memories (tenant_id, user_id, memory_type, retention_until)
  WHERE deleted_at IS NULL;

-- HNSW keeps semantic retrieval bounded as the owner accumulates durable
-- context. Some existing deployments already have the equivalent index under
-- a legacy name, so check the definition as well as the intended name before
-- attempting an expensive duplicate vector-index build.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_indexes
    WHERE schemaname = 'public'
      AND tablename = 'advisor_memories'
      AND indexdef ILIKE '%USING hnsw (embedding vector_cosine_ops)%'
  ) THEN
    CREATE INDEX advisor_memories_embedding_hnsw_idx
      ON advisor_memories USING hnsw (embedding vector_cosine_ops)
      WHERE deleted_at IS NULL AND embedding IS NOT NULL;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS advisor_memory_clinics (
  memory_id UUID NOT NULL REFERENCES advisor_memories(id) ON DELETE CASCADE,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  clinic_id TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (memory_id, clinic_id),
  FOREIGN KEY (tenant_id, clinic_id)
    REFERENCES clinic_configs(tenant_id, clinic_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS advisor_memory_clinics_scope_idx
  ON advisor_memory_clinics (tenant_id, clinic_id, memory_id);

CREATE TABLE IF NOT EXISTS advisor_memory_jobs (
  id UUID PRIMARY KEY,
  conversation_id UUID NOT NULL REFERENCES advisor_conversations(id) ON DELETE CASCADE,
  source_message_id UUID NOT NULL REFERENCES advisor_messages(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'retry', 'completed', 'failed')),
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  available_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  UNIQUE (source_message_id)
);

CREATE INDEX IF NOT EXISTS advisor_memory_jobs_claim_idx
  ON advisor_memory_jobs (available_at, created_at)
  WHERE status IN ('pending', 'retry');

CREATE TABLE IF NOT EXISTS advisor_audit_events (
  id UUID PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  clinic_scope JSONB NOT NULL DEFAULT '[]'::jsonb,
  event_type TEXT NOT NULL,
  tool_name TEXT,
  result_status TEXT NOT NULL DEFAULT 'success',
  correlation_id UUID NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT advisor_audit_events_scope_is_array CHECK (jsonb_typeof(clinic_scope) = 'array')
);

CREATE INDEX IF NOT EXISTS advisor_audit_events_tenant_recent_idx
  ON advisor_audit_events (tenant_id, created_at DESC);

CREATE INDEX IF NOT EXISTS advisor_audit_events_correlation_idx
  ON advisor_audit_events (correlation_id);

-- A recommendation belongs to exactly one clinic. Cross-clinic comparisons
-- may surface a finding, but implementation and before/after measurement are
-- always recorded against the clinic that owns the intervention.
CREATE TABLE IF NOT EXISTS advisor_recommendations (
  id UUID PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  clinic_id TEXT NOT NULL,
  category TEXT NOT NULL,
  title TEXT NOT NULL,
  problem_identified TEXT NOT NULL,
  evidence JSONB NOT NULL DEFAULT '[]'::jsonb,
  baseline_metric JSONB,
  baseline_start_date DATE,
  baseline_end_date DATE,
  recommended_action TEXT NOT NULL,
  target_metric JSONB,
  target_improvement TEXT,
  implementation_status TEXT NOT NULL DEFAULT 'suggested'
    CHECK (implementation_status IN ('suggested', 'accepted', 'in_progress', 'implemented', 'monitoring', 'improved', 'no_change', 'declined', 'reverted')),
  implementation_date DATE,
  review_date DATE,
  current_metric JSONB,
  percentage_change NUMERIC(12, 4),
  estimated_financial_impact JSONB,
  result_status TEXT,
  sources JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  FOREIGN KEY (tenant_id, clinic_id)
    REFERENCES clinic_configs(tenant_id, clinic_id) ON DELETE CASCADE,
  CONSTRAINT advisor_recommendations_evidence_is_array CHECK (jsonb_typeof(evidence) = 'array'),
  CONSTRAINT advisor_recommendations_sources_is_array CHECK (jsonb_typeof(sources) = 'array'),
  CONSTRAINT advisor_recommendations_baseline_dates_valid CHECK (
    baseline_start_date IS NULL OR baseline_end_date IS NULL OR baseline_start_date <= baseline_end_date
  )
);

CREATE INDEX IF NOT EXISTS advisor_recommendations_clinic_status_idx
  ON advisor_recommendations (tenant_id, clinic_id, implementation_status, created_at DESC);

CREATE INDEX IF NOT EXISTS advisor_recommendations_review_idx
  ON advisor_recommendations (tenant_id, review_date)
  WHERE implementation_status IN ('implemented', 'monitoring');

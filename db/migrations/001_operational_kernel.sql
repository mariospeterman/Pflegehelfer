BEGIN;

CREATE TABLE IF NOT EXISTS pfh_schema_migrations (
  version integer PRIMARY KEY,
  applied_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS organizations (
  id text PRIMARY KEY,
  name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS departments (
  organization_id text NOT NULL REFERENCES organizations(id),
  id text NOT NULL,
  name text NOT NULL,
  PRIMARY KEY (organization_id, id)
);
CREATE TABLE IF NOT EXISTS workflow_templates (
  organization_id text NOT NULL REFERENCES organizations(id),
  id text NOT NULL,
  name text NOT NULL,
  eligible_roles text[] NOT NULL,
  active_version integer,
  activation_revision integer NOT NULL DEFAULT 0,
  PRIMARY KEY (organization_id, id)
);
CREATE TABLE IF NOT EXISTS workflow_template_versions (
  organization_id text NOT NULL,
  template_id text NOT NULL,
  version integer NOT NULL CHECK (version > 0),
  status text NOT NULL CHECK (status IN ('draft', 'published')),
  definition jsonb NOT NULL,
  definition_hash text NOT NULL CHECK (definition_hash ~ '^[a-f0-9]{64}$'),
  published_at timestamptz,
  published_by text,
  PRIMARY KEY (organization_id, template_id, version),
  FOREIGN KEY (organization_id, template_id) REFERENCES workflow_templates(organization_id, id)
);
CREATE TABLE IF NOT EXISTS assistant_threads (
  organization_id text NOT NULL REFERENCES organizations(id),
  id uuid NOT NULL,
  actor_id text NOT NULL,
  effective_role text NOT NULL,
  department_id text NOT NULL,
  next_sequence bigint NOT NULL DEFAULT 1,
  context_revision integer NOT NULL DEFAULT 0,
  patient_id text,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, id),
  FOREIGN KEY (organization_id, department_id) REFERENCES departments(organization_id, id)
);
CREATE TABLE IF NOT EXISTS working_sessions (
  organization_id text NOT NULL REFERENCES organizations(id),
  id uuid NOT NULL,
  actor_id text NOT NULL,
  effective_role text NOT NULL,
  department_id text NOT NULL,
  workflow_template_id text NOT NULL,
  workflow_version integer NOT NULL,
  assistant_thread_id uuid NOT NULL,
  current_step_id text NOT NULL,
  row_version integer NOT NULL DEFAULT 1,
  status text NOT NULL CHECK (status IN ('active', 'paused', 'completed')),
  started_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  PRIMARY KEY (organization_id, id),
  FOREIGN KEY (organization_id, workflow_template_id, workflow_version)
    REFERENCES workflow_template_versions(organization_id, template_id, version),
  FOREIGN KEY (organization_id, assistant_thread_id) REFERENCES assistant_threads(organization_id, id)
);
CREATE UNIQUE INDEX IF NOT EXISTS working_sessions_one_active_actor
  ON working_sessions (organization_id, actor_id) WHERE status = 'active';
CREATE TABLE IF NOT EXISTS workflow_step_instances (
  organization_id text NOT NULL,
  session_id uuid NOT NULL,
  step_id text NOT NULL,
  ordinal integer NOT NULL CHECK (ordinal > 0),
  status text NOT NULL CHECK (status IN ('open', 'completed', 'skipped')),
  evidence_refs jsonb NOT NULL DEFAULT '[]'::jsonb,
  opened_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  PRIMARY KEY (organization_id, session_id, step_id, ordinal),
  FOREIGN KEY (organization_id, session_id) REFERENCES working_sessions(organization_id, id)
);
CREATE TABLE IF NOT EXISTS assistant_messages (
  organization_id text NOT NULL,
  thread_id uuid NOT NULL,
  sequence bigint NOT NULL,
  id uuid NOT NULL,
  kind text NOT NULL CHECK (kind IN ('user', 'assistant', 'context', 'domain-event')),
  patient_id text,
  context_revision integer NOT NULL,
  input_modality text CHECK (input_modality IN ('typed', 'voice')),
  content jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, thread_id, sequence),
  UNIQUE (organization_id, id),
  FOREIGN KEY (organization_id, thread_id) REFERENCES assistant_threads(organization_id, id)
);

-- Compatibility upgrades for databases created by an earlier development
-- build. CREATE TABLE IF NOT EXISTS does not add columns to existing tables.
ALTER TABLE assistant_threads
  ADD COLUMN IF NOT EXISTS context_revision integer NOT NULL DEFAULT 0;
ALTER TABLE assistant_threads
  ADD COLUMN IF NOT EXISTS patient_id text;
ALTER TABLE assistant_messages
  ADD COLUMN IF NOT EXISTS context_revision integer NOT NULL DEFAULT 0;
ALTER TABLE assistant_messages
  ADD COLUMN IF NOT EXISTS patient_id text;
ALTER TABLE assistant_messages
  ADD COLUMN IF NOT EXISTS input_modality text;
CREATE TABLE IF NOT EXISTS safety_authority (
  organization_id text NOT NULL REFERENCES organizations(id),
  token_hash text NOT NULL CHECK (token_hash ~ '^[a-f0-9]{64}$'),
  authority_type text NOT NULL CHECK (authority_type IN ('intent', 'voice', 'approval')),
  actor_id text NOT NULL,
  session_id uuid NOT NULL,
  thread_id uuid NOT NULL,
  context_revision integer NOT NULL,
  patient_id text,
  binding jsonb NOT NULL,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  PRIMARY KEY (organization_id, token_hash)
);
CREATE TABLE IF NOT EXISTS command_receipts (
  organization_id text NOT NULL REFERENCES organizations(id),
  command_key text NOT NULL,
  request_hash text NOT NULL CHECK (request_hash ~ '^[a-f0-9]{64}$'),
  status_code integer NOT NULL,
  result_ref jsonb NOT NULL,
  expires_at timestamptz NOT NULL,
  PRIMARY KEY (organization_id, command_key)
);
CREATE TABLE IF NOT EXISTS domain_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  organization_id text NOT NULL REFERENCES organizations(id),
  aggregate_type text NOT NULL,
  aggregate_id text NOT NULL,
  event_type text NOT NULL,
  audience jsonb NOT NULL,
  payload jsonb NOT NULL,
  occurred_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS domain_events_replay ON domain_events (organization_id, id);
CREATE TABLE IF NOT EXISTS provider_outbox (
  organization_id text NOT NULL REFERENCES organizations(id),
  id uuid NOT NULL,
  provider_id text NOT NULL,
  profile_id text NOT NULL,
  operation text NOT NULL,
  idempotency_key text NOT NULL,
  payload jsonb NOT NULL,
  state text NOT NULL CHECK (state IN ('pending', 'leased', 'delivered', 'retry', 'manual', 'dead')),
  attempts integer NOT NULL DEFAULT 0,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  lease_owner text,
  lease_expires_at timestamptz,
  last_error_class text,
  PRIMARY KEY (organization_id, id),
  UNIQUE (organization_id, provider_id, profile_id, idempotency_key)
);
CREATE INDEX IF NOT EXISTS provider_outbox_due ON provider_outbox (organization_id, next_attempt_at)
  WHERE state IN ('pending', 'retry');
CREATE TABLE IF NOT EXISTS provider_inbox (
  organization_id text NOT NULL REFERENCES organizations(id),
  id uuid NOT NULL,
  provider_id text NOT NULL,
  profile_id text NOT NULL,
  external_id text NOT NULL,
  origin_version text,
  payload_hash text NOT NULL CHECK (payload_hash ~ '^[a-f0-9]{64}$'),
  mapping_version text NOT NULL,
  envelope jsonb NOT NULL,
  state text NOT NULL CHECK (state IN ('received', 'mapped', 'applied', 'quarantined', 'conflict')),
  error_class text,
  received_at timestamptz NOT NULL DEFAULT now(),
  applied_at timestamptz,
  PRIMARY KEY (organization_id, id),
  UNIQUE (organization_id, provider_id, profile_id, external_id, origin_version, payload_hash)
);
CREATE UNIQUE INDEX IF NOT EXISTS provider_inbox_versionless_dedupe
  ON provider_inbox (
    organization_id, provider_id, profile_id, external_id,
    COALESCE(origin_version, ''), payload_hash
  );
CREATE TABLE IF NOT EXISTS provider_cursors (
  organization_id text NOT NULL REFERENCES organizations(id),
  provider_id text NOT NULL,
  profile_id text NOT NULL,
  cursor_value text NOT NULL,
  row_version integer NOT NULL DEFAULT 1,
  PRIMARY KEY (organization_id, provider_id, profile_id)
);
CREATE TABLE IF NOT EXISTS provider_receipts (
  organization_id text NOT NULL REFERENCES organizations(id),
  id uuid NOT NULL,
  provider_id text NOT NULL,
  outbox_id uuid,
  inbox_id uuid,
  external_reference text,
  acknowledgement_hash text,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, id)
);
CREATE TABLE IF NOT EXISTS sync_conflicts (
  organization_id text NOT NULL REFERENCES organizations(id),
  id uuid NOT NULL,
  patient_id text NOT NULL,
  provider_id text NOT NULL,
  local_reference text NOT NULL,
  provider_reference text,
  local_version text NOT NULL,
  provider_version text,
  status text NOT NULL,
  assigned_role text,
  created_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz,
  PRIMARY KEY (organization_id, id)
);
CREATE TABLE IF NOT EXISTS audit_entries (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  organization_id text NOT NULL REFERENCES organizations(id),
  actor_id text NOT NULL,
  actor_role text NOT NULL,
  action text NOT NULL,
  outcome text NOT NULL,
  patient_id text,
  purpose text NOT NULL,
  detail jsonb NOT NULL,
  previous_hash text NOT NULL,
  entry_hash text NOT NULL,
  occurred_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS analytics_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  organization_id text NOT NULL REFERENCES organizations(id),
  event_name text NOT NULL,
  bounded_dimensions jsonb NOT NULL,
  occurred_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS handover_snapshots (
  organization_id text NOT NULL REFERENCES organizations(id),
  id uuid NOT NULL,
  department_id text NOT NULL,
  shift_key text NOT NULL,
  version integer NOT NULL CHECK (version > 0),
  patient_ids text[] NOT NULL,
  cutoff_at timestamptz NOT NULL,
  source_hash text NOT NULL CHECK (source_hash ~ '^[a-f0-9]{64}$'),
  status text NOT NULL CHECK (status IN ('open', 'transferred', 'acknowledged')),
  created_by text NOT NULL,
  receiving_actor_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, id),
  UNIQUE (organization_id, department_id, shift_key, version)
);
CREATE TABLE IF NOT EXISTS handover_acknowledgements (
  organization_id text NOT NULL,
  handover_id uuid NOT NULL,
  patient_id text NOT NULL,
  version integer NOT NULL,
  actor_id text NOT NULL,
  status text NOT NULL CHECK (status IN ('acknowledged', 'question', 'later')),
  acknowledged_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, handover_id, patient_id, actor_id),
  FOREIGN KEY (organization_id, handover_id) REFERENCES handover_snapshots(organization_id, id)
);
CREATE TABLE IF NOT EXISTS work_episodes (
  organization_id text NOT NULL REFERENCES organizations(id),
  id uuid NOT NULL,
  session_id uuid NOT NULL,
  actor_id text NOT NULL,
  patient_id text NOT NULL,
  encounter_id text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('planned', 'spontaneous', 'alarm')),
  title text NOT NULL,
  state text NOT NULL CHECK (state IN ('active', 'paused', 'completed', 'deferred')),
  row_version integer NOT NULL DEFAULT 1,
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  completion_evidence text,
  PRIMARY KEY (organization_id, id),
  FOREIGN KEY (organization_id, session_id) REFERENCES working_sessions(organization_id, id)
);
CREATE UNIQUE INDEX IF NOT EXISTS work_episodes_one_active_actor
  ON work_episodes (organization_id, actor_id) WHERE state = 'active';
CREATE TABLE IF NOT EXISTS work_episode_segments (
  organization_id text NOT NULL,
  episode_id uuid NOT NULL,
  ordinal integer NOT NULL CHECK (ordinal > 0),
  started_at timestamptz NOT NULL,
  ended_at timestamptz,
  end_reason text CHECK (end_reason IN ('pause', 'interruption', 'complete', 'correction')),
  PRIMARY KEY (organization_id, episode_id, ordinal),
  FOREIGN KEY (organization_id, episode_id) REFERENCES work_episodes(organization_id, id)
);
CREATE TABLE IF NOT EXISTS service_evidence (
  organization_id text NOT NULL REFERENCES organizations(id),
  id uuid NOT NULL,
  episode_id uuid NOT NULL,
  actor_id text NOT NULL,
  patient_id text NOT NULL,
  actual_started_at timestamptz NOT NULL,
  actual_ended_at timestamptz NOT NULL,
  interruption_seconds integer NOT NULL DEFAULT 0 CHECK (interruption_seconds >= 0),
  review_status text NOT NULL CHECK (review_status IN ('draft', 'reviewed')),
  billing_status text NOT NULL DEFAULT 'not-evaluated' CHECK (billing_status = 'not-evaluated'),
  correction_of uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, id),
  UNIQUE (organization_id, episode_id),
  FOREIGN KEY (organization_id, episode_id) REFERENCES work_episodes(organization_id, id)
);

INSERT INTO pfh_schema_migrations (version) VALUES (1) ON CONFLICT DO NOTHING;
COMMIT;

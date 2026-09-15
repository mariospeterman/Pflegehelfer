CREATE TABLE accepted_commands (
  organization_id text NOT NULL REFERENCES organizations(id),
  id uuid NOT NULL,
  command_key text NOT NULL,
  request_hash text NOT NULL CHECK (request_hash ~ '^[a-f0-9]{64}$'),
  actor_id text NOT NULL,
  actor_role text NOT NULL,
  site_id text NOT NULL,
  department_id text NOT NULL,
  purpose text NOT NULL,
  patient_id text NOT NULL,
  encounter_id text NOT NULL,
  session_id uuid NOT NULL,
  thread_id uuid NOT NULL,
  context_revision integer NOT NULL,
  workflow_template_id text NOT NULL,
  workflow_version integer NOT NULL,
  policy_version text NOT NULL,
  proposal_revision_id uuid NOT NULL,
  proposal_hash text NOT NULL CHECK (proposal_hash ~ '^[a-f0-9]{64}$'),
  selected_action_ids jsonb NOT NULL,
  source_read_set jsonb NOT NULL DEFAULT '[]'::jsonb,
  result_payload jsonb NOT NULL,
  status_code integer NOT NULL CHECK (status_code BETWEEN 200 AND 299),
  state text NOT NULL DEFAULT 'locally-accepted'
    CHECK (state IN ('locally-accepted','projected','delivery-pending','delivered','manual-review')),
  accepted_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id,id),
  UNIQUE (organization_id,command_key),
  FOREIGN KEY (organization_id,proposal_revision_id)
    REFERENCES assistant_proposal_revisions(organization_id,id),
  FOREIGN KEY (organization_id,session_id)
    REFERENCES working_sessions(organization_id,id),
  FOREIGN KEY (organization_id,thread_id)
    REFERENCES assistant_threads(organization_id,id)
);

CREATE TABLE clinical_projection_outbox (
  organization_id text NOT NULL REFERENCES organizations(id),
  id uuid NOT NULL,
  accepted_command_id uuid NOT NULL,
  idempotency_key text NOT NULL,
  payload jsonb NOT NULL,
  state text NOT NULL DEFAULT 'pending'
    CHECK (state IN ('pending','leased','delivered','retry','manual')),
  attempts integer NOT NULL DEFAULT 0,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  lease_owner text,
  lease_expires_at timestamptz,
  last_error_class text,
  created_at timestamptz NOT NULL DEFAULT now(),
  delivered_at timestamptz,
  PRIMARY KEY (organization_id,id),
  UNIQUE (organization_id,idempotency_key),
  FOREIGN KEY (organization_id,accepted_command_id)
    REFERENCES accepted_commands(organization_id,id)
);
CREATE INDEX clinical_projection_outbox_due
  ON clinical_projection_outbox (organization_id,next_attempt_at,id)
  WHERE state IN ('pending','retry');

ALTER TABLE provider_outbox
  ADD COLUMN accepted_command_id uuid,
  ADD COLUMN authority_envelope jsonb;
ALTER TABLE provider_outbox
  ADD CONSTRAINT provider_outbox_accepted_command_fk
  FOREIGN KEY (organization_id,accepted_command_id)
  REFERENCES accepted_commands(organization_id,id) NOT VALID;

INSERT INTO pfh_schema_migrations (version) VALUES (7) ON CONFLICT DO NOTHING;

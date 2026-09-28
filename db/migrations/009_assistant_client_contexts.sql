CREATE TABLE assistant_client_contexts (
  organization_id text NOT NULL REFERENCES organizations(id),
  id uuid NOT NULL,
  actor_id text NOT NULL,
  effective_role text NOT NULL,
  session_id uuid NOT NULL,
  thread_id uuid NOT NULL,
  context_revision integer NOT NULL CHECK (context_revision > 0),
  patient_id text,
  encounter_id text,
  expires_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id,id),
  FOREIGN KEY (organization_id,session_id)
    REFERENCES working_sessions(organization_id,id),
  FOREIGN KEY (organization_id,thread_id)
    REFERENCES assistant_threads(organization_id,id),
  CHECK (
    (patient_id IS NULL AND encounter_id IS NULL)
    OR (patient_id IS NOT NULL AND encounter_id IS NOT NULL)
  )
);
CREATE INDEX assistant_client_contexts_actor
  ON assistant_client_contexts (organization_id,actor_id,updated_at DESC);

ALTER TABLE safety_authority
  ADD COLUMN client_context_id uuid;

INSERT INTO pfh_schema_migrations (version) VALUES (9) ON CONFLICT DO NOTHING;

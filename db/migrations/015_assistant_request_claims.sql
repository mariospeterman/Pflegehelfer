CREATE TABLE IF NOT EXISTS assistant_request_claims (
  organization_id text NOT NULL REFERENCES organizations(id),
  site_id text NOT NULL,
  actor_id text NOT NULL,
  effective_role text NOT NULL,
  command_id uuid NOT NULL,
  request_hash text NOT NULL CHECK (request_hash ~ '^[a-f0-9]{64}$'),
  session_id uuid NOT NULL,
  thread_id uuid NOT NULL,
  context_revision integer NOT NULL,
  client_context_id uuid NOT NULL,
  state text NOT NULL CHECK (state IN ('in-progress','completed')),
  response jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  PRIMARY KEY (organization_id, site_id, actor_id, command_id),
  FOREIGN KEY (organization_id, thread_id)
    REFERENCES assistant_threads(organization_id, id),
  CHECK (
    (state='in-progress' AND response IS NULL)
    OR (state='completed' AND response IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS assistant_request_claims_expiry
  ON assistant_request_claims (organization_id, site_id, expires_at);

INSERT INTO pfh_schema_migrations (version)
VALUES (15)
ON CONFLICT DO NOTHING;

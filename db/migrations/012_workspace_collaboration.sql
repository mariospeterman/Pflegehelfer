CREATE TABLE workspace_records (
  organization_id text NOT NULL REFERENCES organizations(id),
  id uuid NOT NULL,
  record_type text NOT NULL CHECK (
    record_type IN ('comment','attachment','project','profile-field','profile-proposal')
  ),
  patient_id text,
  actor_id text NOT NULL,
  audience jsonb NOT NULL,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  payload jsonb NOT NULL,
  blob_data bytea,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id,id),
  CHECK (
    (record_type='attachment' AND blob_data IS NOT NULL)
    OR (record_type<>'attachment' AND blob_data IS NULL)
  )
);

CREATE INDEX workspace_records_patient
  ON workspace_records (organization_id,patient_id,record_type,created_at DESC);
CREATE INDEX workspace_records_actor
  ON workspace_records (organization_id,actor_id,record_type,created_at DESC);
CREATE UNIQUE INDEX workspace_profile_field_identity
  ON workspace_records (organization_id,patient_id,(payload->>'fieldKey'))
  WHERE record_type='profile-field';

CREATE TABLE workspace_comment_reads (
  organization_id text NOT NULL REFERENCES organizations(id),
  comment_id uuid NOT NULL,
  actor_id text NOT NULL,
  read_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id,comment_id,actor_id),
  FOREIGN KEY (organization_id,comment_id)
    REFERENCES workspace_records(organization_id,id) ON DELETE CASCADE
);

INSERT INTO pfh_schema_migrations (version) VALUES (12) ON CONFLICT DO NOTHING;

ALTER TABLE safety_authority
  ADD COLUMN IF NOT EXISTS bound_assistant_command_id uuid;

CREATE INDEX IF NOT EXISTS safety_authority_voice_request_binding
  ON safety_authority (organization_id, bound_assistant_command_id)
  WHERE authority_type = 'voice' AND consumed_at IS NULL;

INSERT INTO pfh_schema_migrations (version)
VALUES (18)
ON CONFLICT DO NOTHING;

ALTER TABLE assistant_request_claims
  ADD COLUMN IF NOT EXISTS holder_id uuid,
  ADD COLUMN IF NOT EXISTS lease_expires_at timestamptz;

-- Rows created before fencing cannot have a trusted current holder. Expire
-- their execution lease so an identical logical request can take ownership;
-- the durable request identity itself remains in place and still rejects a
-- changed payload or scope.
UPDATE assistant_request_claims
SET holder_id = COALESCE(
      holder_id,
      '00000000-0000-4000-8000-000000000016'::uuid
    ),
    lease_expires_at = COALESCE(lease_expires_at, now())
WHERE holder_id IS NULL OR lease_expires_at IS NULL;

ALTER TABLE assistant_request_claims
  ALTER COLUMN holder_id SET NOT NULL,
  ALTER COLUMN lease_expires_at SET NOT NULL;

CREATE INDEX IF NOT EXISTS assistant_request_claims_lease
  ON assistant_request_claims (
    organization_id,
    site_id,
    state,
    lease_expires_at
  );

INSERT INTO pfh_schema_migrations (version)
VALUES (16)
ON CONFLICT DO NOTHING;

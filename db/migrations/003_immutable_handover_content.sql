BEGIN;

ALTER TABLE handover_snapshots
  ADD COLUMN IF NOT EXISTS content jsonb,
  ADD COLUMN IF NOT EXISTS content_hash text;

DROP INDEX IF EXISTS handover_snapshots_actor_version;
CREATE UNIQUE INDEX IF NOT EXISTS handover_snapshots_actor_version
  ON handover_snapshots
    (organization_id, department_id, shift_key, owner_actor_id, version)
  WHERE owner_actor_id IS NOT NULL AND content IS NOT NULL;

ALTER TABLE handover_snapshots
  ADD CONSTRAINT handover_snapshots_content_shape
  CHECK (
    content IS NULL OR
    (jsonb_typeof(content) = 'array' AND jsonb_array_length(content) > 0)
  ) NOT VALID;
ALTER TABLE handover_snapshots
  ADD CONSTRAINT handover_snapshots_content_hash_shape
  CHECK (content_hash IS NULL OR content_hash ~ '^[a-f0-9]{64}$') NOT VALID;

INSERT INTO pfh_schema_migrations (version) VALUES (3) ON CONFLICT DO NOTHING;

COMMIT;

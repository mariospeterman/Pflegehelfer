BEGIN;

ALTER TABLE handover_snapshots
  DROP CONSTRAINT IF EXISTS handover_snapshots_content_shape;
ALTER TABLE handover_snapshots
  ADD CONSTRAINT handover_snapshots_content_shape
  CHECK (content IS NULL OR jsonb_typeof(content) = 'array') NOT VALID;

INSERT INTO pfh_schema_migrations (version) VALUES (4) ON CONFLICT DO NOTHING;

COMMIT;

BEGIN;

ALTER TABLE handover_snapshots
  ADD COLUMN IF NOT EXISTS clinical_bound boolean NOT NULL DEFAULT false;

INSERT INTO pfh_schema_migrations (version) VALUES (5) ON CONFLICT DO NOTHING;

COMMIT;

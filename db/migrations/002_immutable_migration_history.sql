BEGIN;

CREATE TABLE IF NOT EXISTS pfh_migration_history (
  version integer PRIMARY KEY,
  name text NOT NULL,
  checksum text NOT NULL CHECK (checksum ~ '^[a-f0-9]{64}$'),
  provenance text NOT NULL CHECK (provenance IN ('verified-current-run', 'legacy-unverified')),
  applied_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO pfh_schema_migrations (version) VALUES (2) ON CONFLICT DO NOTHING;

COMMIT;

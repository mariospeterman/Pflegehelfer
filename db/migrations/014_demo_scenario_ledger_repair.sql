-- Migration 013 created the tenant-scoped scenario-run table and its immutable
-- history record, but omitted the compatibility ledger row used by the startup
-- preflight. Keep 013 byte-for-byte immutable and repair both fresh sequences
-- and the reviewed synthetic demo database in this successor migration.

INSERT INTO pfh_schema_migrations (version)
VALUES (13)
ON CONFLICT DO NOTHING;

INSERT INTO pfh_schema_migrations (version)
VALUES (14)
ON CONFLICT DO NOTHING;

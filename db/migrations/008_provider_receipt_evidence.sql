ALTER TABLE provider_receipts
  ADD COLUMN IF NOT EXISTS provider_version text,
  ADD COLUMN IF NOT EXISTS adapter_version text,
  ADD COLUMN IF NOT EXISTS mapping_version text,
  ADD COLUMN IF NOT EXISTS readback_hash text;

INSERT INTO pfh_schema_migrations (version) VALUES (8) ON CONFLICT DO NOTHING;

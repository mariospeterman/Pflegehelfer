-- Existing pending capabilities predate SourceReadSetV1 and cannot be made
-- trustworthy retrospectively. Expire them before enabling the new binding.
ALTER TABLE safety_authority NO FORCE ROW LEVEL SECURITY;
ALTER TABLE assistant_proposal_revisions NO FORCE ROW LEVEL SECURITY;

UPDATE safety_authority
SET consumed_at = COALESCE(consumed_at, clock_timestamp())
WHERE authority_type = 'intent' AND consumed_at IS NULL;

UPDATE assistant_proposal_revisions
SET status = 'expired'
WHERE status = 'pending';

ALTER TABLE safety_authority FORCE ROW LEVEL SECURITY;
ALTER TABLE assistant_proposal_revisions FORCE ROW LEVEL SECURITY;

ALTER TABLE assistant_proposal_revisions
  ADD COLUMN source_read_set jsonb,
  ADD COLUMN source_read_set_digest text;

ALTER TABLE safety_authority
  ADD COLUMN source_read_set jsonb,
  ADD COLUMN source_read_set_digest text;

ALTER TABLE assistant_proposal_revisions
  ADD CONSTRAINT assistant_proposal_source_read_set_shape_check CHECK (
    (source_read_set IS NULL AND source_read_set_digest IS NULL)
    OR (
      source_read_set IS NOT NULL
      AND source_read_set_digest ~ '^[a-f0-9]{64}$'
      AND source_read_set->>'schemaVersion' = '1'
      AND source_read_set->>'digest' = source_read_set_digest
      AND jsonb_typeof(source_read_set->'resources') = 'array'
      AND jsonb_array_length(source_read_set->'resources') >= 2
      AND jsonb_typeof(source_read_set->'selectors') = 'array'
    )
  );

ALTER TABLE safety_authority
  ADD CONSTRAINT safety_authority_source_read_set_shape_check CHECK (
    (
      source_read_set IS NULL
      AND source_read_set_digest IS NULL
      AND (authority_type <> 'intent' OR consumed_at IS NOT NULL)
    )
    OR (
      authority_type = 'intent'
      AND source_read_set IS NOT NULL
      AND source_read_set_digest ~ '^[a-f0-9]{64}$'
      AND source_read_set->>'schemaVersion' = '1'
      AND source_read_set->>'digest' = source_read_set_digest
      AND jsonb_typeof(source_read_set->'resources') = 'array'
      AND jsonb_array_length(source_read_set->'resources') >= 2
      AND jsonb_typeof(source_read_set->'selectors') = 'array'
    )
  );

CREATE INDEX assistant_proposals_source_read_set_digest
  ON assistant_proposal_revisions (organization_id,source_read_set_digest)
  WHERE source_read_set_digest IS NOT NULL;

INSERT INTO pfh_schema_migrations (version) VALUES (24) ON CONFLICT DO NOTHING;

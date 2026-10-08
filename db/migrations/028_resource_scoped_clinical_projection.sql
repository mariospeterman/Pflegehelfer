-- Clinical projection v2 carries only immutable resource deltas.  Legacy v1
-- rows are retained until delivered so an upgrade never discards locally
-- accepted work; their whole-state checkpoint member is ignored by new
-- workers and removed once delivery is proven.
-- The migration principal owns these tables.  FORCE RLS is disabled only
-- inside this migration transaction so the all-tenant legacy backfill cannot
-- silently miss rows when no runtime tenant binding is installed.
ALTER TABLE accepted_commands NO FORCE ROW LEVEL SECURITY;
ALTER TABLE clinical_projection_outbox NO FORCE ROW LEVEL SECURITY;

ALTER TABLE accepted_commands
  ADD CONSTRAINT accepted_commands_site_identity
  UNIQUE (organization_id,site_id,id);

ALTER TABLE clinical_projection_outbox
  ADD COLUMN site_id text,
  ADD COLUMN payload_schema_version smallint,
  ADD COLUMN target_keys text[],
  ADD COLUMN enqueue_sequence bigint GENERATED ALWAYS AS IDENTITY;

UPDATE clinical_projection_outbox projection
SET site_id=accepted.site_id,
    payload_schema_version=1,
    target_keys=COALESCE(
      NULLIF(
        ARRAY(
          SELECT DISTINCT reference
          FROM (
            SELECT (resource->>'resourceType') || '/' || (resource->>'id') AS reference
            FROM jsonb_array_elements(
              CASE
                WHEN jsonb_typeof(projection.payload->'resources')='array'
                THEN projection.payload->'resources'
                ELSE '[]'::jsonb
              END
            ) resource
            WHERE resource->>'resourceType' IS NOT NULL
              AND resource->>'id' IS NOT NULL
            UNION
            SELECT removed.reference
            FROM jsonb_array_elements_text(
              CASE
                WHEN jsonb_typeof(projection.payload->'removedReferences')='array'
                THEN projection.payload->'removedReferences'
                ELSE '[]'::jsonb
              END
            ) removed(reference)
          ) projection_references
          ORDER BY reference
        ),
        ARRAY[]::text[]
      ),
      ARRAY['accepted-command:' || projection.accepted_command_id::text]
    )
FROM accepted_commands accepted
WHERE accepted.organization_id=projection.organization_id
  AND accepted.id=projection.accepted_command_id;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM clinical_projection_outbox
    WHERE site_id IS NULL OR payload_schema_version IS NULL OR target_keys IS NULL
  ) THEN
    RAISE EXCEPTION 'Clinical projection site/payload backfill is incomplete';
  END IF;
END;
$$;

ALTER TABLE clinical_projection_outbox
  ALTER COLUMN site_id SET NOT NULL,
  ALTER COLUMN payload_schema_version SET NOT NULL,
  ALTER COLUMN target_keys SET NOT NULL,
  ADD CONSTRAINT clinical_projection_payload_schema
    CHECK (payload_schema_version IN (1,2)),
  ADD CONSTRAINT clinical_projection_target_keys_nonempty
    CHECK (cardinality(target_keys) BETWEEN 1 AND 256),
  ADD CONSTRAINT clinical_projection_site_command_fk
    FOREIGN KEY (organization_id,site_id,accepted_command_id)
    REFERENCES accepted_commands(organization_id,site_id,id);

-- A pre-v2 queue had no trustworthy per-resource enqueue cursor.  Preserve
-- every ambiguous chain on manual hold rather than manufacturing causality
-- from UUIDs, timestamps, or heap order.
UPDATE clinical_projection_outbox current_job
SET state='manual',
    last_error_class='MIGRATION_ORDER_UNPROVEN',
    lease_owner=NULL,
    lease_expires_at=NULL
WHERE current_job.state <> 'delivered'
  AND EXISTS (
    SELECT 1 FROM clinical_projection_outbox peer
    WHERE peer.organization_id=current_job.organization_id
      AND peer.site_id=current_job.site_id
      AND peer.id <> current_job.id
      AND peer.state <> 'delivered'
      AND peer.target_keys && current_job.target_keys
  );

UPDATE accepted_commands accepted
SET state='manual-review'
WHERE accepted.state <> 'delivered'
  AND EXISTS (
    SELECT 1 FROM clinical_projection_outbox projection
    WHERE projection.organization_id=accepted.organization_id
      AND projection.site_id=accepted.site_id
      AND projection.accepted_command_id=accepted.id
      AND projection.state='manual'
      AND projection.last_error_class='MIGRATION_ORDER_UNPROVEN'
  );

-- Delivered v1 rows no longer need to retain a duplicate patient record.
UPDATE clinical_projection_outbox
SET payload=payload-'checkpoint'
WHERE state='delivered' AND payload_schema_version=1 AND payload ? 'checkpoint';

CREATE INDEX clinical_projection_outbox_target_order
  ON clinical_projection_outbox
    (organization_id,site_id,enqueue_sequence)
  WHERE state <> 'delivered';
CREATE INDEX clinical_projection_outbox_due_v2
  ON clinical_projection_outbox
    (organization_id,site_id,next_attempt_at,enqueue_sequence)
  WHERE state IN ('pending','retry');

ALTER TABLE accepted_commands FORCE ROW LEVEL SECURITY;
ALTER TABLE clinical_projection_outbox FORCE ROW LEVEL SECURITY;

INSERT INTO pfh_schema_migrations (version) VALUES (28) ON CONFLICT DO NOTHING;

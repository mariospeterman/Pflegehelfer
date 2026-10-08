ALTER TABLE provider_outbox
  ADD COLUMN IF NOT EXISTS target_key text,
  ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS enqueue_sequence bigint GENERATED ALWAYS AS IDENTITY;

UPDATE provider_outbox
SET target_key=CASE
  WHEN payload->'command'->'resource'->>'resourceType' IS NOT NULL
   AND payload->'command'->'resource'->>'id' IS NOT NULL
  THEN provider_id || ':' || profile_id || ':' ||
       (payload->'command'->'resource'->>'resourceType') || '/' ||
       (payload->'command'->'resource'->>'id')
  ELSE 'invalid:' || id::text
END
WHERE target_key IS NULL;

ALTER TABLE provider_outbox ALTER COLUMN target_key SET NOT NULL;

-- The pre-migration table had no trustworthy enqueue order. If more than one
-- unfinished command already targets the same provider resource, keep every
-- member of that ambiguous chain on manual hold instead of inventing order
-- from heap position, transaction timestamps or random UUIDs.
UPDATE provider_outbox current_job
SET state='manual',
    last_error_class='MIGRATION_ORDER_UNPROVEN',
    lease_owner=NULL,
    lease_expires_at=NULL
WHERE current_job.state <> 'delivered'
  AND EXISTS (
    SELECT 1 FROM provider_outbox peer
    WHERE peer.organization_id=current_job.organization_id
      AND peer.target_key=current_job.target_key
      AND peer.id <> current_job.id
      AND peer.state <> 'delivered'
  );

CREATE INDEX IF NOT EXISTS provider_outbox_target_order
  ON provider_outbox (organization_id,target_key,enqueue_sequence)
  WHERE state <> 'delivered';

INSERT INTO pfh_schema_migrations (version) VALUES (27) ON CONFLICT DO NOTHING;

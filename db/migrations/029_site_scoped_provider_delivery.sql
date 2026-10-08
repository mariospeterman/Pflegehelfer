-- Provider delivery is a site-owned queue.  Legacy rows that cannot be tied
-- to an accepted command are retained on an explicit manual hold; assigning
-- them to the current site would invent authority during upgrade.
ALTER TABLE provider_outbox NO FORCE ROW LEVEL SECURITY;
ALTER TABLE accepted_commands NO FORCE ROW LEVEL SECURITY;

ALTER TABLE provider_outbox ADD COLUMN site_id text;

UPDATE provider_outbox provider
SET site_id=accepted.site_id
FROM accepted_commands accepted
WHERE accepted.organization_id=provider.organization_id
  AND accepted.id=provider.accepted_command_id;

UPDATE provider_outbox
SET site_id='legacy-unassigned',
    state=CASE WHEN state='delivered' THEN state ELSE 'manual' END,
    last_error_class=CASE
      WHEN state='delivered' THEN last_error_class
      ELSE 'MIGRATION_SITE_UNPROVEN'
    END,
    lease_owner=NULL,
    lease_expires_at=NULL
WHERE site_id IS NULL;

-- Namespace every not-yet-delivered provider command at the wire boundary as
-- well as in SQL. Delivered commands retain their historic key because it is
-- part of the external receipt; unresolved unassigned rows remain on manual
-- hold and are deliberately not made executable by this migration.
UPDATE provider_outbox
SET idempotency_key=
      'pfh2:' || organization_id || ':' || site_id || ':' || idempotency_key,
    payload=jsonb_set(
      payload,
      '{command,idempotencyKey}',
      to_jsonb('pfh2:' || organization_id || ':' || site_id || ':' || idempotency_key),
      false
    )
WHERE state <> 'delivered'
  AND site_id <> 'legacy-unassigned'
  AND idempotency_key NOT LIKE 'pfh2:%';

ALTER TABLE provider_outbox
  ALTER COLUMN site_id SET NOT NULL,
  DROP CONSTRAINT provider_outbox_organization_id_provider_id_profile_id_idem_key,
  ADD CONSTRAINT provider_outbox_site_idempotency
    UNIQUE (organization_id,site_id,provider_id,profile_id,idempotency_key),
  ADD CONSTRAINT provider_outbox_site_command_fk
    FOREIGN KEY (organization_id,site_id,accepted_command_id)
    REFERENCES accepted_commands(organization_id,site_id,id) NOT VALID;

CREATE INDEX provider_outbox_site_due
  ON provider_outbox
    (organization_id,site_id,profile_id,next_attempt_at,enqueue_sequence)
  WHERE state IN ('pending','retry');
CREATE INDEX provider_outbox_site_target_order
  ON provider_outbox
    (organization_id,site_id,target_key,enqueue_sequence)
  WHERE state <> 'delivered';

ALTER TABLE provider_outbox FORCE ROW LEVEL SECURITY;
ALTER TABLE accepted_commands FORCE ROW LEVEL SECURITY;

INSERT INTO pfh_schema_migrations (version) VALUES (29) ON CONFLICT DO NOTHING;

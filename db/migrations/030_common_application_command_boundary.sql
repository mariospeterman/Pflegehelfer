-- Typed/API commands and reviewed assistant intents share the same durable
-- acceptance ledger and projection queues. Direct commands do not invent an
-- assistant proposal/session merely to satisfy the persistence schema.
ALTER TABLE accepted_commands
  ADD COLUMN authority_kind text NOT NULL DEFAULT 'clinical-intent'
    CHECK (authority_kind IN ('clinical-intent','application-command')),
  ALTER COLUMN patient_id DROP NOT NULL,
  ALTER COLUMN encounter_id DROP NOT NULL,
  ALTER COLUMN session_id DROP NOT NULL,
  ALTER COLUMN thread_id DROP NOT NULL,
  ALTER COLUMN context_revision DROP NOT NULL,
  ALTER COLUMN proposal_revision_id DROP NOT NULL,
  ALTER COLUMN proposal_hash DROP NOT NULL;

ALTER TABLE accepted_commands
  ADD CONSTRAINT accepted_commands_authority_shape CHECK (
    (
      authority_kind='clinical-intent'
      AND patient_id IS NOT NULL
      AND encounter_id IS NOT NULL
      AND session_id IS NOT NULL
      AND thread_id IS NOT NULL
      AND context_revision IS NOT NULL
      AND proposal_revision_id IS NOT NULL
      AND proposal_hash IS NOT NULL
    ) OR (
      authority_kind='application-command'
      AND session_id IS NULL
      AND thread_id IS NULL
      AND context_revision IS NULL
      AND proposal_revision_id IS NULL
      AND proposal_hash IS NULL
    )
  );

ALTER TABLE command_receipts ADD COLUMN accepted_command_id uuid;
UPDATE command_receipts receipt
SET accepted_command_id=accepted.id
FROM accepted_commands accepted
WHERE accepted.organization_id=receipt.organization_id
  AND accepted.command_key=receipt.command_key;
ALTER TABLE command_receipts
  ADD CONSTRAINT command_receipts_accepted_command_fk
  FOREIGN KEY (organization_id,accepted_command_id)
  REFERENCES accepted_commands(organization_id,id) NOT VALID;
CREATE INDEX command_receipts_accepted_command
  ON command_receipts (organization_id,accepted_command_id)
  WHERE accepted_command_id IS NOT NULL;

-- Older rows remain immutable evidence, but did not retain enough of the
-- hashed body to reconstruct and verify an AuditEntry after restart. New rows
-- retain that missing identity/type and form a restart-safe verified epoch.
ALTER TABLE audit_entries
  ADD COLUMN audit_entry_id uuid,
  ADD COLUMN actor_type text;
ALTER TABLE audit_entries
  ADD CONSTRAINT audit_entries_reconstructable_shape CHECK (
    (audit_entry_id IS NULL AND actor_type IS NULL)
    OR
    (audit_entry_id IS NOT NULL AND actor_type IN ('human','system'))
  );
CREATE UNIQUE INDEX audit_entries_reconstructable_identity
  ON audit_entries (organization_id,audit_entry_id)
  WHERE audit_entry_id IS NOT NULL;

INSERT INTO pfh_schema_migrations (version) VALUES (30) ON CONFLICT DO NOTHING;

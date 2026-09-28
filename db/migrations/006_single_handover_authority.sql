BEGIN;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM handover_snapshots
    WHERE owner_actor_id IS NOT NULL AND content IS NOT NULL
    GROUP BY organization_id, department_id, shift_key, owner_actor_id
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'HANDOVER_AUTHORITY_DUPLICATE: resolve duplicate actor/shift snapshots before migration';
  END IF;
END $$;

DROP INDEX IF EXISTS handover_snapshots_actor_version;
CREATE UNIQUE INDEX handover_snapshots_actor_shift
  ON handover_snapshots
    (organization_id, department_id, shift_key, owner_actor_id)
  WHERE owner_actor_id IS NOT NULL AND content IS NOT NULL;

INSERT INTO pfh_schema_migrations (version) VALUES (6) ON CONFLICT DO NOTHING;

COMMIT;

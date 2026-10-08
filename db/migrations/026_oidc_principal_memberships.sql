CREATE TABLE oidc_principal_memberships (
  organization_id TEXT NOT NULL REFERENCES organizations(id),
  issuer TEXT NOT NULL,
  subject TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  membership_version BIGINT NOT NULL
    CHECK (membership_version BETWEEN 1 AND 2147483647),
  policy_version TEXT NOT NULL CHECK (length(policy_version) BETWEEN 1 AND 160),
  active BOOLEAN NOT NULL DEFAULT TRUE,
  configured_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  revoked_at TIMESTAMPTZ,
  PRIMARY KEY (organization_id, issuer, subject),
  CHECK (active OR revoked_at IS NOT NULL)
);

REVOKE ALL ON oidc_principal_memberships FROM PUBLIC;

ALTER TABLE oidc_principal_memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE oidc_principal_memberships FORCE ROW LEVEL SECURITY;
CREATE POLICY pfh_tenant_isolation ON oidc_principal_memberships
  USING (organization_id = pfh_current_organization())
  WITH CHECK (organization_id = pfh_current_organization());

ALTER TABLE oidc_sessions
  ADD COLUMN membership_version BIGINT,
  ADD COLUMN policy_version TEXT;

-- A pre-026 session was created from caller-controlled private claims and has
-- no server-owned membership revision to bind. It must not survive upgrade.
UPDATE oidc_sessions
SET membership_version = 0,
    policy_version = 'pre-membership-mapping-revoked',
    revoked_at = COALESCE(revoked_at, clock_timestamp()),
    revocation_reason = COALESCE(revocation_reason, 'membership-migration');

ALTER TABLE oidc_sessions
  ALTER COLUMN membership_version SET NOT NULL,
  ALTER COLUMN policy_version SET NOT NULL;

CREATE INDEX oidc_principal_memberships_actor_idx
  ON oidc_principal_memberships (organization_id, actor_id)
  WHERE active;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'pflegehelfer_runtime') THEN
    GRANT SELECT ON oidc_principal_memberships TO pflegehelfer_runtime;
  END IF;
END $$;

INSERT INTO pfh_schema_migrations (version)
VALUES (26)
ON CONFLICT DO NOTHING;

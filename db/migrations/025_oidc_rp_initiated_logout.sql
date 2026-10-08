CREATE TABLE IF NOT EXISTS oidc_logout_attempts (
  organization_id TEXT NOT NULL REFERENCES organizations(id),
  state_hash TEXT NOT NULL,
  browser_binding_hash TEXT NOT NULL,
  return_path TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  expires_at TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ,
  PRIMARY KEY (organization_id, state_hash),
  CHECK (return_path ~ '^/[A-Za-z0-9/_?&=.%+-]*$')
);

CREATE INDEX IF NOT EXISTS oidc_logout_attempts_expiry_idx
  ON oidc_logout_attempts (organization_id, expires_at);

ALTER TABLE oidc_logout_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE oidc_logout_attempts FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS pfh_tenant_isolation ON oidc_logout_attempts;
CREATE POLICY pfh_tenant_isolation ON oidc_logout_attempts
  USING (organization_id = pfh_current_organization())
  WITH CHECK (organization_id = pfh_current_organization());

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'pflegehelfer_runtime') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON oidc_logout_attempts TO pflegehelfer_runtime;
  END IF;
END $$;

INSERT INTO pfh_schema_migrations (version)
VALUES (25)
ON CONFLICT DO NOTHING;

CREATE TABLE IF NOT EXISTS oidc_login_attempts (
  organization_id TEXT NOT NULL REFERENCES organizations(id),
  state_hash TEXT NOT NULL,
  encrypted_secrets TEXT NOT NULL,
  return_path TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  expires_at TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ,
  PRIMARY KEY (organization_id, state_hash),
  CHECK (return_path ~ '^/[A-Za-z0-9/_?&=.%+-]*$')
);

CREATE TABLE IF NOT EXISTS oidc_sessions (
  organization_id TEXT NOT NULL REFERENCES organizations(id),
  session_hash TEXT NOT NULL,
  csrf_hash TEXT NOT NULL,
  issuer TEXT NOT NULL,
  subject TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  idp_session_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  rotated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ,
  revocation_reason TEXT,
  PRIMARY KEY (organization_id, session_hash)
);

CREATE UNIQUE INDEX IF NOT EXISTS oidc_sessions_active_subject_idx
  ON oidc_sessions (organization_id, issuer, subject)
  WHERE revoked_at IS NULL;
CREATE INDEX IF NOT EXISTS oidc_sessions_expiry_idx
  ON oidc_sessions (organization_id, expires_at)
  WHERE revoked_at IS NULL;

ALTER TABLE oidc_login_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE oidc_login_attempts FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON oidc_login_attempts;
CREATE POLICY tenant_isolation ON oidc_login_attempts
  USING (organization_id = current_setting('pfh.organization_id', true))
  WITH CHECK (organization_id = current_setting('pfh.organization_id', true));

ALTER TABLE oidc_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE oidc_sessions FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON oidc_sessions;
CREATE POLICY tenant_isolation ON oidc_sessions
  USING (organization_id = current_setting('pfh.organization_id', true))
  WITH CHECK (organization_id = current_setting('pfh.organization_id', true));

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'pflegehelfer_runtime') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON oidc_login_attempts TO pflegehelfer_runtime;
    GRANT SELECT, INSERT, UPDATE, DELETE ON oidc_sessions TO pflegehelfer_runtime;
  END IF;
END $$;

INSERT INTO pfh_schema_migrations (version)
VALUES (20)
ON CONFLICT DO NOTHING;

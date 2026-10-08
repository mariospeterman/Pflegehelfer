-- Login attempts created before this migration lack proof that the callback is
-- returning to the browser that initiated the authorization request. They are
-- short-lived and safe to invalidate during the additive security upgrade.
-- FORCE RLS also constrains a non-BYPASSRLS table owner; disable only the
-- owner constraint inside this migration transaction, while ordinary roles
-- remain subject to the existing policy, and restore it before commit.
ALTER TABLE oidc_login_attempts NO FORCE ROW LEVEL SECURITY;
DELETE FROM oidc_login_attempts;

ALTER TABLE oidc_login_attempts
  ADD COLUMN IF NOT EXISTS browser_binding_hash TEXT;

ALTER TABLE oidc_login_attempts
  ALTER COLUMN browser_binding_hash SET NOT NULL;

ALTER TABLE oidc_login_attempts FORCE ROW LEVEL SECURITY;

INSERT INTO pfh_schema_migrations (version)
VALUES (22)
ON CONFLICT DO NOTHING;

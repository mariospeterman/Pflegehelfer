CREATE TABLE IF NOT EXISTS runtime_tenant_principals (
  role_name NAME PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id),
  configured_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);

REVOKE ALL ON runtime_tenant_principals FROM PUBLIC;

CREATE OR REPLACE FUNCTION pfh_current_organization()
RETURNS TEXT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT organization_id
  FROM public.runtime_tenant_principals
  WHERE role_name = session_user
$$;

REVOKE ALL ON FUNCTION pfh_current_organization() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION pfh_current_organization() TO PUBLIC;

DO $$
DECLARE
  tenant_table RECORD;
BEGIN
  FOR tenant_table IN
    SELECT DISTINCT c.table_name
    FROM information_schema.columns c
    WHERE c.table_schema = 'public'
      AND c.column_name = 'organization_id'
      AND c.table_name <> 'runtime_tenant_principals'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS pfh_tenant_isolation ON public.%I', tenant_table.table_name);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON public.%I', tenant_table.table_name);
    EXECUTE format(
      'CREATE POLICY pfh_tenant_isolation ON public.%I USING (organization_id = pfh_current_organization()) WITH CHECK (organization_id = pfh_current_organization())',
      tenant_table.table_name
    );
  END LOOP;

  DROP POLICY IF EXISTS pfh_tenant_isolation ON public.organizations;
  CREATE POLICY pfh_tenant_isolation ON public.organizations
    USING (id = pfh_current_organization())
    WITH CHECK (id = pfh_current_organization());
END;
$$;

INSERT INTO pfh_schema_migrations (version)
VALUES (21)
ON CONFLICT DO NOTHING;

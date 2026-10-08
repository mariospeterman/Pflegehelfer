DO $$
DECLARE
  tenant_table record;
BEGIN
  FOR tenant_table IN
    SELECT DISTINCT table_name
    FROM information_schema.columns
    WHERE table_schema = 'public' AND column_name = 'organization_id'
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', tenant_table.table_name);
    EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY', tenant_table.table_name);
    EXECUTE format('DROP POLICY IF EXISTS pfh_tenant_isolation ON public.%I', tenant_table.table_name);
    EXECUTE format(
      'CREATE POLICY pfh_tenant_isolation ON public.%I USING (organization_id = current_setting(''pfh.organization_id'', true)) WITH CHECK (organization_id = current_setting(''pfh.organization_id'', true))',
      tenant_table.table_name
    );
  END LOOP;

  ALTER TABLE public.organizations ENABLE ROW LEVEL SECURITY;
  ALTER TABLE public.organizations FORCE ROW LEVEL SECURITY;
  DROP POLICY IF EXISTS pfh_tenant_isolation ON public.organizations;
  CREATE POLICY pfh_tenant_isolation ON public.organizations
    USING (id = current_setting('pfh.organization_id', true))
    WITH CHECK (id = current_setting('pfh.organization_id', true));

  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'pflegehelfer_runtime') THEN
    GRANT USAGE ON SCHEMA public TO pflegehelfer_runtime;
    GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO pflegehelfer_runtime;
    GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA public TO pflegehelfer_runtime;
  END IF;
END;
$$;

INSERT INTO pfh_schema_migrations (version)
VALUES (19)
ON CONFLICT DO NOTHING;

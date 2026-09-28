CREATE TABLE demo_scenario_runs (
  organization_id text NOT NULL REFERENCES organizations(id),
  run_id uuid NOT NULL,
  scenario_id text NOT NULL,
  scenario_version integer NOT NULL CHECK (scenario_version > 0),
  label text NOT NULL,
  source_run_id uuid,
  clock jsonb NOT NULL,
  state jsonb NOT NULL,
  workspace jsonb NOT NULL,
  state_digest text NOT NULL CHECK (state_digest ~ '^[a-f0-9]{64}$'),
  active boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  PRIMARY KEY (organization_id, run_id),
  FOREIGN KEY (organization_id, source_run_id)
    REFERENCES demo_scenario_runs(organization_id, run_id)
);

CREATE UNIQUE INDEX demo_scenario_runs_one_active
  ON demo_scenario_runs (organization_id) WHERE active;

ALTER TABLE demo_scenario_runs ENABLE ROW LEVEL SECURITY;

CREATE POLICY demo_scenario_runs_tenant_policy ON demo_scenario_runs
  USING (organization_id = current_setting('pfh.organization_id', true))
  WITH CHECK (organization_id = current_setting('pfh.organization_id', true));

GRANT SELECT, INSERT, UPDATE ON demo_scenario_runs TO CURRENT_USER;

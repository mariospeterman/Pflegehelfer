CREATE TABLE organization_commercial_config (
  organization_id text PRIMARY KEY REFERENCES organizations(id),
  version integer NOT NULL CHECK (version > 0),
  effective_from date NOT NULL,
  configuration jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE organization_usage_ledger (
  organization_id text NOT NULL REFERENCES organizations(id),
  provider text NOT NULL,
  receipt_id text NOT NULL,
  occurred_at timestamptz NOT NULL,
  receipt jsonb NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id,provider,receipt_id)
);

CREATE INDEX organization_usage_ledger_period
  ON organization_usage_ledger (organization_id,occurred_at);

INSERT INTO pfh_schema_migrations (version) VALUES (11) ON CONFLICT DO NOTHING;

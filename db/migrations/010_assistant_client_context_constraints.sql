CREATE INDEX assistant_client_contexts_expiry
  ON assistant_client_contexts (organization_id,expires_at);

ALTER TABLE safety_authority
  ADD CONSTRAINT safety_authority_client_context_fk
  FOREIGN KEY (organization_id,client_context_id)
  REFERENCES assistant_client_contexts(organization_id,id);

INSERT INTO pfh_schema_migrations (version) VALUES (10) ON CONFLICT DO NOTHING;

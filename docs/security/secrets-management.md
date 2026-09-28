# Secrets management

No secret belongs in Git, images, Helm values, browser code, logs, or demo fixtures. Production injects short-lived credentials through Kubernetes Secrets backed by an approved KMS/HSM or external secret operator. Separate identity, database, provider, signing, and backup keys; scope each adapter credential; rotate and revoke independently; audit reads; use sealed offline transfer for air-gapped imports. CI uses OIDC federation and ephemeral tokens.

# Deployment guide

The Compose profile is the complete fictional showcase. It runs an application operational PostgreSQL database separately from Medplum's own database. The Helm chart is an application baseline, not a claim that a healthcare production platform is configured.

An empty Medplum database builds the R4 structure definitions, value sets and
search parameters before its first healthy response. The Compose healthcheck
therefore has a 12-minute startup grace while retaining the normal 20-second
interval and bounded retries. A successful probe ends the grace immediately.
Operators should observe migration progress and wait for `/ready`; subsequent
boots reuse the built indexes and are substantially faster.

Production topology requires a TLS reverse proxy, institutional OIDC/Keycloak, purpose-specific BFF sessions, least-privilege Medplum ClientApplication and AccessPolicy, PostgreSQL/Redis HA, immutable audit export, encrypted backup/PITR, OpenTelemetry, secrets management and network isolation. Never expose Medplum, Ollama/vLLM or ASR directly to client devices; only the BFF and approved context links cross the edge.

Pin all application, Medplum, database, model and FHIR-package artifacts by immutable digest/checksum. Import them into the offline release repository, generate an SBOM, scan, sign, stage the complete clinical journeys and retain approval/rollback evidence. Model and terminology packages never auto-update.

The demo `.env.demo` credentials and broad bootstrap privileges are prohibited in production. Before production readiness can return healthy, configure institutional identity/device claims, narrow Medplum access policies, TLS, retention, backup, monitoring and every activated provider’s documented connection contract.

The production Secret must provide a least-privilege `MEDPLUM_CLIENT_ID`, `MEDPLUM_CLIENT_SECRET`, and `PFH_CHECKPOINT_HMAC_KEY` containing at least 32 random bytes. Never use `MEDPLUM_DEFAULT_SUPER_ADMIN_*` outside explicit synthetic demo mode. Rotate the HMAC in a controlled maintenance window: put the new signing key in `PFH_CHECKPOINT_HMAC_KEY` and the old key in `PFH_CHECKPOINT_HMAC_PREVIOUS_KEYS`, restart the single replica, verify `/ready` and a newly signed checkpoint, and retain rollback evidence. Previous keys must remain available for the approved idempotency-receipt retention period unless those receipts are re-signed by a separately reviewed migration. Verification accepts the named previous key and uses a constant-time signature comparison; every new checkpoint/receipt is signed only with the current key. Direct Medplum links are inspection-only until institutional SSO and AccessPolicy enforce the same patient/purpose scope as the BFF.

The current modular-monolith repository is deliberately single-replica. Workflow sessions and assistant threads now use shared PostgreSQL, but clinical orchestration still maintains a process-local projection backed by a Medplum checkpoint. Do not scale the application above one replica until that legacy checkpoint projection is removed in favour of the transactional event/read-model path and concurrency is load-tested.

Use `/health` for liveness and `/ready` for dependency/audit readiness. Alert on non-ready state, audit failure, persistence rollback, provider queue age, conflicts, rejected commands, stale projections, model degradation and ASR errors.

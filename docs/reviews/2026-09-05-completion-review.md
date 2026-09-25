# Completion review — 2026-09-05

Three independent review passes covered architecture/provider integration, security/privacy/clinical safety, and frontend/QA. Reviewers inspected code and running behavior, supplied executable failure probes, and rechecked every accepted fix. No internally fixable blocker remains in the reviewed scope.

## Resolved findings

- Replaced the old disconnected dashboard/modal path with one GenUI/chat/voice-first PWA. Its fixed shell is limited to role/patient safety context, compact stream modes, history, sync and approval; every component uses the same deterministic gateway, policy, workflow service and Medplum workspace.
- Disabled demo identity headers, simulator/reset routes and hosted synthetic AI outside explicit demo mode; production readiness fails closed until institutional identity is configured.
- Enforced patient, purpose, ward/treatment relationship, author separation, four-eyes approval, version checks and role-specific workflow boundaries on the server.
- Persisted FHIR projection deltas, Provenance/AuditEvent, checkpoint and a deterministic command receipt in one Medplum transaction. Receipts are dedicated very-restricted Binaries; the checkpoint keeps a 128-entry/128-KiB hot cache rather than growing without bound.
- Added conditional checkpoint CAS, rollback/reload after failed or ambiguous writes, durable replay after restart/cache eviction, payload-bound command IDs and read isolation behind the commit boundary.
- Added current/previous HMAC key IDs, constant-time verification and executable controlled rotation. Tampered receipt content fails authentication even when its plain SHA is recomputed.
- Set the Helm application default to one replica and documented that process-local reads are not a coherent HA design. Optimistic write CAS is not represented as multi-replica safety.
- Separated all undocumented production provider capabilities from executable simulators. Disabled, unresolved and vendor-gated manifests cannot dispatch.
- Bound reconciliation to the exact displayed local/provider versions and hashes. Clinical-content/mapping rejection can be retried only by a treating nurse or physician, never by IT.
- Constrained OpenUI to a registered component catalog and draft-only actions. Every action token is one-use and bound to actor, patient, encounter, purpose and resource version; changed role/context/state invalidates it.
- Restricted local model/ASR endpoints to private literals or reviewed exact origins. Deep-model prose is not presented as clinical evidence; only exact approved local source content is shown.
- Cleared voice buffers, removed transcription caching, canceled recording/upload on close/context change, and limited browser speech to fictional demo data.
- Fixed stale role-switch responses—including same-user ABA transitions with a monotonic role-session epoch—modal focus/restoration, fixed-form handoff feedback, time-zone rendering, CSP compatibility, navigation breakpoints and mobile vital-card geometry.
- Added complete intake, shift, documentation/vitals, communication, handover, rounds, provider-down/conflict/reconciliation and nurse-call-mirror browser journeys.
- Added exact person-level `@` delivery and acknowledgement, deadline escalation to an explicit on-call role, system-principal audit, and a nurse-call rule that escalates only genuinely unacknowledged alarms.
- Added disclosure-safe sync counts for the acting role, persistent two-identifier/allergy/risk context, explicit withheld-warning language, role-projected action/approval controls and PHI-safe route-template logging.

## Validation evidence

- `pnpm verify`: formatting, lint, both TypeScript configurations, 84 unit/workflow/security/provider/FHIR tests and production build passed.
- Browser matrix: 360 px, 390 px, 768 px, 1024 px and 1440 px; 28 applicable tests passed and 52 deliberate cross-project duplicates were skipped. Role isolation (including stale and ABA completion races), role-projected actions, persistent patient safety context, offline read-only behavior, first-install service-worker offline boot, no horizontal overflow, GenUI consent/freshness, voice cancellation and all synthetic journeys were exercised.
- `pnpm verify:security`, `pnpm verify:ops` and `pnpm verify:airgap` passed; the operations probe verified liveness/readiness and a synthetic backup/restore checksum.
- A clean export excluding dependencies, generated output and local secrets completed a frozen-lockfile install, generated a mode-0600 demo environment, passed 84 tests and the complete 28-pass/52-skip browser matrix, and repeated security, restore and air-gap checks.
- The same clean export booted an isolated, empty PostgreSQL/Redis/Medplum stack, completed all Medplum R4 first-run migrations, reported Medplum `5.1.37-82e609c` ready, and materialized 3 Patient, 3 Encounter, 6 Task, 3 Observation, 1 Communication, 3 CarePlan and 4 Goal records plus Provenance/AuditEvent evidence. The first-run health grace was raised to 12 minutes after the clean audit proved that value-set/search-index construction could legitimately exceed the previous eight-minute window on a laptop.
- Reviewer probes confirmed failed-write read isolation, checkpoint-only CAS, receipt replay after LRU eviction, ambiguous-commit recovery, HMAC rotation/tamper rejection and mobile geometry.

## Evidence-backed remaining gates

- Real-patient operation requires institutional OIDC/device identity, Medplum AccessPolicy, TLS/network boundaries, retained audit export, production backup/PITR/DR evidence, monitoring and approval by privacy, security and clinical owners.
- The application intentionally runs one replica until process-local state is replaced by a coherent shared transactional read model.
- CH Core 6.0.0 is a mapping target; no executable, institution-approved profile/terminology validator package is pinned.
- Production LLM/ASR weights, Swiss clinical speech evaluation and deployment hardware remain unselected and unapproved. The deterministic clinical core remains fully operational with AI disabled.
- WiCare, careCoach, site SAP/Fiori or vital gateway, device and nurse-call production calls remain `EXTERNAL_VENDOR_GATE` until their owners provide versioned contracts, authentication, sandbox, mapping and acknowledgement semantics. The adapter SDK, gates and failure-capable simulators are complete; no private API was invented.
- Cross-client updates use a bounded three-second snapshot poll in the synthetic showcase. A production event channel (for example SSE or WebSocket behind the same authorization boundary) remains a deployment hardening item; polling does not change command correctness.

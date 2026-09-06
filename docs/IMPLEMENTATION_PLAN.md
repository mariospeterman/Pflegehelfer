# Implementation plan

Last updated: 2026-09-05

## Audited baseline and direction

The upstream repository began as architecture documentation only. The earlier in-memory reference UI has now been replaced as the normal runnable product by one mobile-first PWA and clinical BFF backed by self-hosted Medplum. A memory workspace remains only as a fast, explicitly named test fixture (`demo:test-memory` / `dev:api:test-memory`); it is not presented as the solution or production storage.

The implementation follows five enforced boundaries:

1. one GenUI conversation stream owns the staff experience while a minimal fixed shell protects identity, context, safety, sync and approval;
2. constrained OpenUI and deterministic event cards render only registered read views and typed actions;
3. every mutation crosses the deterministic Clinical Query and Action Gateway;
4. Medplum is the FHIR R4 operational workspace, with explicit source ownership;
5. one versioned provider registry drives both production gates and contract simulators.

## Completed vertical slices

### Medplum operational workspace

- Docker-pinned Medplum app/server 5.1.37, PostgreSQL 16 and Redis 7;
- FHIR Patient, Encounter, CarePlan, Goal, Task, Observation, Communication, QuestionnaireResponse, Provenance and AuditEvent projections;
- one bounded FHIR transaction per command for projections, removals, a dedicated deterministic receipt Binary and checkpoint, with deterministic IDs/provenance and stale app-owned resource cleanup;
- semantically validated workflow checkpoint with a bounded receipt hot cache; dedicated receipts avoid monolithic checkpoint growth;
- production HMAC authenticity with current/previous-key rotation, constant-time verification and conditional version writes;
- serialized in-process commands and reads, rollback/reload of the last verified checkpoint if durable persistence fails, and an explicit single-replica limit until a coherent shared read model exists;
- restart recovery proven by tests and live process restart.

### Daily clinical workflows

- conversation-first intake discrepancy review, explicit patient context, assigned shift work, alarm events and spontaneous tasks;
- vital and note drafts, structured review, configurable approval and provider sync state;
- closed-loop communication, handover sign/acknowledge, rounds decisions and follow-up tasks;
- least-privilege role views, purpose checks, version checks, idempotency and tamper-evident audit;
- explicit offline read-only behavior and visible freshness/synchronization state.

### Constrained GenUI, local AI and voice

- natural-language patient/shift queries through a typed intent gateway;
- deterministic clinical routing for common actions, optional fast OpenAI-compatible model for ambiguous phrasing;
- separate deep OpenAI-compatible model path over a versioned, role-approved local SOP corpus; local endpoints are private/allowlisted and model prose is not trusted as clinical guidance;
- OpenUI Lang rendered through an allowlisted component library; invalid/unresolved programs fail closed;
- opaque, single-use, user/patient/encounter/purpose/version-bound action tokens;
- generated drafts stay inside the conversation workspace and still require explicit clinical review;
- one compound bedside utterance can produce a visible, bound documentation/vital/message/follow-up bundle that executes only after consolidated review;
- push-to-talk browser speech for synthetic demos and a local `/audio/transcriptions` adapter for production candidates; transcription is not idempotency-cached, buffers are cleared, and identity/context changes cancel permission, recording and upload.

### Provider-neutral integration

- stable versioned adapter contract, capability manifests, source-of-truth declarations and health;
- canonical outbound commands, mapping/version metadata, payload-bound idempotency, acknowledgements and one durable patient-authorized reconciliation flow bound to the displayed versions and hashes;
- realistic WiCare, careCoach, SAP/vitals, device and nurse-call contract simulators;
- production profiles fail closed with named `EXTERNAL_VENDOR_GATE` artifacts instead of guessed endpoints or schemas;
- IT workbench exposes production gates and simulator behavior from the same registry.

## Release-gate maintenance

### Internally achievable checks

1. keep the complete format/lint/type/unit/build/E2E/security/operations suite green;
2. repeat mobile, tablet and desktop dogfooding on the actual Medplum-integrated runtime for each release;
3. repeat architecture/provider, security/clinical and frontend/QA review after material boundary changes;
4. repeat the clean-export install and completion audit and record exact evidence.

### Deployment and vendor gates

These cannot be truthfully completed from public material or synthetic data:

- institutional OIDC/Keycloak configuration, managed-device claims, AccessPolicy and passkey/break-glass approval;
- private WiCare WSDL/Gate/HL7 contract, careCoach approved interface, site SAP/device/nurse-call contracts and sandboxes;
- licensed terminology/medication packages and the institution-specific CH Core validation package set;
- selected and signed production LLM/ASR weights, Swiss clinical speech corpus evaluation and model approval;
- production HA, WORM audit archive, backup/PITR restore, monitoring, capacity and disaster-recovery evidence;
- institutional DPIA, clinical safety, accessibility and regulatory approvals.

None of these gates weakens the internally testable product: the application remains usable without AI and every unavailable external capability fails closed with a visible, specific reason.

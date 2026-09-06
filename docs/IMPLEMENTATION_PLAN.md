# Implementation plan

Last updated: 2026-09-06

## Direction

The controlling invariant is one persistent GenUI/chat/voice clinical coworker. `docs/ARCHITECTURE.md`, `PRODUCT_EXPERIENCE.md` and `WORKFLOWS.md` are the single coherent target. Old focus dashboards, module tabs, projection registries, client-simulated streaming and Medplum conversation Binary storage are removed rather than maintained in parallel.

## Completed in this refactor

1. Consolidated the duplicated architecture and repository instruction into one target; added product-experience/workflow contracts and superseded the checkpoint ADR.
2. Replaced the four-focus PWA with a conversation-dominant shell, desktop context/history sidebar, mobile drawer, explicit permanent patient safety context, role-specific opening, synthetic disclaimer, responsive system dark/light palette and original Edelweiss/cross mark.
3. Added real NDJSON response transport. Partial frames contain no executable component; only the durable final frame activates review. Removed the frontend timer that imitated model streaming.
4. Added a separate model-facing composition grammar containing only `ClinicalStack`, `Candidate` and opaque candidate handles. The server hydrates clinical facts/actions from its authorized typed candidate set; malformed or extra model output falls back deterministically.
5. Added schema-validated role workflows, immutable version seeds and `WorkingSession`/thread/context models.
6. Added the separate PostgreSQL operational service and idempotent migration with organization/department, workflow template/version/session/step, assistant thread/message, safety authority, domain events, receipts, inbox/outbox/cursor/receipt/conflict, audit and bounded analytics tables.
7. Moved assistant conversation persistence and patient context revisions to the operational store. Added deterministic in-memory test double and actual PostgreSQL smoke coverage.
8. Kept all undocumented real provider operations gated while retaining simulator/contract coverage.
9. Closed review-found demo safety defects: body/session patient mismatch is rejected for query, voice and execution; context switches revoke actor intents; partial stream programs contain no executable tokens; stale-source approvals fail; versionless provider inbox dedupe is normalized; operational PostgreSQL participates in readiness.

## Remaining implementation sequence

These are internal release requirements, not external gates:

1. Move opaque intent and voice receipt issuance/consumption from process maps into `safety_authority`, with hash-only tokens and one transaction binding command, approval, workflow step, audit, domain event and outbox.
2. Move the remaining monolithic clinical service checkpoint authority to resource-scoped Medplum repositories; remove checkpoint Binary and whole-state rewrite after reconstruction parity tests.
3. Move existing provider outbound items into `provider_outbox`; add leased automatic worker, retry/dead/manual states and receipts. Add durable authenticated inbound polling/event worker with cursor/dedupe/quarantine/conflict handling.
4. Replace process-local invalidation revision with audience-scoped `domain_events` replay across restart/replicas and proactive thread insertion.
5. Implement Workflow Studio CRUD/publish/activation and deterministic step progression for all reference role workflows, not only role-aware session start.
6. Expand server-hydrated GenUI components for actionable tasks, team replies/acknowledgements, workflow progress, documentation diffs, rounds, provider receipt/conflict and editable bounded forms.
7. Complete operational RLS/least-privilege roles, expiry sweepers, audit-chain migration, analytics small-cell suppression and backup/PITR restore automation.
8. Complete the browser journeys for the full nursing/physician loops and validate with approved production local model/ASR packs.

## External gates

- institution OIDC/MFA/device claims, Medplum AccessPolicy and break-glass approval;
- private WiCare/careCoach/SAP/device/nurse-call contracts, credentials and sandboxes;
- licensed terminology/institution profile approval;
- signed model/ASR artifacts and Swiss clinical evaluation;
- target-environment HA, WORM audit, monitoring, capacity, DR, DPIA, accessibility, security/regulatory and clinical-owner sign-off.

Simulators and repository documentation never satisfy these gates.

## Loop

Each remaining slice must update the status, implement one end-to-end capability, run focused and regression tests, launch the PostgreSQL/Medplum-backed PWA, inspect responsive/accessibility/offline/reconnect/log/sync behaviour, obtain independent architecture/security/clinical/frontend review, fix valid findings and rerun the clean-checkout audit in `agent.md`.

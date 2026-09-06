# Implementation plan

Last updated: 2026-09-06

## Product invariant

Pflegehelfer is GenUI/chat/voice-first. One shift conversation is the primary workspace; patient summaries, tasks, vitals, documentation, handover, rounds, communication and synchronization appear as bounded interactive components. Fixed UI is limited to identity, patient/role context, history, safety, offline/sync state and deterministic approvals. Medplum remains the detailed FHIR workspace, not a second competing daily UI.

## Implemented vertical slices

- explicit patient selection and a continuous actor-bound shift conversation;
- purpose-built OpenUI patient/task/vital/handover/medication/policy and action-review components;
- deterministic Clinical Query and Action Gateway with RBAC/ABAC, version binding, one-use intents, audit and idempotency;
- safe compound care updates whose model output cannot author executable fields;
- note/vital draft approval, tasks, team communication, handover, rounds, intake and reconciliation;
- self-hosted Medplum projection, restart checkpoint, command receipts and executable pinned FHIR validation;
- local AI/ASR adapters with explicit data boundaries, synthetic provider simulators and per-operation vendor gates;
- PHI-free SSE invalidation, read-only offline behavior and responsive synthetic end-to-end journeys.

## Next internal slices, in order

1. Replace the monolithic in-process checkpoint with PostgreSQL operational repositories and migrations; reconstruct clinical views from FHIR plus explicit operational tables. Bound/partition audit storage and remove full-checkpoint rewrites.
2. Add a durable event/outbox worker with leases, retry/dead-letter semantics and multi-replica replay. Move provider outbound delivery off the manual request path.
3. Implement the provider inbound worker: durable provider cursor, inbox/idempotency, mapping/version provenance, policy application and conflict/reconciliation creation. Keep production capabilities gated until real contracts pass conformance fixtures.
4. Move shift conversation state to versioned/CAS operational storage with explicit shift/session identity, size limits and transactional audit coupling. Add an expiry sweeper.
5. Add true server transport streaming for OpenUI. Permit model composition only as selection/arrangement of already authorized component references; validate the complete program and hydrate all facts from trusted results.
6. Expand voice safety with per-segment evidence, edited-span tracking, governed entity dictionaries and end-to-end receipt tests against an approved local ASR runtime.
7. Remove synthetic-only metadata assumptions from production projection cleanup and complete institution profile/terminology fixtures.

## Release loop

For each slice: implement a complete workflow, run targeted tests, run full verification, launch the Medplum-backed PWA, inspect mobile/tablet/desktop/offline/permissions/logs, repeat architecture/security/clinical/frontend review, fix valid findings, then perform the clean-checkout audit from `AGENTS.md`.

## External deployment gates

- institution OIDC/MFA/passkey, managed-device claims, AccessPolicy and break-glass approval;
- private WiCare/careCoach/SAP/device/nurse-call contracts, credentials and sandboxes;
- licensed terminology and institution-approved CH Core/CH EMED profile set;
- signed production LLM/ASR artifacts, Swiss clinical evaluation and clinical-owner approval;
- production HA, backup/PITR restore, WORM audit, monitoring, capacity and disaster-recovery evidence;
- institutional DPIA, accessibility, security, regulatory and clinical-safety sign-off.

These are not substitutes for the internal work above and must not be marked complete by a simulator.

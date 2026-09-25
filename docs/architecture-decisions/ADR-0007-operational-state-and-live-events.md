# ADR-0007: Separate operational state and durable live events

- Status: Accepted
- Date: 2026-09-06
- Clarifies: ADR-0004

## Context

Medplum is the canonical FHIR workspace, but FHIR resources alone do not conveniently own ephemeral shift conversations, command receipts, provider inbox/outbox leases, cursors, workflow locks and replayable UI invalidations. The current showcase projects one in-process state machine and stores an HMAC-protected recovery checkpoint plus conversations in Binary resources. That proves restart behavior but creates write amplification, cross-tab races and a single-replica boundary.

## Decision

Keep a modular monolith, but use two explicit persistence ports:

1. Medplum stores canonical FHIR R4 clinical resources and their Provenance/AuditEvent projection.
2. PostgreSQL stores versioned operational workflow state, idempotency receipts, conversation sessions, provider inbox/outbox/cursors, worker leases and a transactional event log.

Committed mutations write operational state and an event/outbox record in one database transaction. Workers project to Medplum/providers idempotently. Clients resume opaque, PHI-free invalidation events by revision. Conversation rows use optimistic concurrency, bounded serialized size, explicit shift/session identity and physical expiry deletion.

## Transitional implementation

The integrated profile now atomically persists reviewed assistant command acceptance, matching episode evidence, the latest recovery checkpoint and resource/provider delivery jobs in PostgreSQL, then runs leased workers from the normal server lifecycle. Startup restores the newest local acceptance before traffic; projection remains worker-owned. The accepted assistant path removes its old in-process queue copy; the legacy processor is not callable and unmigrated direct clinical writes fail closed in this profile. The checkpoint Binary remains a migration seam, and resource-native reconstruction, inbound processing, multi-replica replay, identity and deployment controls remain `PARTIAL`. The memory profile remains explicitly fictional and non-durable.

## Consequences

- No microservice split is required; ports remain replaceable inside one deployable backend.
- Medplum remains the clinical interoperability workspace rather than a dumping ground for runtime locks and chat sessions.
- Multi-replica consistency, provider delivery and client replay become testable without weakening clinical authorization.

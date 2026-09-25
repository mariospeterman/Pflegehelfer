# ADR-0004: Medplum operational workspace with atomic workflow checkpoint

- Status: Superseded by ADR-0007
- Date: 2026-09-05

## Context

FHIR projections alone do not reconstruct every deterministic workflow invariant, approval state, outbox receipt and hash-chained audit entry. Keeping those only in process memory made the runnable product unrelated to the required Medplum architecture.

## Decision

Use self-hosted Medplum as the durable operational workspace. Persist every command's canonical FHIR projection delta, removals, dedicated deterministic idempotency-receipt Binary and deterministic service checkpoint in one bounded FHIR transaction. The checkpoint retains only a bounded hot receipt cache; older receipts remain individually addressable without growing one monolithic Binary. Very-restricted Binaries are structurally and semantically validated; production signs them with an HMAC. The current key signs writes, named previous keys permit a controlled read-and-re-sign rotation, and comparisons are constant-time. Conditional `If-Match` checkpoint updates reject stale writers. Reads queue behind the in-process commit boundary so rolled-back state is never observable. Remove only stale app-owned synthetic resources at startup. Preserve provider ownership and source metadata; Medplum is not declared authoritative for copied external fields, and direct UI links are inspection-only until governed inbound editing exists.

## Consequences

- The integrated showcase survives API restarts and exposes matching FHIR resources in Medplum.
- A failed durable write cannot leave acknowledged in-process state.
- The Binary is an interim modular-monolith control-plane persistence format and must receive the same encryption/access/backup controls as other clinical data.
- This implementation runs one application replica. Multi-replica serving remains blocked until a coherent shared read model replaces process-local state; optimistic write CAS alone is insufficient.
- Production scaling may replace the checkpoint with resource-scoped repositories/event storage behind the same service checkpoint/clinical-data port, without changing the PWA contract.

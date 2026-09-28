# ADR-0002: Capability-driven simulators and vendor gates

- Status: Accepted
- Date: 2026-09-05

## Context

Public WiCare and careCoach material describes products and broad integration capabilities but does not publish the schemas, authentication, concurrency or acknowledgement contracts needed to execute safe writes. SAP and nurse-call interfaces are installation-specific.

## Decision

Maintain separate production and simulator capability manifests. The reference slice implements immutable outbound commands, idempotency, receipts, polling and named failure simulators. Production capabilities remain `external-vendor-gate` and contain no guessed URLs or payload fields. The asynchronous inbound/mapping/reconciliation SDK is required before a production adapter can be activated.

## Consequences

- The implemented outbound reference behavior is deterministic and testable.
- Simulator success is never evidence of vendor connectivity.
- Each private contract is tracked as a narrow `EXTERNAL_VENDOR_GATE` with required artifacts and a test activation path.
- Conflicting simulator commands expose a synthetic remote snapshot only to an authorised treating nurse/physician. The user must compare local and remote content before a new idempotent retry is created and audited. This proves the workflow; it is not evidence that any real provider supplies the required snapshot or concurrency contract.

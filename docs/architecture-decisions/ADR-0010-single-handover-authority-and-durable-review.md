# ADR-0010: One responsibility authority and durable human review

Status: accepted

Date: 2026-09-09

## Context

The earlier showcase contained two concepts named handover: seeded clinical records in the Medplum checkpoint projection and the PostgreSQL workday roster/episodes. It also issued one-use assistant and voice authority in process memory. That combination could produce conflicting responsibility state after a restart and made “reviewed”, “approved locally” and “acknowledged externally” difficult to distinguish.

## Decision

The PostgreSQL workday is the only live responsibility authority. Patient-by-patient roster acknowledgement, current/paused episodes, evidence, defer decisions, outgoing receipts and receiving-shift acknowledgement live there. Seeded mutable handover records and their mutation routes are removed. Historical provider/FHIR documents may be authorized evidence, never a fallback transition state.

Assistant and server-ASR authority is short-lived, stored only by token hash and bound to actor/session/thread/context/patient plus proposal or transcript data. A valid unconsumed record can be restored after an API restart; atomic claiming prevents concurrent replay. A pre-side-effect validation failure may deliberately release that claim for corrected review; after a successful mutation the authority remains consumed. Context mismatch does not reveal or consume unrelated authority. Full cross-store acceptance atomicity remains the explicit gap below.

One visible staff review is enough for standard permitted note/measurement work to become locally approved. Provider delivery remains a separate visible state. A doubtful measurement uses `high-assurance`: first review yields `reviewed`, current-vitals projections exclude it, and only an independent authorized identity can countersign it. Role-addressed team work stays in the role queue until claimed; collection order never chooses a person.

## Consequences

- Nursing responsibility has one restart-safe state machine and an explicit receipt boundary.
- API/UI copy can state sent, accepted locally, independently reviewed and externally acknowledged without conflating them.
- A better model can improve interpretation but cannot create authority or turn a reviewed outlier into a current fact.
- The remaining production transaction gap is explicit: clinical service/checkpoint mutation and operational PostgreSQL acceptance are not yet one cross-store transaction. ADR-0007 remains the target for relational outbox projection and checkpoint retirement.

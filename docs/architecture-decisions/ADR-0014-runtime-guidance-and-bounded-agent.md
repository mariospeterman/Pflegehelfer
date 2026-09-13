# ADR-0014: Immutable runtime guidance and a bounded tool agent

Status: Accepted
Date: 2026-09-13

## Decision

Pflegehelfer uses one reusable bounded assistant runtime. A published directory
manifest pins the exact base, institution, department, station, role, provider
and workflow Markdown by SHA-256 and produces one immutable pack digest. Typed
site configuration remains the executable source for permissions, assignments
and workflow definitions; Markdown can only guide language and tool selection.

For eligible read/navigation requests, the configured local model (or the
explicit synthetic hosted-test profile) selects from a request-specific typed
tool allow-list, observes bounded results and may select another tool. The loop
has hard turn, call, repeat, time and result-size budgets. Tools receive actor,
tenant, thread, patient and encounter scope from trusted server context, never
from model arguments. No SQL, shell, unrestricted HTTP, policy publication,
approval or final-write tool is registered.

The model's terminal prose is not a clinical fact source. The server uses the
selected tool only to choose a deterministic, authorized clinical projection
and grounded GenUI lead. Mutation requests continue through the generic typed
proposal compiler, independent validation, one-use review authority and human
approval.

Provider delivery uses a separate relational worker kernel with validated
write-only commands, leases, receipt polling and fail-closed uncertain-outcome
handling. It is not the live application queue until accepted commands are
atomically enqueued by the main command path.

## Consequences

- A model swap can improve interpretation without changing clinical authority.
- Progressive workflow skills are discoverable by ID/description and loaded
  only through the reviewed manifest; unrelated roles and files stay absent.
- Array order never selects a staff role profile, station, recipient or policy.
- An available model is optional for critical work and a failed agent run is
  explicitly degraded.
- Database-backed pack publication/signatures, full shared-thread ACLs and the
  atomic application-to-provider outbox transition remain separate completion
  gates rather than being implied by this decision.

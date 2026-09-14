# ADR-0014: Immutable runtime guidance and a bounded tool agent

Status: Accepted
Date: 2026-09-13

## Decision

Pflegehelfer uses one reusable bounded assistant runtime. A published directory
manifest pins the exact base, institution, department, station, role, provider
and workflow Markdown by SHA-256 and produces one immutable pack digest. Typed
site configuration remains the executable source for permissions, assignments
and workflow definitions; Markdown can only guide language and tool selection.

For eligible natural requests, the configured local model (or the explicit
synthetic hosted-test profile) selects from a request-specific typed read or
draft-preparation tool allow-list, observes bounded results and may select
another tool. It does not first require another model to reduce the message to
an intent enum. The loop has hard turn, call, repeat, time and result-size
budgets. Tools receive actor, tenant, thread, patient, encounter and exact
source text from trusted server context, never from model arguments. No SQL,
shell, unrestricted HTTP, policy publication, approval or final-write tool is
registered.

The model's terminal prose is not a clinical fact source. Read tools hydrate an
authorized clinical projection and grounded GenUI lead. A draft tool may invoke
the generic typed proposal compiler, but it returns only an opaque reference
and compact review metadata to the model. Independent validation, one-use
review authority and human approval remain mandatory before any mutation.

Provider delivery uses the relational worker with validated write-only
commands, leases, receipt polling, mandatory remote read-back and fail-closed
uncertain-outcome handling. Reviewed assistant commands atomically enqueue
their provider and version-bound Medplum projection jobs with the accepted
command, episode evidence, recovery checkpoint and authority envelope. The
normal integrated server starts both workers. Unmigrated direct non-assistant
clinical writes fail closed; inbound/conflict processing remains migration
work.

## Consequences

- A model swap can improve interpretation without changing clinical authority.
- Progressive workflow skills are discoverable by ID/description and loaded
  only through the reviewed manifest; unrelated roles and files stay absent.
- Array order never selects a staff role profile, station, recipient or policy.
- An available model is optional for critical work and a failed agent run is
  explicitly degraded.
- Database-backed pack publication/signatures, full shared-thread ACLs,
  resource-native reconstruction, remaining direct-command migration and
  relational inbound/conflict processing remain separate completion gates.

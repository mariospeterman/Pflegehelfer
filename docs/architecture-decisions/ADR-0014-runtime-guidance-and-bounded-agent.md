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

The model's terminal prose is not a clinical fact source. Read tools expose
run-local opaque handles and bounded facts; stable identifiers, versions,
hashes and row provenance remain in the server evidence registry. The model
selects exact claims and optional presentation, and deterministic code renders
the grounded GenUI lead. A draft tool may invoke
the generic typed proposal compiler, but it returns only an opaque reference
and compact review metadata to the model. Independent validation, one-use
review authority and human approval remain mandatory before any mutation.

OpenClaw 2.0 and Hermes Agent were re-evaluated against their official
September 2026 documentation. Both are useful general-purpose, self-hostable,
provider-flexible agent runtimes, but neither becomes Pflegehelfer's
application, memory authority or integration gateway. OpenClaw documents one
trust boundary per Gateway rather than hostile multi-tenant isolation. Hermes
documents a single-tenant personal-agent trust model in which plugins, skills
and MCP servers share the agent's privileges. Those boundaries cannot replace
Pflegehelfer's institution/site/role/patient/encounter authorization,
PostgreSQL work authority, Medplum record authority, reviewed proposal
lifecycle or provider receipts. Either runtime may be evaluated later behind
the existing `ModelGateway` as a credential-free inference implementation. It
must receive only the same bounded request and tool results, have no direct
database or provider credentials, and pass the same no-write and application
acceptance suites. Direct OpenAI-compatible local/hosted adapters remain the
simpler current implementation.

Self-hosted or air-gapped deployment and model-provider neutrality are
technical capabilities, not Swiss privacy, institutional or medical-device
approval. Vendor connectors for Medplum, WiCare, careCoach, SAP or Microsoft
Teams remain separate governed adapters with institution-specific contracts,
mapping, authentication and acceptance. A channel or agent plugin never
inherits clinical write authority.

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
- Reviewed SHA-pinned Markdown and typed workflow/playbook configuration are
  the correct current pattern. The missing publication/signature/activation UI
  and institutional approval remain G5 gaps; installing another agent runtime
  would not close them.

# ADR-0006: GenUI conversation is the primary staff workspace

- Status: Accepted
- Date: 2026-09-05
- Supersedes: the fixed-workflow ownership decision in ADR-0005
- Partially superseded by: ADR-0012 for conversation scoping; the GenUI-primary decision remains active

## Context

The first PWA interpretation put `Heute`, rooms, patients, handover and inbox in
separate conventional pages and opened the assistant in a secondary modal.
Although safe, that structure reproduced the navigation burden of existing
care-management products and contradicted the intended natural-language
coworker experience.

## Decision

Use one text/voice conversation engine and clinical-event presentation as the
primary staff workspace. ADR-0012 refines this into a working session with
multiple explicitly scoped transcripts. Deterministic shift state, patient
context, tasks, communications, handover, rounds, alerts and synchronization
results render in the appropriate scoped conversation.
OpenUI responses use only the signed clinical catalog. Compact modes filter the
stream; they do not own separate workflows.

Keep fixed, manually designed UI only for authentication, active role and
patient context, navigation/history, offline/sync state, break-glass, medication
safety and explicit approvals. A structured action sheet is allowed inside the
conversation when deterministic data entry is safer than free text.

The LLM remains assistive. It may classify language and propose registered
components. Typed application code independently authorizes, validates,
persists to Medplum, audits and synchronizes through adapters. A compound
utterance may create a visible bundle, but one server-bound approval can execute
only its enumerated typed commands.

Vercel's official chatbot template was reviewed for interaction patterns
(message stream, multimodal composer and tool-result UI), but is not adopted as
a runtime dependency. The existing React PWA and self-hosted OpenUI renderer
meet those needs without adding Next.js, hosted storage or an AI gateway.

## Consequences

- Staff can complete routine work without navigating the Medplum UI.
- Medplum remains available as the detailed FHIR workspace for authorized deep
  work, investigation and administration.
- AI/model outages degrade intent interpretation, not core clinical work.
- Team messages remain structured, patient-bound, role-authorized and
  acknowledged even though they look conversational.
- The product keeps a modular-monolith deployment and does not add microservices
  merely to support a chat-shaped interface.

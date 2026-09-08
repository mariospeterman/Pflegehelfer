# Pflegehelfer product contract

Status: active acceptance contract
Last updated: 2026-09-06

Pflegehelfer is one interruption-tolerant, mobile-first clinical coworker for authorised staff. The same conversation accepts speech, text and direct taps; materialises stable clinical GenUI components; keeps the active patient and responsibility visible; and routes approved work to Medplum and configured providers. Chat-first is not chat-only: quick lenses, compact tables, forms and deterministic controls are part of the conversation when they reduce effort.

The invariant is **conversational outside, structured inside**. Employees never fill or see an `AssistantProposal`; they talk naturally, receive a short coworker response, and see only the minimum editable GenUI required for the current safe review.

## Authority boundary

- A model may interpret language, identify evidence spans, ask clarifying questions and compose allowlisted presentation.
- A model never supplies identity, permission, clinical truth, urgency, completion, provider capability or executable authority.
- Internally, one generic typed `AssistantProposal` separates understood facts, performed work, observations, task changes, communications, workflow actions, ambiguities and evidence. Deterministic server code validates its specific executable sub-schemas against source text and current authorised resources, presents the exact meaningful change, binds approval to that version and executes an idempotent command graph.
- Negation, uncertainty, historical reporting, occurrence time and correction remain explicit. Missing intent never becomes a default physician message, repeat measurement, elevated priority, completion or billable activity.
- Medplum owns clinical FHIR resources and provenance. Pflegehelfer PostgreSQL owns workflow/session/episode state, proposals, approvals, receipts, durable events and provider delivery. Provider systems remain authoritative only for configured domains.

## Reference workday

An authorised employee resumes the current shift, reviews a versioned handover roster, adjusts a constraint-based morning plan, opens a patient-bound care episode, records planned or spontaneous work, pauses for an interruption, explicitly changes patient context, returns to the preserved episode and closes the shift with an event delta and responsibility transfer. Approved events are saved during the shift; shift close never resubmits them.

The employee can ask a scoped team question, mention a permitted person or role pool, reply, acknowledge and close the obligation. A mention never grants access. The primary nurse-call/alarm system remains independent; Pflegehelfer mirrors permitted events as secondary work.

## Six evidence gates

1. **Compiler:** multiple facts/actions are supported; negated and historical clauses cannot become positive commands; unknowns become clarifications; approval binds to the normalized proposal and read set.
2. **Interrupted shift:** handover, plan, care episodes, interruption/resumption, spontaneous work, collaboration, shift reconciliation and next-shift acknowledgment survive refresh/restart without duplicate documentation.
3. **Durable execution:** PostgreSQL transactions own intent consumption, approval, command state, workflow mutation, event and outbox. Workers lease/retry/reconcile provider/FHIR operations; ambiguous outcomes remain visible; the legacy whole-state checkpoint is not a live source of truth.
4. **Speech and GenUI:** production-local mode blocks external inference. Explicit synthetic-development mode can use server-held OpenAI credentials for Responses and file/realtime transcription. Microphone recording yields an editable, patient-bound transcript; useful stable artifacts work equally through text/tap.
5. **Role/site/collaboration:** one binary configures multiple synthetic institutions, sites, wards, role/capability profiles and published workflow versions. Scoped threads, directory mentions and event replay reauthorise every read.
6. **Knowledge/evidence/deployment:** approved knowledge keeps owner/version/audience/retraction; service evidence is distinct from billing eligibility; analytics are aggregate and small-cell suppressed; clean install, migration, backup/restore, rollback and deployment blockers have executable evidence.

## Readiness language

Use `SYNTHETIC-DEMO`, `TECHNICAL-PILOT-CANDIDATE` and `INSTITUTIONALLY-APPROVED-PILOT`. Simulator success, schema-only tables, fixture model output and undocumented vendor calls are never production evidence. Private WiCare, careCoach, SAP/device, nurse-call and institution Loop contracts remain operation-specific `EXTERNAL_VENDOR_GATE`s until supplied and tested.

The detailed acceptance scenarios are maintained in `docs/IMPLEMENTATION_PLAN.md`; architectural ownership remains in `docs/ARCHITECTURE.md`.

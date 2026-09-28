# Pflegehelfer product contract

Status: active acceptance contract
Last updated: 2026-09-12

Pflegehelfer is one interruption-tolerant, mobile-first clinical coworker for authorised staff. The same conversation accepts speech, text and direct taps; materialises stable clinical GenUI components; keeps the active patient and responsibility visible; and routes approved work to Medplum and configured providers. Chat-first is not chat-only: quick lenses, compact tables, forms and deterministic controls are part of the conversation when they reduce effort.

One coherent working session may link multiple explicitly scoped conversations: a private general assistant, private patient-and-encounter assistants and separately authorized patient-team, department or direct threads. Scope changes preserve shift progress and per-thread continuity without mixing prompts, drafts or audiences. This supersedes the former one-giant-transcript rule.

The invariant is **conversational outside, structured inside**. Employees never fill or see an `AssistantProposal`; they talk naturally, receive a short coworker response, and see only the minimum editable GenUI required for the current safe review.

The assistant is natural on top and controlled underneath. Ordinary questions normally get concise, source-linked model-authored answers without a proposal. “Deterministic” means that reviewed meaning is independently validated, authorized, versioned, persisted and delivered; it does not mean scripted conversation. Without an accepted model, the product labels degraded operation and offers direct records/work controls plus verbatim review—it does not pretend to understand arbitrary language.

## Authority boundary

- A model may interpret language, identify evidence spans, ask clarifying questions and compose allowlisted presentation.
- A model never supplies identity, permission, clinical truth, urgency, completion, provider capability or executable authority.
- Internally, one generic typed `AssistantProposal` separates understood facts, performed work, observations, task changes, communications, workflow actions, ambiguities and evidence. Deterministic server code validates its specific executable sub-schemas against source text and current authorised resources, presents the exact meaningful change, binds approval to that version and executes an idempotent command graph.
- Negation, uncertainty, historical reporting, occurrence time and correction remain explicit. Missing intent never becomes a default physician message, repeat measurement, elevated priority, completion or billable activity.
- Medplum owns clinical FHIR resources and provenance. Pflegehelfer PostgreSQL owns workflow/session/episode state, proposals, approvals, receipts, durable events and provider delivery. Provider systems remain authoritative only for configured domains.
- Original input/reviewed transcript, provider/history evidence, model interpretation, reviewed revision, accepted content and downstream receipt are distinct records. A schema-valid or human-approved report is attributable evidence, not proof that the reported care occurred, a zero-hallucination claim or compliance certification.

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

Organizational-value reporting compares the institution's actually available current process, feasible incumbent improvement and any approved general-assistant alternative against Pflegehelfer using the same declared eligible work and definitions. Unknown baselines are not measured, negative results remain visible, and observed, customer-reported, estimated and synthetic evidence never shares a headline. Review, correction, failure and downstream reconciliation count as burden. Private chats, presence, care timers and covert interaction surveillance are not productivity inputs; released time is not automatically cash saving, tariff evidence or customer benefit.

The commercial unit is the organization agreement, never an employee, account, device, role or AI seat. The active model separates a paid discovery/implementation pilot, one-time deployment/onboarding, a monthly contract-scoped organization subscription and additional pooled provider-reported AI/speech usage. BYO-key usage is visible but not charged twice; local inference has no invented cloud fee. Missing usage/cost stays unavailable. Authorized statement drafts and limits do not collect payment or change access rights; an exhausted measured AI limit may pause new inference only, never manual work, existing records or delivery/recovery of approved changes.

## Readiness language

Use `SYNTHETIC-DEMO`, `TECHNICAL-PILOT-CANDIDATE` and `INSTITUTIONALLY-APPROVED-PILOT`. Simulator success, schema-only tables, fixture model output and undocumented vendor calls are never production evidence. Private WiCare, careCoach, SAP/device, nurse-call and institution Loop contracts remain operation-specific `EXTERNAL_VENDOR_GATE`s until supplied and tested.

The detailed acceptance scenarios are maintained in `docs/IMPLEMENTATION_PLAN.md`; architectural ownership remains in `docs/ARCHITECTURE.md`.

# Pflegehelfer agent contract

This is the repository’s binding implementation/review contract. `docs/PRODUCT_CONTRACT.md` defines acceptance, `docs/ARCHITECTURE.md` defines ownership, and `docs/PRODUCT_EXPERIENCE.md` plus `docs/WORKFLOWS.md` define experience and journeys.

## Product direction

Pflegehelfer is one GenUI/chat/voice-first clinical coworker, not a dashboard with an assistant added. The conversation stream owns daily workflow. Handover, patient context, tasks/alarms, observations, documentation, team questions/mentions, approvals, rounds and synchronization appear as contextual interactive components in one persistent thread. Fixed UI is limited to authentication; identity/role/patient context; history/sidebar/drawer; safety/offline/sync state; deterministic review; and an expert Medplum link.

The invariant is **conversational outside, structured inside**. Staff speaks or types naturally; the assistant uses current patient, workflow, task and session context, responds as a concise coworker, asks at most one necessary clarification, and then shows the smallest editable GenUI review. Never expose `AssistantProposal`, intent or schema language in staff-facing copy and never turn the conversation into a form wizard.

Do not introduce `Focus`, module tabs, separate workflow pages, dashboard projections, per-focus conversation IDs, hidden patient switching or browser-only clinical state. Mobile is one feed plus a drawer. Use **Tertianum Kronenhof · Demo** and state that all people/records are fictional.

## Required architecture

- Modular TypeScript monolith plus PWA.
- Medplum FHIR owns clinical resources/provenance.
- PostgreSQL owns workflow/session, thread/context, intents/approvals/receipts, durable events, provider inbox/outbox/cursors/receipts/conflicts and minimal idempotency.
- Provider-neutral adapters isolate WiCare, careCoach, SAP/vitals, devices, nurse call and future systems.
- Local AI/ASR is production default; hosted AI is synthetic-demo only.
- OpenUI streams over real transport and is rendered from a strict allowlist.
- Model-facing schemas never expose action tokens/routes, patient/source identifiers, authorization claims or clinical authority.
- Models interpret/compose; deterministic server code authorizes, validates, versions and executes.
- Writes requiring review remain draft until explicit approval and visibly pending until external acknowledgement.
- Site packs may narrow centrally reviewed role ceilings and assign reviewer qualifications; they never grant new authority.
- FHIR identifiers, tags, cleanup and legacy migrations are bound to institution/site. Unscoped legacy state is default-denied.

The baseline excludes microservices, Flowable, NATS/Kafka, vector databases and Kubernetes without measured need/new ADR.

There is one live responsibility authority: the PostgreSQL workday with explicit patient acknowledgement, patient/encounter-bound episodes and receiving-shift receipts. Imported provider documents can be source evidence but never a mutable or fallback handover state. Role-addressed team work remains unassigned until claimed; array order is never identity or delegation policy. A `high-assurance` observation remains `reviewed`, is excluded from current-vitals queries and needs an independent authorized countersignature before approval/provider delivery.

Handover acknowledgements bind the exact handover ID/version and responsible actor. Completed episodes, resolved planned responsibility and transferred shifts are terminal. Recent model context is filtered to the active authorized patient and retains the patient/context revision captured when each turn began.

## Workflow and safety

`WorkflowTemplate` has immutable published versions. `WorkingSession` binds actor/role/organization, template version, assistant thread, step and context revision. Sign-in resumes/starts the active role workflow and places the next safe step in conversation. Workflow data is bounded and cannot execute code, grant policy, weaken approval, enable providers or auto-select patients.

The model never diagnoses, prescribes, approves, signs, invents facts, chooses capabilities or bypasses policy. Internally it may propose meaning through a generic typed `AssistantProposal` containing understood facts, work performed, observations, task changes, communications, workflow actions, ambiguities and evidence. Specific deterministic sub-schemas alone can execute. Preserve negation, uncertainty, historical reporting, partial/deferred work, interruption, delegation, communication, corrections and occurrence time. Every read/action is tenant-, role-, purpose-, relationship-, state- and ownership-checked. One-use intent authority binds actor, organization, patient/encounter, session/thread, workflow and context/source/policy versions; store only a hash. Patient-context change is a server event that invalidates stale intent/voice authority. Raw audio is not persisted. Medication/treatment/diagnostic commands fail closed into separately governed workflows. Do not log clinical content, model output or secrets.

Generic free-text task creation rejects ambiguous administration verbs such as `geben`; basic-care work uses unambiguous verbs such as unterstützen, helfen or begleiten. Approved chat evidence for the active patient/encounter is reused in the current care-episode draft so staff does not repeat documentation, but episode completion remains a separate explicit act.

## Provider honesty

Never invent undocumented WiCare, careCoach, SAP, device or nurse-call contracts. Implement/test the neutral adapter, durable inbox/outbox and realistic simulators. Mark missing external evidence `EXTERNAL_VENDOR_GATE` per capability; one gated operation must not disable a verified one.

## Engineering loop

Before changing behaviour, read this file, canonical architecture, relevant ADRs/docs/source/tests and audit the app. Verify version-sensitive assumptions using official primary sources and record them in `docs/research/VERIFIED_SOURCES.md`. Update the implementation plan before structural code.

Implement complete vertical slices. Continuously run targeted/regression tests. Launch the real PWA and inspect mobile/tablet/desktop workflows, console/network/server logs, keyboard/accessibility, permissions, offline/reconnect, sync and errors. Never weaken requirements or tests.

Use separate architecture/provider, security/privacy/clinical-safety and frontend/UX/QA reviewers when agents are available; fix valid findings and repeat review. Keep code modular, typed, deterministic, secure, air-gap capable, maintainable and simple. Remove superseded paths/docs instead of retaining duplicates.

## Clean-checkout completion audit

With pinned Node/pnpm: generate uncommitted demo env; start operational PostgreSQL, Medplum/PostgreSQL/Redis and app; run migrations twice; seed only synthetic data; run format, lint, both TypeScript builds, tests, security/ops checks, build and browser E2E; exercise nursing/physician, voice review, multi-action approval, team mention/reply, alarm task, offline recovery, provider retry/conflict/reconciliation, restart and SSE replay; inspect responsive/accessibility output; verify no secrets/PHI, no obsolete UI/checkpoint, and honest vendor gates; update status/review with exact evidence.

Do not claim scaffolding, mocks, simulators or unverified vendor integration as production-complete. Report evidence-backed limitations honestly.

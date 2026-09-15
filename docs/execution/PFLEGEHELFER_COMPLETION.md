# Pflegehelfer — Agent-led Conversation and Verified Product Completion

**Date:** 14 September 2026

**Repository:** `mariospeterman/Pflegehelfer`

**Branch:** `codex/genui-production-showcase`

**Source-audited head:** `2b1233d575fb8c33b9f5b98f1211171cd4401e2e`

**Canonical destination:** `docs/execution/PFLEGEHELFER_COMPLETION.md`

> **A natural agentic coworker on top, faithful reviewed documentation underneath—not a deterministic chatbot and not an unrestricted model writing records.**
>
> The assistant understands and communicates. Approved Markdown explains institutional work. Reusable tools provide capabilities. The backend enforces access, records human approval and reliably delivers exactly the approved changes.

This is an IMPLEMENTATION contract for Codex, not the deployed assistant's system prompt. Complete the existing product in coherent slices. Do not produce another prototype, another full-stack rewrite or a plan-only response. Paths and capabilities below are targets unless explicitly identified as current evidence.

## 1. Reconcile the current task and finish it without another direction change

Read the actual current worktree, including uncommitted work, before making changes. It may be newer than the audited head. Preserve other agents' work and do not reset databases, rewrite Git history or overwrite unrelated changes.

Reconcile this instruction into the following existing documents:

- `docs/execution/PFLEGEHELFER_COMPLETION.md`: the single current implementation contract.
- `docs/execution/COMPLETION_MATRIX.md`: the existing G0–G7 evidence and acceptance index.
- `docs/execution/ACCEPTANCE_RECOVERY_2026-09-13.md`: the existing integrated-profile recovery/evidence record, which now exists in the audited commit.
- `docs/ARCHITECTURE.md`, active product/workflow documents, relevant ADRs, `AGENTS.md`, `agent.md` and runtime guidance where statements conflict.

Retain all still-applicable acceptance identifiers from the prior contracts, including MD, CT, WF, TX, AI, VA, UI and AG families. Map them to the consolidated requirements; never silently drop an unfinished requirement. Archive superseded engineering instructions and leave references rather than multiple active rulebooks. Keep `AGENTS.md` short. Preserve historical evidence but label the SHA/runtime to which it applies.

This instruction supersedes the interpretation that deterministic safety requires scripted language, a card for every answer or a handwritten grammar for every utterance. It does NOT supersede patient/audience isolation, faithful review, source integrity, reliable delivery, professional boundaries or the remaining administration, collaboration, analytics and operational scope.

### The specific source-audit baseline

Preserve these real advances at `2b1233d`:

- Runtime Markdown is loaded from directory-v2 packs, with role/station bindings and approved workflow skill selection.
- The bounded model can select authorized read and draft-preparation tools without an extra model intent-classification request.
- The integrated profile uses PostgreSQL, Medplum and an independent stateful provider simulator; it must not fall back silently to memory.
- Reviewed assistant commands have a local atomic acceptance path with jobs, audit and receipts. Delivery workers retain acknowledgments and require read-back.
- Pending proposals, browser-tab scope and original-ASR versus reviewed-transcript provenance have improved.
- Migration-history verification now precedes pending changes. Preserve this correction.

Reproduce and fix these remaining source-level findings, not assumed production incidents:

1. `src/core/assistant-service.ts` still maps the LAST selected tool through `routeByTool` into an old intent and then a fixed response tree. This can discard the presentation relevance of earlier tool results.
2. `generatedCoworkerTextIsSafe` grounds prose against the JSON of selected UI components, including German word/count patterns. Evidence validity must not depend on whether a matching card was rendered.
3. `prepare_care_update` delegates to a second extraction call and the old verifier. Adding an agent wrapper around that path has not removed its linguistic limits.
4. `src/ai/assistant-proposal.ts` still requires particular German messages, verbatim current-source note text and physician-only generic communication in parts of model validation. Its correction function has special cases for ml changes, named messages and particular completion phrases.
5. `toOpenUi` serializes a server-selected component list. Serialization is not inherently wrong; the missing capability is model-selected presentation independent of the old intent switch.
6. Input is still restricted to 1,200 characters in important paths. Bounded inputs are necessary, but arbitrary truncation or loss of a late negation/correction is not.
7. Some tools slice results while reporting them complete. Correct pagination, scope, total-count and freshness semantics before the agent summarizes them as exhaustive.
8. The assistant acceptance path is improved, but direct mutation paths, inbound synchronization, resource-native reconstruction, shared ACL threads, governance, identity/RLS and analytics remain incomplete.
9. The project's real model/ASR attempts returned HTTP 429; TTS returned 503. These are unpassed model/audio gates. The reported 407 passing tests are not evidence of real-model competence.

The task author read source and tests but did not execute the running app or reproduce the local results. GitHub Actions returned no runs for the audited head. Establish fresh evidence yourself.

Current resolution note (2026-09-14): findings 1 and 3 were closed before this
increment. Finding 2 is closed in the active display path without replacing it
with another lexical entailment checker: the model selects exact run-local
claims and optional bounded presentation, while deterministic code renders all
displayed clinical fact atoms. Model-authored source-free clinical prose is
never displayed. Measurement concept/value/unit/occurrence time/review status
and task title/state render as indivisible same-row atoms. Evidence remains
independent of cards and is archived with exact claims, server-only source
metadata, a complete-result digest and a final archive digest. The model sees
only opaque run-local handles plus bounded facts/freshness. Formal
held-out/model-swap evaluation remains part of G4; all
other numbered findings and G0–G7 partial gates remain binding.

## 2. Lock the product and terminology

Pflegehelfer is a provider-agnostic staff coworker for documentation, retrieval, coordination, communication and organizational work. Normal staff use Pflegehelfer. Medplum remains infrastructure and a separately authorized expert inspection surface.

The initial product does not originate diagnoses, prognoses, treatment choices, medication prescriptions/dose changes, autonomous clinical triage, alarm replacement, personnel decisions or fabricated billing. Existing human-authored diagnoses, prescribed plans and reports of already-performed professional actions may be retrieved or documented faithfully. Do not suppress legitimate history just because a medication word occurs.

“Faithful” means preservation of the reviewed meaning and attribution. A valid schema, plausible value, exact quotation, hash or human signature cannot independently prove that reported care occurred. Never promise zero hallucinations or automatic legal compliance.

“No premade cards” means **no compulsory pre-scripted response trees or per-intent screen selection**. Reusable coded React/OpenUI components are necessary. Retain stable identity, source, review and status controls. The model chooses useful composition; it does not generate unrestricted executable frontend code.

“MD-configured” means low-code configuration for existing capabilities and institutional guidance. Markdown is not the live patient database, an authentication system, an implementation of a private vendor API or executable permission authority.

The human-centered goal is less remembering, searching, retyping, interruption-recovery effort and correction work. The Weinberg photographs do not establish a specific no-code architecture. Measure human benefit and maintenance effort rather than line count or the number of generated cards.

## 3. Keep one small architecture; remove the actual duplication

Retain the existing React/TypeScript/OpenUI shell, modular Fastify backend, operational PostgreSQL, Medplum and provider/model/audio adapters. Prefer maintained SDK features and libraries. Do not add a new orchestration platform, broker, vector database, microservice estate or agent swarm without measured need.

```text
Employee message / speech / deliberate UI action
        ↓
Authorized session + relevant published Markdown + current evidence
        ↓
One bounded agent ↔ permitted read and draft-preparation tools
        ↓
Natural text + optional model-composed GenUI + source links
        ↓
Exact human review / Send / permitted explicit action
        ↓
Atomic local command acceptance
        ↓
Recoverable Medplum and designated provider delivery
        ↓
Audience-scoped receipts, current records and work continuity
```

Use one logical agent configuration instantiated with isolated request/session context, not one globally shared memory and not one dedicated model per employee. Keep separate role/person/audience records without duplicating engines.

Ownership is explicit:

| Information                                             | Owner                                                                                                     |
| ------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| Existing clinical master record                         | The provider designated by the institution for that domain and operation.                                 |
| Normalized clinical representation                      | Medplum, with source identity/version/time and provenance.                                                |
| Workday, responsibilities, conversations and drafts     | Operational PostgreSQL, with clinical references instead of an unnecessary second EHR.                    |
| Accepted commands, audit metadata and delivery receipts | Operational PostgreSQL and appropriate clinical provenance projections.                                   |
| Staff identity and memberships                          | Approved identity/directory sources plus governed application mappings.                                   |
| HR cases                                                | Specifically restricted personnel records, not a public staff profile or general FHIR patient collection. |
| Institution procedures                                  | Approved immutable Markdown packs and validated execution metadata.                                       |
| Model/session summaries                                 | Derived context only; never authority over clinical truth or permissions.                                 |

Import provider-originated data automatically through validated synchronization when permitted; do not require a nurse to reapprove every replicated source update. Staff-originated final writes require the appropriate human action. Side-effect-free discussion and operational draft autosave are not final clinical writes.

## 4. Finish the agent-led conversation path

Use the existing bounded runtime or a demonstrably simpler maintained replacement behind the same tool boundary. Do not introduce a parallel framework. The configured natural-language path must no longer require a `classify → old intent → fixed screen` conversion.

The runtime must:

1. Resolve the authenticated principal, purpose, subject/audience, tab/session, patient/encounter when applicable and current approved instruction version.
2. Load relevant guidance, recent permitted dialogue, pending proposal and source references—not every role file and every patient.
3. Give the model the useful allowed tool subset and clearly describe tool effects and limitations.
4. Validate tool name, arguments and current access before execution. Return the model a run-local opaque handle plus bounded real data, occurrence/recorded/retrieved times, completeness and errors. Retain source identifiers, versions, hashes and row provenance only in the server evidence registry.
5. Let the model decide whether it needs another read, clarification, a natural answer, optional visualization or a draft/revision.
6. End the run when awaiting a person. Persist resumable work and release compute; do not poll a model while waiting for approval.

An ordinary question can produce plain assistant text with source links and no cards. A non-factual acknowledgment does not require a fabricated citation. A factual answer involving several tools must be able to cite all relevant results without rendering one card per tool.

Remove the last-tool-wins conversion. Preserve a run-scoped evidence/result registry independent of rendering. A result must not lose authority or accessibility merely because the user requested a short text answer rather than a chart.

Tools should be small in number and useful in scope: read current work, handover, patient context, observation series, relevant history, permitted colleague work, authorized team discussion, approved reference; resolve a permitted person; prepare or revise a scoped work/message/configuration draft. Reuse domain services rather than make a new service for every tool name.

A draft tool should accept a schema-validated model proposal and permitted evidence references, then return a durable draft reference/revision and reviewable meaning. Do not ordinarily call a second model that repeats the same interpretation with the old parser. Additional model calls must solve a measured problem, not exist because the old implementation already nested them.

Model-supplied IDs are untrusted selectors, not authority. Resolve them against the current scope. Server assigns identity, timestamps, hashes, record ownership, destinations and approval tokens. The model cannot access the final-approval endpoint, arbitrary FHIR mutations, SQL, shell, filesystem, remote skill scripts or arbitrary network URLs.

Use bounded time, turns, result sizes, fan-out, retry and cost. Distinguish a tool failure from absence of data. Never label a truncated top-20 result as all open work. Counts come from the same authorized query and declared scope. Revalidate live facts when necessary; `retrievedAt` is not the measurement time or provider last-update time.

Keep explicit safe direct queries/buttons as efficient alternatives. Without a working model, expose records, deliberate controls and verbatim draft capture with an honest unavailable label. Do not represent regex fallback success as natural-language model understanding.

## 5. Faithfulness without a custom grammar for every sentence

Separate five records: employee input; provider/history evidence; model-proposed interpretation; human-reviewed revision; accepted content and delivery. For speech, keep original ASR text and corrected transcript lineage under the retention policy; no raw audio retention by default.

Preserve subject, attribution, occurrence time, negation, uncertainty, approximation, laterality, quantities/units, performed versus planned status and requested versus mentioned actions. Context from a care plan cannot silently become evidence that the employee performed it today.

Offer verbatim capture and optional visible professional reformulation. Example:

```text
Employee: Anna mobilisiert, danach kurz schwindlig.
Faithful optional draft: Anna mobilisiert. Anschliessend kurzzeitig Schwindel.
Unsupported unless supplied: 30 Meter, Rollator, Blutdruck stabil,
nach Pause beschwerdefrei, Arzt informiert.
```

Replace exact stock-message equality and general-purpose German lexical gating in the normal model path. Retain deterministic reference ownership, schema, value/unit representation, supported effect classes, version and authorization checks. Keep targeted known-contradiction checks where useful, but do not claim substring matching proves entailment.

Evidence must refer to actual allowed input or source records. A correction can cite earlier scoped input plus the correction and an inline edit; do not rebind every reference to only the latest sentence. The model must not mint provenance or label text it fabricated as an original quote.

Do not build another exhaustive claim ontology to compensate for removing a parser. Use the existing typed fields, source/effect references, meaningful review, targeted checks and held-out evaluation. Unsupported or contradictory clinical claims should be corrected, omitted or surfaced as uncertainty, not accepted simply because citations exist. An optional model evaluator can aid testing but is not an infallible production safety oracle.

Ground factual prose against authorized evidence, NOT the JSON of UI components. Numbers must retain their semantic association: a pulse value cannot justify a temperature claim merely because the number occurs somewhere. Preserve safe natural wording and paraphrase; do not translate every German article into a numeric test.

Long reports must not silently lose the last negation or correction. Set documented transport/model budgets with visible oversized-input handling or explicit chunking; test input beyond the old 1,200-character boundary. Do not split a sentence into independently executable fragments.

After approval the model does not rewrite the final record. Mapping to FHIR/vendor representation is deterministic and versioned; unsupported/lossy mappings need visible reconciliation. Later substantive corrections create attributable amendments or new versions under review policy.

Maintain product boundaries at every endpoint. A generic note/task cannot originate a treatment order. Equally, do not block an authorized report of an existing order or completed intervention solely because it contains medication terminology. A reported unusual measurement stays visible with verification state; it must not be hidden behind an older normal value or delay established emergency contact while awaiting software review.

## 6. Real adaptive GenUI, not one card per tool

Reuse the installed OpenUI renderer and useful accessible components. Verify the exact package APIs before changing them. Generate the model's presentation specification from the actual registered catalog; do not hand-maintain another component grammar.

Implement optional model-authored presentation from allowed primitives: text sections, lists, tables, charts, accordions, choices and small forms, plus bounded domain controls where needed. Data-bearing clinical components hydrate from authorized result references. Draft review hydrates from the server-owned current proposal. No model-supplied JS/MDX, HTML execution, backend route, token or webhook.

The model can choose:

- text only for a short question;
- a compact table for comparing several records;
- a time-series chart for a requested trend;
- a few fields for genuinely missing information;
- an expandable patient summary;
- a compact editable review for proposed changes.

The renderer/serializer can remain deterministic. The selection/composition for the natural assistant response must not be determined by a giant intent switch. Fixed direct-view buttons and the final approval control are appropriate; they are not a competing conversational product.

Natural explanation, evidence references, UI composition and executable authority are separate concerns. A displayed read control may request another authorized read. A generated draft form edits a scoped proposal. Final commit is an authenticated human action validated independently by the backend.

Support actual model/transport streaming where useful, with bounded partial parsing and no executable action until its server state is valid. Do not simulate streaming by delaying a completed response. A fast deterministic query can render immediately. Use existing supported protocol conventions rather than inventing multiple stream formats. Preserve cancellation, accessibility, reconnect and incomplete-output behavior.

Do not force a separate “UI model” call merely to reorder static cards. Prefer composition as part of the main answer or a justified bounded step. Test two different presentations of the same source data and a text-only answer without adding a scenario-specific TypeScript route.

## 7. One durable proposal lifecycle and one review

Reuse the current proposal storage and immutable revision/source records. Add a general `revise` capability that accepts the current draft and scoped correction through the agent rather than a fixed ml/Nora phrase table. Never convert a question about a draft into an edit accidentally.

The existing Luca test remains a regression, not the entire product specification. Also test different names, recipients, measurements, units, times, removed actions and reordered requests. Preserve approximation and explicitly deferred tasks.

```text
Luca mobilisiert, etwa 200 ml getrunken. Gewicht später.
Korrektur: eher 150 ml. Nora informieren, nicht den Arzt.
Nur Dokumentation und Nachricht, noch nichts abschliessen.
```

The same proposal is revised; no physician message or task completion is invented. Generalize this through the same runtime used for unfamiliar corrections, not a separate demonstration shortcut.

The human sees the final wording/effects, recipient, time and relevant source changes. One approval is enough where policy permits. A deliberate Send or direct authorized action can itself be that approval. Do not add mandatory duplicate dialogs to every low-risk interaction. Keep justified countersignature policies separate.

A context switch suspends, not retargets, pending work. Restore the same subject/encounter/thread revision with fresh authority after revalidation. Tabs remain independently scoped. Reissued tokens cannot execute the same proposal twice. Preserve useful drafts after restart. Do not store reusable live authority in historical messages.

## 8. Finish the existing durable execution—not another pipeline

Preserve the new local assistant-command acceptance and workers. Migrate remaining supported direct detail/workday actions to the SAME acceptance service. Do not re-enable an integrated endpoint by bypassing the gate, and do not call a blocked normal staff action complete.

One PostgreSQL transaction accepts the exact reviewed revision and selected effects, consumes authority, stores an idempotency receipt and relevant operational mutation, records audit/evidence and enqueues remote jobs. No model, human or external HTTP request runs inside that transaction.

Treat external effects as recoverable delivery, not a global database transaction. A lost request response must return the original receipt for the same intent and canonical payload. A changed payload using that key fails. Concurrent approval is once-effective; preserve request keys across client retries.

Keep per-item locally accepted, Medplum stored, provider acknowledged, pending verification, rejected and conflict states. Do not call an HTTP acknowledgment a successful clinical/business update without the operation's required evidence. For vendors that cannot provide immediate read-back, use their verified operation-specific acknowledgment semantics and explicit unverified/manual states rather than inventing an API.

The current worker ordering prevents old checkpoints overtaking new ones. Preserve that protection during migration, then remove normal whole-state checkpoint reconstruction and global unrelated-job blocking. Use resource-scoped repositories, conditional versions and per-aggregate ordering where required. Do not mechanically delete a checkpoint before restoration parity and previous-release migration tests pass. Legitimate FHIR Binary documents/images are not prohibited.

Prove crash points before/after local commit, remote send, acknowledgment and receipt persistence. Reauthorize delivery under the institution's policy without deleting previously accepted evidence. A changed entitlement may pause delivery for review; it must not quietly erase an approved report.

## 9. Complete provider ingestion and current context

The reusable adapter boundary remains correct. Finish both initial import and incremental authenticated inbound processing through durable inbox/cursor/mapping/provenance records. Match patient and encounter; quarantine ambiguity instead of choosing the first patient or using room as identity.

Preserve per-operation capability gating, source authority per provider INSTANCE/domain, mapping versions and freshness expectations. One unverified write must not disable verified reads. A new instance of an implemented adapter is configuration; a new unsupported protocol requires code and conformance tests. Markdown does not implement private WiCare/careCoach/SAP APIs.

Keep the independent stateful fake provider with authentication, persistent records, expected versions, delays, rejection, correction and restart. From clean stores prove:

```text
provider initial data → inbound mapping → Medplum → staff context
→ approved staff update → delivery → provider read-back
→ independent provider edit → inbound → refreshed authorized workspace
```

Prevent feedback loops from own writes returning through inbound; preserve tombstones/corrections and classify conflicts. Avoid silent last-write-wins. Manual resolution must identify the conflicting versions and review the resolution without bypassing source ownership.

Medplum remains the normalized clinical workspace, not automatically the legal master of every field. PostgreSQL stores operational context, not another independently editable copy of the entire patient chart. Label pending local approved work alongside external source state so staff can see why they differ.

Real vendor documentation, sandboxes and acceptance remain external. Generic adapter code, workers, conflict UX and their tests are internal tasks. Never use screen scraping or direct vendor database mutation as a covert workaround.

## 10. Finish the existing MD architecture without relocating it again

Keep and extend these CURRENT paths:

```text
config/assistant/BASE.md
config/shared/guidance-catalog.json
config/shared/roles/*.md
config/shared/workflows/<skill>/SKILL.md
config/sites/packs/<institution>/site.json
config/sites/packs/<institution>/SITE.md
config/sites/packs/<institution>/departments/*.md
config/sites/packs/<institution>/stations/*.md
config/sites/packs/<institution>/providers/<provider>/PROVIDER.md
config/sites/packs/<institution>/workflows/<skill>/SKILL.md
```

The current manifest references validated machine configuration at `config/sites/<institution>.json`. Retain that as a single referenced source or migrate it deliberately into the pack with a compatibility import. Do not leave two hand-maintained copies or rename directories merely to match an older prompt.

Add reusable `workflow.json` or equivalent supported metadata only where executable obligations require it. Markdown contains interaction guidance and procedures; metadata contains implemented step types, prerequisites, role references, timing and transition rules. Security capability ceilings are separately reviewed. No arbitrary expression language or executable Markdown.

Finish organization → site → department → station → role/qualification/assignment → workflow binding. Support multiple departments/stations, real directory membership changes and different shift patterns. Active role is explicit for multiple-purpose staff; do not union every privilege into a superuser. Institution-specific restrictions can narrow supported capabilities. Creating a role label cannot grant an unimplemented or unreviewed power.

Load relevant guidance progressively. Prompt/document/provider contents cannot elevate themselves to system instructions. Preserve secure reference loading, file/UTF-8/size checks and no remote includes/scripts. Hashes identify content integrity; an editable `approvedBy` string or recalculated hash alone is not approval identity or signature.

Finish a simple editor/CLI and administrative preview:

```text
edit MD/metadata or describe desired change
→ draft diff → validation → runtime preview → scenario tests
→ authorized human approval → immutable publication → activation
→ new sessions use the new version → compare or roll back
```

Generate manifest hashes mechanically as part of the reviewed publication process. Do not make an administrator manually edit many dependent hashes, and do not automatically bless an unauthorized edit. Running sessions pin their procedure version; current access revocations still apply immediately.

Actual staff lists, patient assignments, qualifications, absence reasons and credentials belong in governed operational/directory data, not individual Markdown files. Synthetic fixtures may remain separately versioned. Provide working `site validate/inspect/preview/publish/activate` CLI/admin flows using the existing configuration mechanism, not decorative commands.

## 11. Complete useful role guidance and workflows

Keep the 25 shared synthetic role guides and existing workflow catalog. Expand their substance and supported tools instead of copying one generic support-day under every name. Research the current official role sources and obtain local review before production; these are demonstration defaults, not a universal Swiss legal permission matrix.

| Profiles                                                  | Required useful scenario                                                                                                                                           |
| --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Pflegeassistenz/SRK, AGS EBA, FaGe EFZ                    | Distinct approved competencies; assigned care/work report, partial work, appropriate escalation and transfer.                                                      |
| Pflege HF, Pflege FH                                      | Source-linked handover, coordination, human-authored professional findings, reviews and follow-up ownership. Do not invent an automatic HF/FH authority hierarchy. |
| Pflege-Teamleitung/Schichtleitung                         | Coverage, assignment, unresolved responsibilities and reviewed delegation, without private-transcript access.                                                      |
| Ärztlicher Dienst                                         | Questions, rounds preparation, human response and attributed follow-up; formal prescribing stays outside the generic assistant.                                    |
| Apotheker/in; Pharma-Assistenz                            | Separate medication review/reconciliation versus supply/logistics work with appropriate responsibilities.                                                          |
| Physio, Ergo, Logopädie, Ernährungsberatung               | Relevant appointment/goals, session documentation and cross-team requests using existing approved plans.                                                           |
| Transport, Service/Hotellerie, Reinigung                  | Actual work queues, completion/exception and necessary precautions without broad clinical access.                                                                  |
| Eintritt/Austritt/Administration; Abrechnung/Versicherung | Imported gaps, documents, evidence completeness, approved export and rejection follow-up.                                                                          |
| Heimleitung, Geschäftsleitung/CEO, Finanzen/CFO           | Permitted operating brief, exception ownership, baseline/quality/cost review and human-approved changes.                                                           |
| HR, Berufsbildung                                         | Onboarding/offboarding, qualification/training expiry, supervised learning and restricted personnel cases; no patient data by default.                             |
| Qualität/Patientensicherheit; IT/Integration              | Authorized review/incident work versus technical queue/health/recovery operations, with distinct authority.                                                        |

Role procedures remain configurable, but unsupported tasks must be visible as unsupported. A role file is not evidence its end-to-end application workflow exists. Do not build payroll, a full HR suite, tariff engine, PBX or replacement PDMS merely to make every role useful.

## 12. General, patient, staff and shared workspaces

Use one shell, composer, subject context service, tool registry and command pipeline. Support private general assistance, private patient/encounter assistance, permitted staff-context assistance, shared patient-team/department discussion, DMs and restricted personnel cases as explicit scopes—not duplicate products.

Patient profiles feel like familiar contacts, but the assistant speaks ABOUT the patient. Show photo/initials, identifiers, encounter and a compact private/shared audience label. Profile lenses expose approved personal preferences, documented diagnoses, allergies with known/unknown/negative distinctions, care goals, actual values, read-only medication context, timeline, work and authorized files. No invented patient personality or presence.

Staff profiles separate:

1. Ask Pflegehelfer about the requester's permitted work context concerning a colleague.
2. View shared assignments and responsibilities.
3. Contact the real colleague or duty role through deliberate Send/Call.

Opening Nora never executes as Nora or reveals her private assistant transcript/drafts to Heimleitung or HR. Supervision can show necessary published operational work under policy, not unrelated clinical/personnel information. Patient identities cannot leak indirectly through staff-task counts, search or analytics.

System connectivity, source freshness, duty status and optional availability are distinct. Do not show a patient as online. Do not infer performance from a colleague's connection state or reveal an absence reason. Calls use a user-initiated approved integration; no automatic dialing or recording.

Scoped drafts, pending reviews, scroll and interrupted care survive navigation. A slow answer goes to its origin thread. Incoming events never hijack the active patient. Test two browser documents, logout, permission revocation and stale responses.

## 13. Complete the working day and handover

Start nursing with a real authorized handover, not a marketing card or hard-coded “step 1 of 10.” Use a compact roster with patient expansion and four sections: Kurzprofil/Achtung; Seit der letzten Schicht; Offen/ungeklärt; Nächste Schicht. Show only source-backed existing diagnoses/precautions and actual responsibilities. Missing reports are not evidence of no symptoms or criticism of the previous shift.

Freeze content, source read-set, ownership and cutoff. Acknowledgment refers to the exact content version. Add later information as an append-only addendum. Allow questions and partial review. Listening is not acknowledgment, comprehension or performed care. Urgent work and primary communication cannot be blocked until all routine handover rows are read.

TTS reads the visible chosen content version, with stop/pause/repeat/speed and return after a question. It must not freely embellish the handover or capture its own speech as a user's approval.

After handover show the actual work plan: patient, time/window, activity, reason/source, responsible person/role, dependencies/assistance and status. Explain operational ordering from existing appointments and approved constraints; do not originate clinical urgency from vital signs or diagnoses.

Work is interruptible and repetitive, not a fixed one-pass checklist. Support start, pause, resume, waiting, partial completion, not performed with reason, deferral, cancellation and transfer. Stopping a timer or opening another profile does not establish performed work. Work remains possible after the morning list is complete.

At close reuse accepted records, identify unapproved drafts, pending provider delivery, questions and outstanding responsibility. Do not require false completion to finish a shift. The receiving person/team acknowledges the exact transfer. Include two consecutive shifts, overnight/DST boundaries, no assigned patients and multi-person assistance in acceptance tests.

## 14. Real #/@, notification and library behavior

Finish durable ACL-enforced shared threads, authored comments/replies, report-linked addenda, explicit publication preview, duty-role ownership and reassignment. A deliberate Send is meaningful approval; do not duplicate it without a justified reason. Read, responsibility accepted and resolved are distinct.

`@person` and `@duty-role` resolve through the authorized directory. Clarify ambiguous matches; do not select the first person. A mention never grants access or publishes prior private content automatically.

`#topics` are approved categorization suggestions and real searchable metadata. Keep topics separate from clinical statements and active safety Flags. Negated/historical/uncertain language must not create a confirmed positive diagnosis, risk, alarm, task or billed service. Corrections remove stale categorization. Useful filters include unresolved work by topic and separately confirmed source warnings; do not conflate them.

Notifications and unread counters use durable audience-filtered events with replay, revocation checks and bounded payloads. Outside-the-app push requires an approved delivery mechanism; do not promise reliable air-gapped background PWA alarms. Primary nurse-call/urgent contact stays independent.

Implement one authorized library for documents/images with patient/team/topic/date/type filters, safe previews, source/version and approval state. Do not leave a Bibliothek button that only submits an unimplemented question. Validate and scan uploads where applicable, quarantine unsafe files, authorize thumbnails and bytes, handle metadata/expiry and retain originals appropriately. No public patient images, hidden EXIF leaks, arbitrary SVG scripts or patient photos scraped/generated as real identity evidence.

Approved policies and intranet/news are different knowledge classes with owner, audience, source, approval/effective/review/expiry and withdrawal. Optional Loop/Staffbase and public information use only authorized read connectors; no patient data in web queries. Air-gap uses controlled imports/DMZ, not hidden external calls. Add semantic retrieval only where measurements justify it.

## 15. Context, analytics, evidence and governed improvement

Use existing PostgreSQL state for conversation, pending work and necessary context. Model-generated summaries are derived and permission-bound; retrieve current clinical/provider facts rather than treating old chat as the chart. Retention/export/deletion are separate for private conversation, accepted clinical records, audit, media and aggregates. Deleting chat must not delete already approved clinical records.

Create one accepted work event linking performer, acting role, patient/encounter, activity, occurrence/recorded/approved times, quantity where supported, deliberate time segments, order/task and proposal/source references. Reuse that event for documentation/task evidence/reporting; do not generate multiple services from tags, messages, multiple staff or repeated approval clicks.

Timer duration is not performed care; performed care is not automatically billable; a billable item is not automatically an invoice. Provide completeness/duplicate/order-review and approved-export states. Real tariff rules are setting-specific, versioned and reviewed. Do not fabricate revenue, upcode or autonomously submit charges.

Build initial analytics with a small documented event vocabulary and PostgreSQL views: documentation delay, duplicate/repeated effort where measurable, correction steps, unresolved handover/questions, task age, provider failures, model/audio latency/cost and staff-reported usefulness. Define denominators, windows, missing data and deduplication. Separate time saved, useful capacity and realized financial saving. Synthetic data demonstrates the method, not actual ROI or causality.

Kader/Heimleitung/CEO receive permitted aggregates; team leads see the individual work necessary for their approved responsibilities. Do not mine private transcripts, infer emotion/personality/competence or rank employees from activity/presence. Use reviewed feedback and process evidence for team/culture improvements.

Implement the improvement cycle using the SAME configuration publishing path:

```text
permitted evidence → proposed change + rationale
→ MD/metadata diff → regression/simulation → human approval
→ limited new-version pilot → compare → retain/rollback
```

The agent may propose wording, routing, context or workflow simplification. It cannot grant rights, alter clinical truth, deploy itself or manipulate metrics. No new multi-agent improvement platform is needed.

## 16. Real identity, data protection and operation

Complete generic production OIDC/BFF with maintained libraries and an isolated test IdP. Actual institution endpoints/certificates/approval remain deployment inputs; generic implementation is internal. Validate tokens/claims, session lifecycle, CSRF, state/nonce and appropriate PKCE. Use secure server cookies. Production never accepts demo identity headers or user-supplied role authority.

Enforce current principal, tenant/site/department, functional role, qualification/delegation, assignment/treatment or supervisory relationship, purpose and audience across tools, direct APIs, search, media, event replay and jobs. Reuse appropriate Medplum AccessPolicy/project boundaries; tags and ID prefixes are not access controls.

Test RLS/composite scope constraints with actual limited application credentials, not a superuser. Two tenants, two API replicas and two workers must not share a mutable patient/site singleton. Preserve accepted evidence on revocation and use explicit review for affected queued delivery.

Finish retention sweepers, legal holds, restricted exports, access auditing, secrets management, immutable artifact/SBOM update support, network/TLS expectations and PHI-free observability. No notes, names, transcripts or patient labels in generic metrics/logs. Detailed evaluation fixtures must remain synthetic.

Restore real PostgreSQL, Medplum, media and required configuration into a clean isolated environment. Reconcile already-delivered jobs against the fake provider; do not resend blindly. Test previous-release migrations and recovery, not only empty schemas or JSON checksum equality. Report measured recovery assumptions instead of guarantees.

The intended-use documentation must match actual functions and public claims. HITL, local hosting and the word coworker do not establish a medical-device exemption or privacy compliance. Require Swiss institutional/cantonal/privacy/clinical review as applicable, and assess EU obligations where applicable rather than assuming every EU rule automatically applies. Do not expand into diagnostic or employee decision functions to make the demonstration impressive.

## 17. Real AI and voice acceptance, not more fallback passes

Choose an actually available, capable model from current official documentation and account/runtime support. Do not hard-code a historical marketing name as a production guarantee. Preserve the provider adapter seam and local-first deployment; a stronger model should improve understanding without changing tool authority.

The previous hosted requests failed with 429 and the project reports exhausted credit. Treat that as an explicit operator/account prerequisite; do not keep retrying indefinitely or switch to an unapproved third party. Diagnose and report TTS 503 separately. Support safe local alternatives if actually installed and authorized. Missing access leaves that test unpassed but does not stop unrelated engineering.

Use one capable model first for the acceptance journey. Optional fast/deep routing follows measured need. Verify selected runtime tool calling, streaming, schema/nullability, output budget, refusal/incomplete/error handling. Do not require a needless separate classifier/extractor/UI model for every message.

Protect funded public demos with authentication, request/upload/rate and spend limits before enabling external inference. Secrets stay server-side. `store:false` is not a universal no-retention guarantee. Local production has no undisclosed hosted ASR/LLM/TTS fallback.

Actual voice acceptance is microphone/file bytes → ASR → editable transcript → same conversational agent → reviewed draft → delivery. Preserve original ASR and correction provenance, not invented calibrated confidence. Test names, negations, numbers, times and the institution's languages. TTS loopback is not human Swiss-German accuracy validation. Browser speech is labelled an unvalidated synthetic fallback.

Distinguish unconfigured, reachable, smoke-tested, scenario-accepted and institution-approved. Pin acceptance evidence to model/runtime/prompt/schema/pack versions. Actual endpoint attempts that failed are not successful model tests. A fixture endpoint is useful protocol evidence only.

## 18. Polish the actual UI without another redesign

Preserve the current chat/private-patient structure, branding and useful components. Aim for ChatGPT/OpenUI-like clarity with an original Pflegehelfer design: one composer, restrained sidebar, compact headers, natural messages, useful inline generated UI and progressive disclosure. Do not clone trademarks or optimize for decorative cards.

Sidebar functions must genuinely work: My assistant, planned work, team/mentions, library, patients, staff/duty contacts, history and authorized administration. A click on My assistant actually switches to the general thread. Tabs are read lenses or explicit audience changes over the same records, not another app or duplicate engine.

Keep a white/near-black base, pharmaceutical blue actions and restrained red for meaningful brand/urgent/error use. One semantic theme supports light/dark/system. Glass can distinguish the drawer/composer/toolbar; clinical numbers, medication context, tables and approvals need calm legible surfaces. Support reduced transparency/motion and high contrast.

Use one consistent SVG icon set and the existing original blue Edelweiss/negative-space plus. Refine small-size rendering and canonical assets; do not create a red-cross imitation or claim legal clearance from a color change. Keep `Tertianum Kronenhof · Demo` and non-affiliation/fictional-data disclosure.

Fix actual usability defects: clipped composer, keyboard occlusion, oversized handover, repeated status cards, raw user/encounter IDs, false presence, stale times, dead menu buttons and inaccessible review. Clinical time-series charts use actual timestamps/units, not equal spacing disguised as elapsed time. Source read time does not erase stale data.

Use a controlled labelled demo clock with coherent 1–2-week synthetic histories. Retain approximately fifteen profiles, six assigned by default plus zero/two/twelve cases; readmission must have a new encounter. Use licensed or plainly fictional media. Do not reproduce proprietary assessment content without permission. Add distinct enabled-role staff fixtures and realistic questions without claiming local Tertianum endorsement.

Visually inspect the running INTEGRATED profile at 360/390 px, tablet portrait/landscape and desktop; light/dark/system, 200% zoom, keyboard, reduced transparency/motion and mobile virtual keyboard. Record screenshots and actual interaction, not only selector passes/no-overflow. Readability and effort matter more than cosmetic animation. Measure p50/p95 end-to-end latency under concurrent synthetic use and cost per successfully reviewed work event.

## 19. Preserved inherited acceptance identifiers

The following acceptance identifiers remain binding. The C1–C16 probes in the
next section refine and combine them; they do not replace or silently close
them. Evidence is indexed by both families in `COMPLETION_MATRIX.md` and the
acceptance-recovery record.

### Runtime instructions and configuration

- MD-01: approved institution/role/workflow Markdown reaches the model request
  with the correct hash/version; unrelated role instructions do not.
- MD-02: a prose-only change affects guidance, not permissions or mandatory
  workflow completion.
- MD-03: a structural workflow change has a visible metadata diff, tests and
  human publication; an existing session remains pinned.
- MD-04: a new approved role/profile, second institution and multiple
  departments require configuration only; forbidden capabilities fail closed.
- MD-05: traversal, symlink, unapproved file, revoked pack, injected override
  text and remote include cannot expose data or tools.
- MD-06: staff and assignments come from governed operational/directory data,
  not patient files or hard-coded business logic.
- MD-07: institution, department and station guidance resolves for
  cross-coverage and multiple roles without mixing publication revisions.
- MD-08: a new role name bound to existing reviewed capabilities and a new
  instance of an implemented adapter need no business-source edit; unknown
  operations require implementation.
- MD-09: every documented reads/uses/proposes/reviews/records arrow resolves to
  an actual tool, reference or owner; live patient Markdown does not exist.

### Runtime agent and tool contracts

- AG-01: the approved skill body reaches the model on demand; its reviewed
  hash/version remains server-side and unrelated roles and procedures do not.
- AG-02: the model requests a read tool, observes its real response and can
  select a different next read or terminal outcome without an intent/card path.
- AG-03: read-only questions produce no final mutation; drafts produce no
  provider/clinical write; invented privileged tools are rejected.
- AG-04: model-supplied actor, tenant, purpose and references cannot override
  server scope or cross patient/encounter/staff/audience boundaries.
- AG-05: provider, procedure, profile and attachment injection cannot obtain
  more tools, disclose data or override executable policy.
- AG-06: tool budgets, repeat detection, timeout, refusal, cancellation and
  no-progress recovery terminate safely without blocking another employee.
- AG-07: two model backends use the same tools/proposals/services; real runs are
  reported separately from fixtures.
- AG-08: direct roster, context, timestamp and approval controls need no model
  round trip or artificial delay.
- AG-09: backend-issued IDs, versions, hashes and recipients survive revision;
  the model never fabricates authority.
- AG-10: a restored pending revision can be corrected and approved once without
  repeating the full report.

### Conversation, people and privacy

- CT-01: general → Anna → Luca → Nora → general restores the right private
  drafts and work continuity.
- CT-02: a new encounter never inherits the previous encounter's draft.
- CT-03: slow model/audio results and two tabs remain bound to their origin;
  stale authority fails safely.
- CT-04: a lead can ask about permitted colleague work but cannot retrieve that
  colleague's private assistant history.
- CT-05: management without patient access cannot infer diagnoses through
  staff-task, profile, search or analytics paths.
- CT-06: opening a staff assistant never sends a message; a direct message
  requires deliberate send and the correct authored audience.
- CT-07: off-duty and stale connectivity cannot become absence, health or
  performance claims; absence reasons remain hidden.
- CT-08: personnel cases, patient/team/department threads, private assistants
  and unrelated DMs cannot cross-read via search, mentions, counts, media or
  events.
- CT-09: role/membership revocation invalidates retrieval, pending authority
  and notification delivery without erasing accepted records.

### Meaning, handover and workflow

- WF-01: “Nur Morgenpflege erledigt; Mobilisation später” preserves the open
  activity.
- WF-02: “Arzt nicht informieren, keine weitere Kontrolle” creates neither a
  message nor a task.
- WF-03: “Gestern 200 ml, heute ungefähr 150 ml” preserves time and
  approximation; a correction revises rather than duplicates.
- WF-04: “Nora statt Arzt; nur Nachricht, nichts abschliessen” edits the same
  reviewed proposal.
- WF-05: treatment instructions cannot enter generic note/task APIs, while an
  authorized past-event report is not silently removed.
- WF-06: an extreme pending value remains visible but is neither confirmed
  evidence nor a reason to delay established emergency communication.
- WF-07: handover and post-cutoff addendum are exact; TTS matches the selected
  version and listening never acknowledges it.
- WF-08: zero/two/twelve assignments, overnight/DST shifts, no receiving owner
  and two-person work produce truthful outcomes.
- WF-09: interruption/resume, partial care, role transfer and a second shift do
  not duplicate responsibility or service evidence.
- WF-10: negated/historical topics do not create an active clinical Flag; a
  role queue stays unassigned until claimed.

### Execution and recovery

- TX-01: double approval and lost response return one receipt for the same
  payload; a changed payload using the key fails.
- TX-02: crash points before/after local commit and remote send lose no accepted
  work and cause no blind duplicate effect.
- TX-03: a migration-history mismatch fails before any pending schema/data
  mutation.
- TX-04: previous-release migration, encounter and note fixtures produce
  traceable output or explicit quarantine.
- TX-05: empty Medplum → provider import → staff update → read-back → independent
  provider change → application is proved end to end.
- TX-06: two workers cover lease expiry, duplicate/correction/poison input,
  replay and conflict.
- TX-07: two replicas and tenants using limited credentials share no mutable
  site/patient singleton or data.
- TX-08: isolated full restore reconciles delivery without blindly resending an
  already delivered action.
- TX-09: patient/team/library bytes, thumbnails, export metadata and signed URLs
  enforce current audience and expiry.

### Real AI, audio, value and UI

- AI-01: strict schema, refusal/incomplete/429/timeout, long input and
  cancellation never report fallback as model success.
- AI-02: two adapters run the same held-out synthetic scenarios; real service
  evidence remains separate from fixtures.
- AI-03: real audio bytes → reviewed transcript → model proposal → approved
  action, plus exact TTS readout.
- AI-04: logs are token/key/PHI-free, cost is bounded and injected content has
  no unrestricted tool/network reach.
- VA-01: one activity with multiple tags/documents/staff/interruptions cannot
  inflate billable evidence.
- VA-02: improvement proposal → diff/tests → human activation → comparison →
  rollback cannot autonomously change permission or score staff.
- UI-01: general/patient/staff/direct/admin modes work at required viewport,
  theme, keyboard, zoom and transparency states with clear actor/subject/audience.
- UI-02: irregular timestamped values, missing/negative/allergy states and
  source staleness display truthfully.
- UI-03: no duplicate navigation/cards, hidden composer, unreachable review,
  false presence, decorative chart or dead feature button remains.

## 20. Required acceptance evidence and execution order

First demonstrate the central agent/GenUI/faithful-delivery slice with current stores and a real model when access exists. Finish the reliability dependencies alongside it, then expand shared role/site features. Do not spend another cycle adding appearance without proving the core conversation.

Keep G0–G7. Map inherited IDs plus these concrete closure probes into it:

| Probe                     | Passing evidence                                                                                                                                                   |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| C1 — natural answer       | A factual plain-text answer from real tools, with sources and ZERO required cards; ordinary acknowledgment needs no fake citation.                                 |
| C2 — multiple results     | Model uses two different tools and answers from both. Last tool does not determine the entire response or erase prior evidence.                                    |
| C3 — genuine GenUI        | Same dataset requested briefly, as a table and as a chart yields appropriate model-selected composition using the registered catalog; no new intent/screen branch. |
| C4 — arbitrary phrasing   | Held-out ordinary paraphrases and general proposal corrections work without phrase-specific code. All current negation/attribution tests remain meaningful.        |
| C5 — correct faithfulness | Anna's dizziness example adds no unreported facts; numeric associations, history and uncertainty remain correct across UI/review/FHIR/read-back.                   |
| C6 — durable revision     | Luca and an independently chosen different case revise the same proposal through multiple turns, tabs, switches and restart. No accidental completion/message.     |
| C7 — safe presentation    | Unknown components, invented source/draft refs, injected provider text and interrupted streams cannot execute or widen access.                                     |
| C8 — full integration     | Empty Medplum plus stateful fake source, inbound import, reviewed update, delivery/read-back, independent external edit, conflict and restart.                     |
| C9 — one execution path   | Both chat review and applicable direct controls use durable acceptance; double clicks/lost responses/lease expiry have no duplicate effective record.              |
| C10 — complete workday    | Two consecutive shifts, exact handover/addenda/readout, interruption, deferral and incoming acceptance with real stores.                                           |
| C11 — low-code adaptation | Second institution/multiple departments and distinct roles via existing reviewed packs; guidance and metadata changes have separate tested effects.                |
| C12 — people/privacy      | Team lead sees permitted colleague work but not private chats; explicit DM publication, role queues, revocation and library bytes/search/counts are scoped.        |
| C13 — identity/recovery   | Test IdP, limited-role RLS, two replicas/workers, retention and actual isolated restore/reconciliation.                                                            |
| C14 — value/improvement   | One evidence event cannot inflate services; reviewed configuration diff/test/publish/pilot/rollback produces labelled synthetic metrics.                           |
| C15 — actual AI/audio     | Actual model and ASR/TTS calls plus held-out model-swap evaluation; fixtures/429/503 are reported separately, never counted as acceptance.                         |
| C16 — UI                  | Integrated complete scenarios at required screen/theme/accessibility states, with correct subject/audience and no duplicate or nonfunctional controls.             |

Use held-out variations unknown to the implementation author and different source fixtures. Assertions compare meaning, access and effects—not one preferred German sentence. A grading model may assist, not replace responsible clinical review. Add every discovered failure as a general behavioral regression, not another production string matcher.

Count suites without double-counting overlapping tests. Current independent reviewer opinions do not replace executed tests. Keep a traceable evidence index: exact SHA, commands, versions, environment/profile, scenario, state/receipt assertions, screenshots and declared skips. Required service absence must leave its gate unpassed. A memory-demo success is not integrated acceptance.

### Autonomous development loop

```text
read actual current status → select unmet acceptance dependency
→ reproduce/define failure → implement smallest complete slice
→ run targeted and real-store tests → exercise UI and inspect records
→ independent review where available → correct root causes
→ regression → coherent commit → update evidence → continue
```

Continue all independent internal work when one external item is blocked. Do not ask the user to choose trivial engineering details. Do not contact vendors, spend unbounded funds, expose new public services, import real patient data or deploy to an institution without explicit authorization. If execution/context limits intervene, preserve exact progress, worktree state, commands and next failure to resume. Do not declare final completion or promise invisible background work.

## 21. Cleanup, final audit and deliverables

Consolidate the normal agent path, typed tools, evidence registry, optional presentation and review executor. Remove obsolete production use of last-tool intent routing, phrase-equality validators, per-example correction branches and duplicate authority/state paths only after parity and safety tests. Keep useful serializers, UI primitives, value parsers and explicit degraded controls. Do not merely hide the old architecture with CSS or keep two permanent products behind flags.

Break large files by genuine ownership—not one wrapper per function. Prefer clear modules for evidence/proposals, tools, chat presentation, command acceptance and repositories. Remove dead exports, duplicate schemas, unsupported “ready” labels and stale docs. Do not delete historical clinical/audit data or useful regression scenarios to reduce line count.

The clean final audit must build from an actual clean checkout with the pinned lockfile, provision fresh own stores and fake provider, import fixtures and run the integrated journeys. Reusing a developer database is separate evidence. Configure meaningful CI for the working branch/PR and record its actual results; an unavailable CI service is not a fabricated green run.

Final report separately states:

1. **Synthetic product completion:** all internal G gates implemented and exercised with real own stores and simulated external systems.
2. **Connected AI/audio:** actual available model, microphone ASR and TTS scenarios passed, with measured limitations and held-out results.
3. **Institutional read-only pilot:** generic controls internally complete plus the required real source/device/identity/privacy approvals.
4. **Controlled provider-write pilot:** verified vendor operations, mappings/receipts/conflicts, recovery and institutional review.

Provide the exact runtime MD paths and edit/preview/publish commands, one demonstrated configuration change, tool/presentation traces without hidden chain-of-thought, final UI screenshot index, scope/access tests, actual delivery/restore evidence, cost/latency measures and remaining external prerequisites. All current normal actions advertised as working must actually work in the declared profile.

**Do not relabel partial work as a new roadmap or claim the product is complete because the test count increased. The final proof is a natural conversation that completes real reviewed work, with useful adaptive UI and reliable records underneath.**

## 22. Binding release-closure continuation

The 14 September 2026 release-closure instruction is merged here rather than
maintained as another architecture or roadmap. It does not replace any G0–G7,
MD/AG/CT/WF/TX/AI/VA/UI or C1–C16 requirement above.

### Publish the inspectable baseline independently

The OpenUI/Vercel AI SDK conversation replacement, its pinned lockfile, tests
and truthful documentation may be committed and published independently of an
OpenAI account sign-in. Publication never closes a credential incident and
must not use a reported exposed credential. Secret scans operate on names,
digests and redacted findings only. Record database rotation, OpenAI
revocation/rotation, usage review and connected acceptance as separate facts.

Every release candidate exposes one non-secret build diagnostic. It identifies
the exact API and PWA source SHA/build ID, says whether they match, and keeps
persistence, model/audio and provider readiness as separate component states.
The shipped PWA artifact—not a source-code assumption—supplies the PWA
identity. A `/models` response, a configured key or matching build identifiers
do not prove model competence, durable storage or provider acceptance.

### Preserve the replacement and remove parallel authorities

Do not start another frontend or agent framework migration. Keep one custom
composer, one server-owned conversation history, one AgentInterface/OpenUI
renderer and one Vercel AI SDK UIMessage stream. Persist an authorized turn
before its first renderable byte. Treat client/tool messages, source handles,
component names and prior action controls as untrusted; re-authorize on the
server and expose only the latest actionable revision. Cancellation, tab
switches, reload and restart must not leak, revive or cross-bind a response.

The model authors ordinary conversation and specific question-only
clarifications. Deterministic code authorizes tools, resolves exact source
atoms, validates reviewed meaning and executes accepted effects. Do not add a
new source-word grammar or fixed-German response tree to make tests green.
Provider prose, browser state and a human click are not independent occurrence
evidence.

Maintain an explicit removal/migration inventory while retiring the former
surface, last-tool response routing and duplicate mutation authorities. A
compatibility adapter may remain only when its caller, sunset condition and
non-authoritative status are documented and tested. Remove obsolete code only
after the new path has parity and durable recovery evidence.

### Execute closure in the existing order

1. Publish a secret-free, inspectable G0/G5 baseline with exact remote SHA and
   matching build identities.
2. Prove the G1/G4/G7 conversational slice with an accepted real model, two
   unrelated synthetic patients, authorized reads, natural prose, a specific
   clarification, optional GenUI, a corrected draft, human approval,
   persistence/read-back and reload.
3. Complete the G1/G2/G3 working-day journey through provider import,
   handover, interruption/rollback/resume, collaboration, deferral, shift
   transfer and process restart, including failures before and after local
   commit.
4. Finish G3/G5 shared workspaces, library, governed Markdown publication,
   second-site configuration, test OIDC/RLS and immediate revocation.
5. Close G1/G5/G6/G7 analytics, direct-action convergence, multi-instance
   operation, migrations/restore/retention/egress, visual/performance evidence,
   CI and an isolated clean-checkout proof.

For final proof, provision clean own stores plus an independent stateful fake
provider and run real-store suites sequentially where their fixture resets
conflict. Classify every skip and report unit/fixture, PostgreSQL, Medplum,
provider, browser and connected model/audio evidence separately. Continue
internal work when an external account, vendor or institutional approval is
blocked.

Every handoff reports six independent states: source published/reviewable;
conversation replacement implemented; connected AI/audio accepted; complete
synthetic product; institutional read-only pilot approved; controlled real
provider-write pilot approved. Never collapse those into one completion label.

## Official reference register

The source-audit findings above come from the repository at the named SHA; the requirements are the requested target, not claims that they are implemented. Consult exact installed-version official documentation during development. The sources below support engineering/role/privacy principles, not certification.

- OpenUI library/prompt/parser/renderer: https://www.openui.com/docs/openui-lang/overview
- OpenUI renderer and APIs: https://www.openui.com/docs/openui-lang/renderer ; https://www.openui.com/docs/api-reference
- Function/tool calling: https://developers.openai.com/api/docs/guides/function-calling
- Structured outputs and their limitations: https://developers.openai.com/api/docs/guides/structured-outputs
- Agent Skills format: https://agentskills.io/specification
- Simple agent/workflow patterns (foundational article; tooling has evolved): https://www.anthropic.com/engineering/building-effective-agents
- Medplum access policies: https://www.medplum.com/docs/access/access-policies
- Medplum project/transaction settings: https://www.medplum.com/docs/self-hosting/project-settings
- BAG professional-role FAQ: https://www.bag.admin.ch/de/haeufige-fragen-faq-zum-gesundheitsberufegesetz-gesbg
- EDÖB AI/privacy: https://www.edoeb.admin.ch/de/ki-und-datenschutz
- EDÖB employer data: https://www.edoeb.admin.ch/de/datenbearbeitung-durch-den-arbeitgeber
- Swissmedic official software qualification guidance entry point: https://www.swissmedic.ch/swissmedic/en/home/medical-devices/regulation-of-medical-devices/faq.html

Before real deployment verify applicable role/delegation, retention, regulatory, tariff and vendor contracts with the responsible institution. Do not invent an endpoint, clinical permission or compliance approval to close a test.

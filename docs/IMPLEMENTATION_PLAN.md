# Implementation plan

Last updated: 2026-09-09
Baseline: `a197e0b816e4d7042a86abf4e9b8a8ab4c02331c`

The product contract is `docs/PRODUCT_CONTRACT.md`. Work proceeds in six vertical slices on the existing modular monolith and one PWA. A table, migration or simulator alone does not complete a slice; each gate needs a real endpoint-to-storage-to-UI test.

## Lean-completion implementation matrix

This matrix reconciles the source audit of `a197e0b` with the active product contract. `Internal` means repository work; `EXTERNAL_VENDOR_GATE` is used only for evidence the repository cannot create.

| Outcome                                | Existing implementation                                                                | Defect / simplification                                                                                                                       | Acceptance evidence                                                                              | Gate                                 |
| -------------------------------------- | -------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ | ------------------------------------ |
| Natural, model-upgradable conversation | Typed `AssistantProposal`, bounded authorized model context and deterministic composer | Add a genuine bounded model-presentation composer and formal model-swap/held-out clinical corpus without moving authority into the model      | context/model-request tests, model-swap corpus, read queries remain action-free                  | Internal                             |
| One readable approval                  | One-use review cards, local finality and high-assurance countersignature               | Persist proposal revision/hash as first-class relational records and prove concurrent countersignature behavior                               | one review produces explicit per-item local/destination states; edits create a new revision/hash | Internal                             |
| Durable acceptance                     | Hashed intent/voice authority and restart/replay tests in PostgreSQL                   | Complete one atomic accepted-command transaction across authority, workflow, audit and FHIR/provider outbox                                   | concurrent/restart/replay/lost-response tests                                                    | Internal                             |
| Interruptible work                     | Versioned roster, episode drafts/evidence, defer and receiver receipt                  | Add concurrent mutation tests and finer subtask responsibility only where real institutional workflows require it                             | memory + real PostgreSQL behavioral contract and browser interruption journey                    | Internal                             |
| Provider synchronization               | Neutral adapters, simulators and FHIR projections                                      | Use leased relational inbox/outbox, one terminal-state vocabulary and explicit destination routing; do not use the checkpoint as worker queue | two-worker/retry/dedupe/restart/inbound/outbound tests                                           | Internal                             |
| Clinical state ownership               | Medplum resources plus whole-state Binary checkpoint                                   | Reconstruct from resource-scoped clinical repositories and retire checkpoint from normal operation after migration test                       | restart/reconstruction and failing real Medplum transaction                                      | Internal                             |
| Site portability                       | Runtime immutable site pack, second fictional site, 2/12 assignments                   | Add governed immutable publication/activation and site-scoped Medplum control-resource migration                                              | pack validation and 2/12-assignment acceptance                                                   | Internal                             |
| Shared collaboration                   | Authorized shared patient team thread and role/named ownership                         | Add persistent multi-comment history, directory/coverage resolution and revocation/event-replay proof                                         | cross-role/audience/revocation/thread lifecycle tests                                            | Internal                             |
| Voice/model truth                      | Local/hosted adapters and browser/file capture                                         | Health requires a bounded real call; allow permitted patient-independent voice; preserve honest disabled state                                | configured smoke test or explicit `disabled`, MIME/size/context tests                            | Internal + deployment/model approval |
| Vendor activation                      | Per-operation gated provider registry                                                  | Never invent private endpoints; activate operations independently only with contracts/auth/sandbox/read-back evidence                         | vendor contract acceptance suite                                                                 | `EXTERNAL_VENDOR_GATE`               |
| Operational proof                      | Fast checks, Playwright and checksum smoke                                             | Add real PostgreSQL/Medplum backup-restore and blocked-egress execution evidence; publish exact skips                                         | clean-checkout evidence manifest                                                                 | Internal + deployment approval       |

## Current implementation checkpoint

- Pinned Node 24.19.0 and pnpm 11.19.0; the local validation runtime is Node 24.18.0 and satisfies the pinned major/runtime constraints.
- Generic proposal IR, independent model grounding, negation/temporal/partial/correction coverage and dedicated clinical-workflow rejection are implemented and regression tested.
- The configured early shift supplies six assigned patients; handover acknowledgement, start/pause/interruption/resume/completion, episode draft, explicit defer and receiving-shift acknowledgement run in PostgreSQL and the PWA. This is the sole live responsibility authority.
- Site timezone, shifts, provider routing, role permissions, workflows and staff assignment are runtime-loaded and strictly validated. `alpenblick-demo.json` and 2/12-assignment tests prove source-code-independent variation.
- Workday access now fails closed when no exact actor+role assignment exists; older operational databases receive the `context_revision` compatibility upgrade idempotently.
- Same-shift handovers are actor-owned, acknowledgements bind the exact handover/version, terminal episodes cannot be reopened, one planned responsibility cannot be duplicated and transferred shifts cannot restart. PostgreSQL and the executable demo store share these behavioral contracts.
- Recent model context is patient-filtered and each completed response retains its origin patient/revision across slow in-flight context switches. The PWA locks chat/role/context controls until server-confirmed patient changes and autosaves episode drafts before reload.
- The clinical compiler has a conservative generic imperative boundary, preserves scalar uncertainty and `nicht … sondern …` corrections, and keeps ambiguous physician timing in one concise clarification rather than inventing a deadline.
- The patient profile includes safety, goals, medication read-only data, approved recent vitals and care protocol. Team questions render as shared patient-bound threads with narrow acknowledge/answer/close ownership and no first-user auto-assignment.
- Hashed one-use assistant and voice authority is durable across API restart. Normal clinical review is locally final; doubtful measurements remain non-current until independent countersignature.
- Provider simulators now receive note, Observation, Task and Communication commands and preserve business workflow state while acknowledgement is tracked separately.
- Production local fast/deep/ASR model packs require immutable SHA-256 digest configuration; local endpoint redirects and link-local addresses fail closed. Hosted development remains explicit-consent, synthetic-only.
- The remaining production acceptance work is concentrated in Slices C, E and F; it must not be relabelled as an external vendor gate.

## Slice A — clinical work compiler

- Introduce one versioned generic `AssistantProposal` IR: `understoodFacts`, `workPerformed`, `observations`, `taskChanges`, `communications`, `workflowActions`, `ambiguities` and `evidence`, with specific typed execution schemas underneath. Staff never sees this schema terminology.
- Preserve conversational session context and answer as a coworker first; show only the smallest editable GenUI review needed for the current utterance. Ask at most one concise blocking clarification and never repeat already known patient/task/session context.
- Parse multiple measurements and care/task/communication statements with bounded configurable counts.
- Remove unconditional four-action BP defaults and exact equality against the deterministic four-action fixture.
- Bind review/approval to the normalized internal proposal, selected action IDs and resource-level read set.
- Regression corpus: all eight mandatory sentences plus held-out paraphrases and absence-of-evidence cases.

Gate: negated/historical/refused actions never become executed positives; `250 ml` is intake, not medication; three measurements yield three observations; missing facts/actions yield clarification or no-op.

## Slice B — interrupted nursing shift

- Persist explicit workflow transitions and versioned handover roster acknowledgments.
- Add a constraint-explained morning work plan, patient/encounter-bound work episodes, start/pause/resume/complete segments, spontaneous work and mirrored interruption tasks.
- Preserve deferred draft/context across explicit patient switches and refresh.
- Build shift reconciliation and a versioned handover snapshot/addendum; next shift acknowledges exact version; no approved event is resubmitted.
- Materialize roster, plan, episode, interruption/resume and shift-close artifacts in the one conversation.

Gate: the synthetic nurse completes the reference day, handles an alarm interruption and resumes the original patient with no wrong-patient action or duplicate note/service evidence.

## Slice C — durable execution and providers

- Move intent and voice authority, proposal revisions, approvals, idempotency receipts, command state, workflow mutation, domain event and provider/FHIR outbox acceptance into PostgreSQL transactions.
- Implement leased `FOR UPDATE SKIP LOCKED` workers, retry/backoff, poison/manual state, item receipts, lost-ack reconciliation, inbound inbox/dedupe/cursor/conflict and restart recovery.
- Serve SSE from durable audience-scoped events with cursor reset and reauthorization.
- Reconstruct runtime clinical state from Medplum resources and operational state; migrate/retire the whole-state checkpoint Binary from live reads.
- Verify the deployed Medplum project’s `transaction-bundles` feature with a deliberately failing real transaction and no-partial-write assertion.

Gate: restart, duplicate commands, two workers and ambiguous provider/FHIR acknowledgments produce no silent loss or duplicate effective write.

## Slice D — speech, model and adaptive GenUI

- Add one validated configuration schema for production-local and explicit synthetic-development AI. Keep credentials server-only and commit only empty placeholders.
- Implement OpenAI Responses with `store:false` and structured proposal output, plus local OpenAI-compatible Chat Completions as a separate adapter.
- Implement bounded microphone file upload to `/v1/audio/transcriptions`, configurable `gpt-transcribe`, and a separately gated realtime model setting. Validate codec, size, duration, cancellation and patient-bound receipt.
- Default the balanced development route to `gpt-5.6-terra`; allow `gpt-5.6-sol` for quality evaluation. Production-local denies hosted fallback.
- Add useful roster/work-plan/episode/trend/approval/thread/sync artifacts and fix textarea sizing, keyboard/safe-area layout, chips, icons, resolved picker, scroll preservation and light/dark/system themes.

Gate: text, tap and recorded synthetic audio reach the same editable proposal; external calls require explicit opt-in; the app remains usable with model/ASR unavailable; mobile/landscape/tablet/desktop do not obscure controls.

## Slice E — role, site and collaboration configuration

- Configure organizations, sites, wards, shifts, directories, provider instances and distinct SRK/AGS/FaGe/RN/physician/pharmacy/support/therapy/transport/service/admin/billing/management/HR/IT/quality profiles without source forks.
- Add bounded Workflow Studio draft/validate/preview/publish/activate flows; published versions are immutable and cannot grant permissions.
- Persist private assistant, patient-team, department, direct and administrative threads with minimum views.
- Resolve `@person`/`@role` through authorized directory/coverage; duplicate permitted questions are suggested without leaking restricted threads; click-to-call is available only when configured.

Gate: two fictional houses run different workflow/provider configuration from the same binary; role changes, mention search and event replay disclose no unauthorized patient/thread data.

## Slice F — governed knowledge, evidence and deployment acceptance

- Persist approved knowledge with owner, audience, version, review/expiry and retraction; provide signed offline import and gated Staffbase/Loop connector boundary without scraping.
- Store service evidence with episode, author, actual/interruption segments, materials, correction and review state. Keep tariff eligibility/coding behind an approved adapter.
- Project aggregate small-cell-suppressed operational analytics without staff ranking.
- Add executable installation validation, migration up/down/rollback evidence, representative operational+Medplum backup/restore, secret/model artifact checks and a staff evaluation protocol.

Gate: revoked knowledge disappears, timer segments cannot double-charge, clean checkout reproduces the synthetic reference day, and deployment fails closed when required identity/security/provider evidence is absent.

## Completion audit

Run `pnpm verify`, `pnpm verify:security`, `pnpm verify:ops`, `pnpm verify:airgap` and the full multi-viewport `pnpm verify:e2e`; then perform clean-checkout install, environment generation, double migration, integrated startup, nursing/physician/voice/provider/offline/SSE/restart/restore journeys and secret/PHI/dead-path inspection. Record results against the final SHA in `docs/IMPLEMENTATION_STATUS.md` and the evidence manifest. External model calls run only when the developer supplied credentials and explicit synthetic-data opt-in.

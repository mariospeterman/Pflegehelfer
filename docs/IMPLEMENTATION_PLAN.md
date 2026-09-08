# Implementation plan

Last updated: 2026-09-08
Baseline: `fcd9f782bb0e5052e057854cbcbaccc39aa1630e`

The product contract is `docs/PRODUCT_CONTRACT.md`. Work proceeds in six vertical slices on the existing modular monolith and one PWA. A table, migration or simulator alone does not complete a slice; each gate needs a real endpoint-to-storage-to-UI test.

## Current implementation checkpoint

- Pinned Node 24.19.0 and pnpm 11.19.0.
- Generic proposal IR, independent model grounding, negation/temporal/partial/correction coverage and dedicated clinical-workflow rejection are implemented and regression tested.
- The configured early shift supplies six assigned patients; handover acknowledgement, start/pause/interruption/resume/completion and provider-state display run in PostgreSQL and the PWA.
- Site timezone, shifts, provider routing intent, role permissions, workflows and staff assignment are strictly validated in `config/sites/tertianum-kronenhof.json`.
- Workday access now fails closed when no exact actor+role assignment exists; older operational databases receive the `context_revision` compatibility upgrade idempotently.
- The clinical compiler has a conservative generic imperative boundary, preserves scalar uncertainty and `nicht … sondern …` corrections, and keeps ambiguous physician timing in one concise clarification rather than inventing a deadline.
- The patient profile includes safety, goals, medication read-only data, recent vitals and care protocol. Team questions render as structured patient-bound threads with role-authorized acknowledge/answer/close actions.
- The remaining work is the production acceptance work listed under Slices C, E and F; it must not be relabelled as an external vendor gate.

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

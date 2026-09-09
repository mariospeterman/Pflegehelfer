# Lean completion audit — 2026-09-09

Scope: the active product contract, architecture, repository instructions and the three supplied completion/audit briefs were reconciled against the implementation. This is an evidence report, not a claim that the system is approved for real patients.

## Verified result

- The retired dashboard/focus implementation is absent. Pflegehelfer is one responsive conversation with explicit role/patient context, voice entry, bounded GenUI, deterministic review and an expert Medplum link.
- The generic assistant meaning layer covers multiple facts, work, observations, task changes, communication, workflow actions, ambiguity and evidence without exposing schema terms to staff. Negation, history, uncertainty, correction, partial work, no-action wording, interruptions and named communication are regression tested.
- Direct endpoints cannot bypass the central medication/treatment task boundary, contradictory completion-evidence guard, occurrence-time/range/high-assurance observation rules or provider protections.
- Workday responsibility is actor-owned and versioned. Exact handover receipts, six-patient plans, alarm/spontaneous interruption, autosaved drafts, resume/defer/completion and receiving-shift acknowledgement work in the executable demo and PostgreSQL. Terminal episodes/transferred shifts are final and planned responsibility cannot be duplicated.
- Recent model context is filtered by the active patient; slow responses retain the originating patient/context revision. During server context changes, chat, role and drawer transition controls are locked and stale completions are ignored.
- Institution-local FHIR projections carry institution-local classification and do not emit synthetic MRN systems. Simulated provider operations remain distinct from undocumented real vendor contracts.
- Fast, deep and ASR production-local runtimes require immutable model digests and deny redirects, link-local and public origins. Hosted AI is explicit-consent and synthetic-only.

## Executed evidence

- `pnpm verify`: formatting, ESLint, client/server typecheck, 272 passed unit/integration tests, 11 environment-gated skips, and a clean PWA/API production build.
- PostgreSQL operational suite with `.env.demo`: 11/11 passed after the idempotent migration, including actor independence, interruption, terminal finality, duplicate planned-work rejection, transfer receipt and durable one-use authority.
- `pnpm verify:e2e`: 33/33 applicable journeys passed over 360 px, 390 px, tablet, 1024 px and 1440 px; 12 intentionally desktop-once duplicate state-transition cases skipped on the other profiles.
- `pnpm verify:security`, `pnpm verify:ops`, `pnpm verify:airgap`: secrets/header checks, health/readiness, synthetic restore checksum and air-gap preflight passed.
- Independent architecture/provider, security/privacy/clinical-safety and GenUI/QA reviews reported no P0. Valid findings were fixed and retested; remaining architectural limits below were retained rather than relabelled complete.

## Remaining internal production blockers

1. Accepted authority, operational mutation, clinical approval/audit, FHIR projection and provider outbox acceptance are not yet one atomic PostgreSQL command transaction.
2. Durable intent records do not yet persist every target field from the architecture: workflow step/version, policy version, normalized proposal hash and full resource read set.
3. The handover receipt freezes actor/shift/roster identity, not an immutable per-patient clinical delta and exact Task/Observation/Communication/risk resource versions.
4. Provider processing does not yet use leased relational inbox/outbox workers with complete inbound dedupe/cursor/conflict recovery; SSE is not PostgreSQL replay/replica safe.
5. Medplum still reconstructs clinical runtime state from an HMAC-protected checkpoint Binary instead of resource-scoped repositories.
6. Workflow configuration is schema-validated, but governed Studio publish/activate and fully executable persisted step progression are incomplete.
7. PostgreSQL RLS/least-privilege roles, retention sweepers, production identity/device/CSRF integration, multi-replica proofs and encrypted PITR restore evidence remain deployment work.
8. High-assurance reviewer eligibility needs institution-specific qualification policy beyond a distinct authorized clinical identity. Formal held-out Swiss-German language/ASR evaluation is not complete.

## External/vendor gates

Real WiCare, careCoach, SAP/vitals, device and nurse-call activation still requires exact private contracts, authentication, sandbox credentials, mapping examples, error semantics and read-back acceptance evidence. Validated local model/ASR artifacts plus institutional privacy, clinical-safety, security and deployment approvals are also required. No such integration or approval is fabricated.

The repository therefore provides a complete synthetic showcase and a materially hardened implementation baseline, but it must not be used with real patient data or described as production-approved until these blockers and gates are closed.

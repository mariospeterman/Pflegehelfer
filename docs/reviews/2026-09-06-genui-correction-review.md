# GenUI correction and completion review — 2026-09-06

## Scope

Reviewed the branch after the GenUI-first correction against `AGENTS.md`, `ARCHITECTURE.md`, specialist architecture/provider, security/clinical and frontend/QA findings.

## Corrections verified in code

- no implicit first-patient selection; patient-bound questions request an explicit picker;
- one restored actor shift thread survives patient/lens changes; pending actions are invalidated on context change;
- purpose-built bounded OpenUI cards and per-action bundle review replace generic executable cards;
- care notes and observations remain drafts and create no provider outbox entry before normal approval;
- model plans are schema/count bounded and every executable field must exactly equal deterministic compilation; medication/dose instructions fail closed;
- local ASR uses a one-use context/text-bound receipt, individual critical-entity confirmation and no raw-audio retention;
- repeated snapshot reads commit audit deltas and cannot overflow a later Medplum transaction;
- per-operation provider gating permits verified operations without unlocking gated capabilities;
- pinned HAPI/CH Core artifacts can be imported, checksum-verified and executed.

## Validation record

Final command results from 2026-09-06:

- `pnpm verify`: PASS — Prettier, ESLint, both TypeScript projects, 10 test files / 89 tests and both production builds.
- `pnpm pfhctl fhir validate`: PASS (exit 0) — checksum-locked HAPI validator 6.9.12 with CH Core 6.0.0; no validation errors after correcting the oxygen-saturation LOINC mapping. Best-practice narrative and unavailable terminology-server warnings remain non-errors and are covered by the deployment validation gate.
- `pnpm verify:e2e`: PASS — 28 applicable journeys passed across 360 px, 390 px, tablet, 1024 px and 1440 px projects; 52 duplicate project journeys were intentionally skipped by their explicit viewport guards.
- `pnpm verify:security`, `pnpm verify:ops`, `pnpm verify:airgap`: PASS — response headers/secrets check, health/readiness, synthetic backup/restore checksum and offline preflight.
- Manual browser inspection: PASS for explicit patient selection, source-linked vitals, 390 × 844 overflow, console errors/warnings and the public ngrok route.
- Clean checkout: PASS — detached worktree at the evidence commit, `pnpm install --frozen-lockfile`, format, lint, both typechecks, 89 tests, both builds, security, operations/backup-restore and air-gap preflight. The complete Playwright matrix also passed from that detached worktree (28 applicable journeys; 52 intentional viewport skips).

## Evidence-backed remaining limitations

- operational persistence is still a single-process state machine plus Medplum checkpoint projection;
- SSE revisions and scheduled/provider workers are not durable across replicas;
- conversation Binary updates lack CAS and transaction coupling with clinical audit;
- provider inbound polling/inbox/cursor application and automatic outbound delivery are not implemented;
- OpenUI is incrementally rendered after a complete HTTP response; model-authored catalog composition is not enabled;
- production OIDC/device claims, Medplum AccessPolicy/KMS, model/ASR validation, institution profiles and private vendor contracts remain gated.

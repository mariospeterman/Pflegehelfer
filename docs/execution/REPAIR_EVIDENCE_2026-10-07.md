# Sol repair evidence — 7 October 2026

This is the live evidence matrix for the repair branch. It supplements the
canonical completion contract; it does not replace it. `PASS` means the named
technical regression is reproduced and closed on this branch. It does not mean
regulatory approval, production release, real-vendor compatibility or a
medical-device classification.

- Starting source: `10e6a4c21cb6e69c4c14a28865a33b9d2c87a9e1`
- Branch: `codex/sol-repair-2026-10-07`
- Data used: checked-in fictional/synthetic fixtures only

| Repair slice                           | Result            | Evidence                                                                                                                                                                                                                                                                                                                                                                                                   |
| -------------------------------------- | ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Disconnect during authority insertion  | PASS              | The baseline failed 3/20 repeated runs. The lifecycle promise is now installed before store callbacks can close the transport; 50 repeated runs and the focused cancellation suite pass.                                                                                                                                                                                                                   |
| Concrete-target command replay         | PASS              | V2 command keys bind institution, site, actor, method, route, concrete path and canonical body. Reusing one UUID for another task target returns `409`; regression in `tests/api.test.ts`. Unsafe legacy aliases are not accepted.                                                                                                                                                                         |
| Assistant inference retry identity     | PASS WITH CONCERN | The PWA reuses a command UUID for the same user-message ID. PostgreSQL migration 015 adds durable context-bound request claims; conversation append, completed response and claim completion share one transaction. Same content replays once and changed content returns `409`. Draft authority rows are still prepared immediately before that transaction, so crash-window consolidation remains open.  |
| Clinical/employment decision exclusion | PASS              | Deterministic pre-model rejection covers interpretation, risk ranking, treatment choice, dose changes, symptom-derived urgent intervention and employment decisions. Seven focused negative tests pass.                                                                                                                                                                                                    |
| Document parser egress                 | PASS              | Parser origins are local or explicit allowlist entries, redirects fail, and response reads stop at 2 MiB. Public-origin and redirect regressions pass. Failed/unavailable inspection now quarantines bytes from download.                                                                                                                                                                                  |
| Handover speech/data honesty           | PASS              | Workday playback checks accepted server TTS first; browser speech is demo-only. Missing content is reported as unavailable rather than “no concerns”. Audio object URLs are revoked.                                                                                                                                                                                                                       |
| Source read set                        | PASS              | `SourceReadSetV1` is captured with the draft and binds consulted Patient, Encounter, Task, Observation and Communication resources, exact claims, selector membership/absence/completeness, policy version and digest. Acceptance re-reads the same set and rejects changed versions or membership with `409`; it does not silently rebase. Whole-state startup authority remains a separate open blocker. |
| Middleware-generated urgency           | PASS              | Mirrored nurse-call events no longer invent urgent priority; elapsed communication deadlines change administrative state/routing without rewriting clinical priority.                                                                                                                                                                                                                                      |
| Scenario task + assignment             | PASS              | One idempotent API command validates and commits both changes, preserves existing assignments and derives the deadline from the scenario clock.                                                                                                                                                                                                                                                            |
| Offline/deployment guards              | PASS WITH CONCERN | `/ready` is never cached, shell caches are build-bound, logout revokes the local PG session and purges sensitive browser state before optional RP-initiated IdP logout. Real-stack namespaces now reject the showcase project and all protected service ports. Multi-tab/device and offline-upgrade evidence remains open.                                                                                 |

## Current verification

| Command                                      | Result                                                                                                                                                                                                                                 |
| -------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm test`                                  | PASS — 62 files / 534 tests passed; 12 files / 34 integration tests skipped only by their declared prerequisites                                                                                                                       |
| `pnpm format`, `pnpm lint`, `pnpm typecheck` | PASS after integration fixes; both TypeScript targets are green                                                                                                                                                                        |
| Focused workday browser regression, desktop  | PASS — 5/5 journeys                                                                                                                                                                                                                    |
| `pnpm verify:security`                       | PASS — named secret/header smoke check only                                                                                                                                                                                            |
| `pnpm verify:ops`                            | PASS — health/readiness and synthetic in-memory checksum only; not a real backup/restore                                                                                                                                               |
| `pnpm audit --prod`                          | PASS — no known advisories after Fastify/static and constrained transitive security updates                                                                                                                                            |
| Production build                             | PASS WITH CONCERN — API/PWA build green; `openui` is 1,653.64 kB minified / 495.69 kB gzip and still violates the unresolved chunk budget                                                                                              |
| Isolated PostgreSQL 024–026                  | PASS after setup correction — corrected broad run passed 10 files / 37 tests and exposed one test-cookie selection defect; after fixing it, migrations/OIDC/FORCE-RLS passed 3 files / 12 tests. Both temporary databases were removed |
| Checkpoint CI `aef26d6`                      | FAIL — `verify` green; old real-stack lane missed `PFH_STORAGE_MODE=medplum`. The current workflow fixes this, but no final-head remote run exists yet                                                                                 |

## Open release blockers

These remain `NOT READY`; none is converted into a documentation-only PASS:

1. Complete site/department/purpose/audience policy enforcement and bind every
   accepted/worker authority to the server-owned membership/policy revision.
2. Run the new SHA-bound OIDC browser write/restart/read-back journey on remote
   CI; local configuration alone is not passing evidence.
3. Resource-native restart/reconstruction and removal of the live whole-state
   checkpoint fallback; multi-replica operation remains deliberately blocked.
4. ACL-complete patient-team, department and direct conversation types.
5. Previous-release upgrade, actual
   backup/restore, two-instance/provider crash reconciliation and authenticated
   browser acceptance.
6. Retention/legal-hold implementation, offline logout purge, full bundle
   split, accessibility/device evidence and bounded soak/capacity evidence.
7. Institution-owned model/ASR/TTS, provider, privacy, security and regulatory
   acceptance. Real-data activation remains disabled.

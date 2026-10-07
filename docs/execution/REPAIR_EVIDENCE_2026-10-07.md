# Sol repair evidence — 7 October 2026

This is the live evidence matrix for the repair branch. It supplements the
canonical completion contract; it does not replace it. `PASS` means the named
technical regression is reproduced and closed on this branch. It does not mean
regulatory approval, production release, real-vendor compatibility or a
medical-device classification.

- Starting source: `10e6a4c21cb6e69c4c14a28865a33b9d2c87a9e1`
- Branch: `codex/sol-repair-2026-10-07`
- Data used: checked-in fictional/synthetic fixtures only

| Repair slice                           | Result            | Evidence                                                                                                                                                                                                                                                                                                                                                                                                  |
| -------------------------------------- | ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Disconnect during authority insertion  | PASS              | The baseline failed 3/20 repeated runs. The lifecycle promise is now installed before store callbacks can close the transport; 50 repeated runs and the focused cancellation suite pass.                                                                                                                                                                                                                  |
| Concrete-target command replay         | PASS              | V2 command keys bind institution, site, actor, method, route, concrete path and canonical body. Reusing one UUID for another task target returns `409`; regression in `tests/api.test.ts`. Unsafe legacy aliases are not accepted.                                                                                                                                                                        |
| Assistant inference retry identity     | PASS WITH CONCERN | The PWA reuses a command UUID for the same user-message ID. PostgreSQL migration 015 adds durable context-bound request claims; conversation append, completed response and claim completion share one transaction. Same content replays once and changed content returns `409`. Draft authority rows are still prepared immediately before that transaction, so crash-window consolidation remains open. |
| Clinical/employment decision exclusion | PASS              | Deterministic pre-model rejection covers interpretation, risk ranking, treatment choice, dose changes, symptom-derived urgent intervention and employment decisions. Seven focused negative tests pass.                                                                                                                                                                                                   |
| Document parser egress                 | PASS              | Parser origins are local or explicit allowlist entries, redirects fail, and response reads stop at 2 MiB. Public-origin and redirect regressions pass. Failed/unavailable inspection now quarantines bytes from download.                                                                                                                                                                                 |
| Handover speech/data honesty           | PASS              | Workday playback checks accepted server TTS first; browser speech is demo-only. Missing content is reported as unavailable rather than “no concerns”. Audio object URLs are revoked.                                                                                                                                                                                                                      |
| Source read set                        | PASS WITH CONCERN | Accepted commands now store independently read FHIR `meta.versionId` values for Patient and Encounter and fail closed in Medplum mode when unavailable. Full read-at-draft versus read-at-accept comparison remains part of the open checkpoint/resource-native slice.                                                                                                                                    |
| Middleware-generated urgency           | PASS              | Mirrored nurse-call events no longer invent urgent priority; elapsed communication deadlines change administrative state/routing without rewriting clinical priority.                                                                                                                                                                                                                                     |
| Scenario task + assignment             | PASS              | One idempotent API command validates and commits both changes, preserves existing assignments and derives the deadline from the scenario clock.                                                                                                                                                                                                                                                           |
| Offline/deployment guards              | PASS WITH CONCERN | `/ready` is never cached, shell caches are build-bound, Helm emits `PFH_RUNTIME_PROFILE`/`PFH_AI_MODE`, and replicas above one fail rendering while the local read model exists. Logout cache purge awaits the production identity flow.                                                                                                                                                                  |

## Current verification

| Command                                     | Result                                                                                                                                                                      |
| ------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm verify`                               | PASS — format, lint, both TypeScript targets, 55 files / 490 tests passed, 9 files / 26 integration tests skipped by their declared prerequisites, production PWA/API build |
| Focused workday browser regression, desktop | PASS — 5/5 journeys                                                                                                                                                         |
| `pnpm verify:security`                      | PASS — named secret/header smoke check only                                                                                                                                 |
| `pnpm verify:ops`                           | PASS — health/readiness and synthetic in-memory checksum only; not a real backup/restore                                                                                    |
| `pnpm audit --prod`                         | PASS — no known advisories after Fastify/static and constrained transitive security updates                                                                                 |
| Initial PWA chunk                           | OPEN — 2,424.13 kB minified / 702.21 kB gzip; Vite budget warning remains                                                                                                   |

## Open release blockers

These remain `NOT READY`; none is converted into a documentation-only PASS:

1. Standards-based production OIDC/BFF, durable sessions, CSRF/logout and a
   real fictional test IdP.
2. Least-privilege PostgreSQL runtime credentials, forced tenant/site RLS and
   transaction-local identity context with adversarial real-database tests.
3. Resource-native restart/reconstruction and removal of the live whole-state
   checkpoint fallback; multi-replica operation remains deliberately blocked.
4. ACL-complete patient-team, department and direct conversation types.
5. Mandatory isolated real-stack CI, previous-release upgrade, actual
   backup/restore, two-instance/provider crash reconciliation and authenticated
   browser acceptance.
6. Retention/legal-hold implementation, offline logout purge, full bundle
   split, accessibility/device evidence and bounded soak/capacity evidence.
7. Institution-owned model/ASR/TTS, provider, privacy, security and regulatory
   acceptance. Real-data activation remains disabled.

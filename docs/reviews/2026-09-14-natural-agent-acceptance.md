# Natural agent acceptance review — 2026-09-14

Reviewed baseline: `2b1233d575fb8c33b9f5b98f1211171cd4401e2e`

Implemented commits: `35ba60e`, `977e3ae`

## Independent findings and dispositions

| Finding                                                                              | Disposition                                                                                                                                                                       |
| ------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Last successful tool selected an old fixed intent and response tree.                 | Removed. Terminal status and exact draft reference control the boundary; read answers stay natural text unless the model explicitly requests a safe presentation.                 |
| Prose grounding depended on rendered cards.                                          | Removed. Every successful tool result is retained in an immutable evidence registry; prose/presentation validation reads that registry.                                           |
| `prepare_care_update` made a second model call through the legacy compiler.          | Replaced by the typed `prepare_clinical_draft` tool. One agent loop submits meaning and receives one server-owned opaque reference.                                               |
| Durable proposal payload could be altered before reissue/execution.                  | Restored, reissued and executed care proposals now repeat source-record verification and the medication/treatment boundary. A tampered insulin note is rejected before authority. |
| Model-authored facts could be displayed with a valid but unrelated citation.         | Generated factual prose is conservatively compared with immutable cited evidence; unsupported content is withheld. Invented evidence/presentation references fail closed.         |
| Two same-patient tabs could restore the other thread's pending draft in memory mode. | Pending draft lookup now requires the authority's exact thread ID, matching the PostgreSQL path.                                                                                  |
| Input after 1200 characters could be omitted before safety interpretation.           | Assistant/model/proposal/voice request boundaries now retain up to 8000 characters; a late negated action regression is covered.                                                  |
| Selected handover detail pushed its acknowledgement under the composer.              | Acceptance is now before expanded detail. At 390×844 it measured y=445.5–489.5 while the composer measured y=728–801.                                                             |

## Verification

- `pnpm verify`: formatting, lint, both TypeScript configurations, 411 tests
  passed with 24 environment-gated skips, and production PWA/API builds passed.
- `pnpm verify:e2e`: 66 browser tests passed across 360 px, 390 px, tablet,
  1024 px and 1440 px; 19 project-conditional tests were deliberately skipped.
- `pnpm verify:security`, `pnpm verify:ops`, `pnpm verify:airgap`: passed.
- Live `integrated-demo`: PostgreSQL ready, Medplum 5.1.37 ready with verified
  transaction atomicity, independent provider simulator ready, relational
  workers ready and queues empty.
- Sequential real-store runs: 23 PostgreSQL/Medplum tests passed. These suites
  reset one demo institution and are invalid if executed concurrently.

## Unpassed evidence

The configured non-writing model test returned `ready:false` after 4515 ms and
kept deterministic fallback active. Real model, microphone ASR and governed TTS
acceptance therefore remain unpassed. Production provider contracts and
credentials remain operation-specific `EXTERNAL_VENDOR_GATE`s. G1–G7 gaps in
the completion matrix remain binding.

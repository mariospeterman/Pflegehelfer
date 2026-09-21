# Integrated acceptance recovery — 2026-09-13

Baseline reviewed: `18d485a0e25017a43f601c9870ec9c201e7ed073`

Natural-coworker source-audit baseline:
`2b1233d575fb8c33b9f5b98f1211171cd4401e2e`. The 14 September completion
contract adds C1–C16 without replacing G0–G7 or the inherited
MD/AG/CT/WF/TX/AI/VA/UI acceptance families. Evidence below predating that SHA
remains historical evidence for its named runtime and is not silently promoted
to the new probes.

This record distinguishes an interaction-only memory demo from the integrated
synthetic environment. It is evidence for the current increment, not a claim
that G0–G7 or a real clinical deployment is complete.

## Runtime profiles

| Profile           | Required components                                                                               | Fallback rule                                                            |
| ----------------- | ------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| `memory-demo`     | in-process reference state and in-process provider simulators                                     | explicitly non-durable; never described as integrated product completion |
| `integrated-demo` | operational PostgreSQL, Medplum and the independent bearer-protected stateful fake provider       | startup fails if any binding is absent; no memory fallback               |
| `production`      | operational PostgreSQL, governed Medplum, production identity and verified provider configuration | demo identities and hosted synthetic AI are rejected                     |

`GET /api/v1/diagnostics` reports PostgreSQL, Medplum, relational delivery
queues, provider instances, model, ASR and TTS separately. A component being
configured or reachable is not equivalent to accepted behavior.

## Recovered integrated environment

- Docker Desktop was started through its normal application launcher. No
  reset, volume deletion or machine configuration change was performed.
- Operational PostgreSQL listened on `127.0.0.1:5434`.
- Medplum API/UI listened on `127.0.0.1:8103` and `127.0.0.1:3001`; the
  verified server was 5.1.37.
- The independent fake provider listened on `127.0.0.1:8787` and persisted
  synthetic records under ignored local `.data/` storage. Its process-restart
  contract was exercised independently.
- The PWA development server listened on `127.0.0.1:5173`.

## Durable command and delivery proof

The integrated reviewed-assistant path now commits these local facts in one
PostgreSQL transaction:

1. accepted command and stable idempotency receipt;
2. one-use authority consumption and proposal-revision consumption;
3. append-only audit entries and the local-acceptance domain event;
4. resource-scoped Medplum projection job; and
5. provider jobs carrying the acceptance-time actor, purpose, patient,
   encounter, thread/context, proposal and policy envelope.

The same transaction also stores the post-command recovery checkpoint and,
when an active matching episode exists, its bounded draft evidence. A restart
loads the newest locally accepted checkpoint before serving traffic; a pending
projection still reaches Medplum only through its lease.

No Medplum or provider HTTP call occurs in that transaction. The normal
integrated application starts one leased Medplum projection worker and one
leased provider worker. Both verify remote read-back before delivery becomes
terminal. Retry/manual outcomes are durable, and manual outcomes set the
parent accepted command to `manual-review`.

The legacy checkpoint outbox copy is removed only after successful relational
acceptance. Its manual processing/reconciliation endpoints fail closed in the
integrated profile. Remaining direct mutation endpoints have not all migrated,
which is why G1 stays `PARTIAL`.

Current real-store regression command (commit `ca4e0e9` plus the session-race
fix at `dca9044`):

```sh
PFH_DEMO_MODE=true node --env-file=.env.demo node_modules/vitest/vitest.mjs run \
  tests/postgres-atomic-acceptance.test.ts \
  tests/postgres-clinical-projection-order.regression-1.test.ts \
  tests/postgres-natural-coworker-continuity.regression-1.test.ts \
  tests/postgres-provider-worker.test.ts \
  tests/postgres-operational-store.test.ts \
  tests/postgres-sync-summary.regression-1.test.ts \
  tests/pwa-startup-session-race.regression-1.test.ts \
  --no-file-parallelism --reporter=dot
```

Latest focused result: 7 files and 24 tests passed against operational
PostgreSQL on 2026-09-14. The migration ledger verified versions 1–10;
migration 008 adds provider-version, adapter-version, mapping-version and
read-back-hash evidence to durable provider receipts, while migrations 009–010
add site-scoped browser-tab context bindings and their authority constraint.

The natural interruption command now joins the same transaction. Pausing the
exact actor-owned episode, ending its segment, creating the spontaneous episode,
switching the working session and browser-tab context, consuming the reviewed
authority, storing its receipt/audit and enqueuing projection/delivery are one
PostgreSQL commit. The real-store regression proves the resulting Luca context,
the resumable Anna episode and byte-identical command replay. A live 390 px
integrated-browser run then approved the same sentence and showed room 207,
`p-luca`, an enabled composer and no console errors; evidence screenshot:
`/tmp/pfh-integrated-atomic-interruption-complete-390.png`.

The full suite also exposed a transport cancellation race: a response `finish`
could hide a socket disconnect concurrent with durable insertion. Disconnect
state is irreversible and the route now checks request/socket destruction
before and after authority insertion, after conversation persistence and at
response completion. The five cancellation cases passed ten consecutive
focused runs plus the loaded full regression. The current default suite passes
424 tests with 25 explicit real-runtime skips; formatting, zero-warning lint,
both TypeScript checks and both production builds pass.

The live scenario accepted the following three turns in one Luca conversation:

1. `Luca mobilisiert, etwa 200 ml getrunken. Gewicht später.`
2. `Korrektur: eher 150 ml. Nora informieren, nicht den Arzt.`
3. `Nur Dokumentation und Nachricht, noch nichts abschliessen.`

The same pending proposal was revised. The final review contained one note and
one message to Nora Frei, retained approximation around 150 ml, left weight
deferred, contained no physician action and contained no task/completion. One
command ID was executed and replayed; the second response returned the same
receipt and did not duplicate provider or Medplum records.

The current correction also stores three immutable SHA-256-bound input records
for that three-turn review. The merged 150 ml note references both the original
report and correction instead of falsely claiming the correction sentence was
the whole note. A direct source-record validator passes before authority is
issued. Unrecognized natural corrections now ask one concise clarification
instead of silently presenting stale meaning as corrected.

Switching to another patient now suspends an unapproved review instead of
deleting it. Returning to the same patient and encounter revalidates the same
durable proposal revision and issues a fresh one-use token; the old token stays
invalid. This was proved in both the memory profile and PostgreSQL.

Each browser document now generates an independent UUID. Selection, history,
pending review, ASR authority, query, stream, execution and clear operations all
resolve that binding server-side. A patient switch invalidates the old authority
in that tab, while a second authorized tab retains its own patient/encounter
thread and can still execute its own reviewed intent.

Voice review stores two explicit records: the immutable ASR transcript with
hash, capture time, model/mode/language/confidence and `audioRetained:false`, and
the separately hashed human-reviewed transcript with a correction flag. Edited
text remains voice input; critical-entity offsets are recalculated against the
reviewed text. Stale original offsets fail without consuming the receipt, while
the corrected offsets can be retried. Lineage is retained in the proposal,
accepted note, conversation and Medplum `DocumentReference` attachment; audio
bytes are never persisted.

The bounded agent no longer forces German content words to occur in source or
card JSON, and server code does not trust model-selected terminal labels as a
semantic safety boundary. The model may select exact run-local references,
scalar claims and an optional bounded presentation. Server code renders
source-free acknowledgement/clarification text and every displayed clinical
fact atom. Task subject/title/state and observation
label/value/secondary-value/unit/occurrence-time/independent-acceptance status
are indivisible; model prose cannot swap them or relabel historical retrieval
as current. Team-message atoms retain their patient subject. The model sees
only opaque run-local result handles, bounded facts and freshness. Durable
resource IDs, versions, hashes and row provenance remain server-side. Each
archived source retains exact claims, source version, retrieval time,
completeness, stable row resource/version/provider provenance, a digest of the
complete immutable run result and a second digest over the persisted archive,
whether or not a card was rendered. Model-selected tables use
fixed per-tool server recipes over fully claimed rows; charts additionally
require an exact time/value recipe and one homogeneous label/unit series.
Formal held-out clinical-language/model-swap
evaluation remains open. No-model operation is labelled degraded and offers
verbatim review.

At `35ba60e`, the bounded loop uses one general non-executable
`prepare_clinical_draft` tool rather than the old empty-input
`prepare_care_update` wrapper. The model submits a complete typed proposal in
the same agent turn; there is no nested extraction call and no last-tool intent
selection. The server captures actor, patient, encounter and current input,
rebinds exact spans to immutable source records, derives recipient/deadline
authority and independently validates every executable action. Only the exact
opaque draft reference returned by that tool can become a review.

Successful tool results are retained as immutable evidence records even when
no card is rendered. Natural text is the default. A model may optionally select
an `EvidenceTable` or `EvidenceChart` from the exact registered presentation
catalog, but the server hydrates it only from one cited result; invented
references are rejected. Generated prose is checked against those evidence
records rather than whatever cards happen to be on screen. A restored,
reissued or executed proposal is revalidated from its source hashes, and
treatment/medication text cannot be introduced by altering a durable generic
note. Fixture evidence is orchestration and trust-boundary evidence only; the
real-model gate below remains unpassed.

Clinical projection leasing is now strictly ordered across unresolved
whole-state checkpoints, preventing an older retry from overwriting a newer
checkpoint. Provider acknowledgement is accepted as delivered only after exact
mapped read-back and matching provider version; the receipt retains the
provider, adapter and mapping versions plus read-back hash. This is simulator
and generic-kernel evidence, not a real WiCare/careCoach/SAP acceptance claim.

If a provider acknowledges a write but the verification read fails, the
acknowledgement is persisted as pending verification before retry. A technical
transport failure is classified as retryable, while a delivered PostgreSQL row
is rejected unless complete read-back evidence and matching versions exist.
Assistant execution idempotency is bound to the concrete one-use intent token
and canonical body while the legacy hash remains valid for older non-assistant
command receipts.

A projection that reaches manual hold no longer requires an unsafe database
edit. IT can inspect the current queue head and requeue only that exact job plus
its unchanged error code. The command is idempotent, permission-checked and
audited; it cannot skip an earlier job or claim delivery.

A live Medplum optimistic-concurrency test created a synthetic resource,
captured its version, wrote a newer version and proved that the stale accepted
version was rejected while the newer record remained intact. The projection
worker also treats a matching remote read-back after a lost response as
delivered, while a changed non-matching version is quarantined without retry.
After the exact Luca write, an API process restart restored the same note and
communication counts and the same delivered queue states from PostgreSQL plus
Medplum. The fake provider was separately restarted and read back from its
persisted state.

The live idempotency probe executed the same URL, body and command ID twice.
Both responses were byte-identical; accepted-command and projection counts
increased once, not twice.

The interruption acceptance now also installs a transaction-scoped test
trigger that fails the client-context rebind only after PostgreSQL can see the
old episode paused with its original draft and the spontaneous episode active.
The failed command leaves the original episode/segment/session/tab/thread,
proposal, one-use authority, receipt, accepted command, audit/event and both
delivery queues unchanged. After removing the trigger, the same token, command
ID and body succeeds; a simulated lost-response retry returns the same receipt
without a second episode or queue job. Omitted pause text preserves, rather
than clears, an existing draft in both operational-store implementations.

## Actual AI/audio acceptance

The configured synthetic hosted profile re-attempted its model contract on
2026-09-14 after `977e3ae`. The non-writing route took 4515 ms and returned
`ready:false`, `model:deterministic-clinical-planner-v1` with the message that
the configured model failed and deterministic fallback remained active. An
earlier same-day model and generated German synthetic WAV attempt reached the
external service and received HTTP 429. This is connectivity/error-handling
evidence only:

- model acceptance: **not passed**;
- ASR acceptance: **not passed**;
- TTS acceptance: **attempted; HTTP 503 / not passed**.

The local endpoint was also tested on 2026-09-14. Ollama 0.12.3 listed the
pinned `qwen2.5:0.5b` digest and generated an ordinary text response through
its native and OpenAI-compatible endpoints. The original full JSON-Schema
request closed the local connection; the documented JSON-mode compatibility
path reached the model, but the model echoed the request object rather than a
valid terminal decision and strict server validation rejected it. The larger
installed `llama3:latest` model likewise did not produce an accepted
Pflegehelfer contract. This proves local transport only, not model competence:

- local LLM connectivity: **passed**;
- local Pflegehelfer agent/schema acceptance: **not passed**;
- full held-out multi-turn natural-coworker acceptance: **not passed**.

## Browser acceptance evidence

The integrated PWA (not the memory profile) was inspected at 390×844,
768×1024 and 1280×800 in light and dark themes. The handover shows a compact
roster with exactly one selected-patient expansion, human-facing recipient and
encounter labels, reachable review actions and no horizontal overflow. At
390×844 the fixed composer measured 73.5 px high with its lower edge at 801 px;
at 768×1024 its lower edge was 994 px. Every visible interactive control
measured at least 44 px high. A 150% root-font-size plus reduced 560-px
keyboard viewport regression is part of the Playwright suite.

The full memory-profile Playwright regression was repeated on the current
acceptance-recovery worktree and passes 66 tests with 19 deliberate project
skips across all five configured viewports. It also rejected duplicate
responsive sync-label text; the final pill now has one visible compact status
and one full accessible delivery description. Earlier testing exposed a fast
patient-transition busy-state race:
selection updated React state before the transition conversation read
completed, so the refresh generation invalidated its own cleanup. Selection
is now committed only after transition reads finish. The six directly affected
mobile journeys pass, and an independent integrated 390 px run switches to
Luca, closes the drawer and leaves the composer enabled with zero console
errors. The memory E2E result is not a substitute for integrated evidence.

The 390 px integrated browser measurement after the handover adjustment placed
the first enabled `Gelesen & übernehmen` control at y=445.5–489.5 and the
composer at y=728–801 in an 844 px visual viewport. The control is therefore
fully reachable before the expanded detail and is not hidden by the composer.

Visual evidence:

- `.gstack/qa-reports/screenshots/natural-coworker-mobile-390-light.png`
- `.gstack/qa-reports/screenshots/natural-coworker-mobile-360-light.png`
- `.gstack/qa-reports/screenshots/natural-coworker-tablet-768-light.png`
- `.gstack/qa-reports/screenshots/natural-coworker-desktop-1280-dark.png`
- `.gstack/qa-reports/screenshots/natural-coworker-mobile-390-keyboard-large-text.png`
- `.gstack/qa-reports/screenshots/natural-coworker-integrated-patient-switch-390.png`

Fixture endpoints prove schema/orchestration behavior only. Browser speech is
not counted as governed TTS acceptance. Keys remain only in the ignored,
mode-0600 local environment file and are never printed or committed. Hosted
model/audio calls use synthetic data, `store:false` where supported, bounded
inputs and separate process-local hourly ceilings. A public tunnel must also
use access control.

Required operator action for connected-AI closure: provision an API project
with available credit and approved synthetic testing, or start an accepted
local OpenAI-compatible model/ASR/TTS runtime with pinned artifact digests.
Then rerun the non-writing acceptance routes and the exact three-turn corpus.

## Conversation replacement release baseline — 2026-09-14

The staged replacement preserves the existing backend authorities and replaces
the bespoke conversation surface with OpenUI `AgentInterface`, an allowlisted
clinical renderer, one custom composer and Vercel AI SDK v6 `UIMessage` SSE.
History is loaded from the authorized server thread; the request route ignores
client-supplied assistant/tool history, persists the turn before the first
renderable byte and archives stale draft actions. Voice capture is bound to the
active patient/encounter/thread, has a size/time ceiling, aborts on context
change and requires transcript-wide human confirmation after every edit.

The same increment adds `GET /api/v1/build-info`. The compiled API records its
build identity in `dist/api-build-info.json`; Vite embeds the PWA identity and
emits `dist/pwa/build-info.json`. The endpoint returns only those safe
identifiers and their match state. Operator-only `GET /api/v1/diagnostics`
continues to report PostgreSQL, Medplum, delivery worker/providers, model, ASR
and TTS independently, now with the same build block. A final clean build after
commit must show matching, non-dirty identities for the exact remote SHA.

Verification on the pre-publication worktree:

- both TypeScript checks and the targeted diagnostics API suite pass;
- the complete unit/integration suite passed 426 enabled tests with
  25 declared environment/runtime skips;
- the complete Playwright matrix passed 67 cases with 23 deliberate
  viewport/feature skips across five projects, including the guarded voice
  flow on desktop;
- production build, security, operations, staged diff check and maintained
  staged-secret scanning passed; the measured main bundle was 2,365.62 kB
  minified / 688.25 kB gzip and remains G7 optimization work;
- full Git-history scanning reports only the exact allowlisted synthetic canary
  introduced at `930c3565` to test audit-log redaction. The allowlist binds its
  commit, path, rule and line; repository history contains no `.env` or
  `.env.demo` revision;
- the operational PostgreSQL credential was rotated locally and verified by a
  successful new connection plus rejection of the former credential, without
  logging or committing either value;
- OpenAI key revocation/rotation and account usage review remain **unpassed**
  pending authenticated platform access. No connected-AI claim depends on or
  reuses the reported exposed credential.

The exact committed and remote SHA, clean artifact identities and final command
results belong in the release handoff. This evidence does not advance the
remaining PARTIAL G gates or any institutional/vendor approval.

## Resume commands

```sh
open -a Docker
docker compose --env-file .env.demo up -d pflegehelfer-postgres medplum-postgres medplum-redis medplum-server medplum-app
pnpm dev:provider-simulator
pnpm dev:api
pnpm dev:pwa
```

Use `pnpm verify`, `pnpm verify:security`, `pnpm verify:ops`,
`pnpm verify:airgap` and `pnpm verify:e2e` for the repository audit. Do not
mark integrated acceptance passed if `integrated-demo` cannot start all three
stores or if any environment-gated suite is skipped.

Real-store suites reset the same demo institution and must be run one file at a
time. Running them in parallel causes cross-test deletion/lease races and is
not valid acceptance evidence. On 2026-09-14 the atomic acceptance test (1),
operational store (14), provider worker (3), natural continuity (3), projection
ordering (1), synchronization summary (1) and Medplum concurrency (1) all
passed sequentially against the live stores.

## Conversational acceptance closure — 2026-09-15

Implementation SHA:
`690901a8ab0509c1b55e2d23f9607a1c30ac4a2e`.

This increment keeps the published OpenUI frontend and closes three narrower
acceptance gaps. Model-authored dialogue is now separate from exact
server-rendered clinical facts; contradictory or unsupported clinical wording
is withheld without replacing faithful explanation or specific clarification.
The AI SDK route emits real inference/tool/validation/persistence progress
steps while final review authority stays unavailable until durable authority
and conversation persistence succeed. Historical draft rendering now consumes
explicit proposal revision/status returned by the operational store, and the
client reloads that authority after a streamed turn instead of detecting a
`DraftActionCard` substring.

Verified evidence:

- `pnpm verify`: formatting, zero-warning lint, both TypeScript configurations,
  427 enabled tests with 25 declared environment skips, and production PWA/API
  builds passed.
- Sequential PostgreSQL suites: 7 files / 24 tests passed against PostgreSQL 16. The atomic acceptance test now asserts persisted proposal revision 1 and
  `consumed` status in restored conversation history.
- Real Medplum 5.1.37 stale-version transaction: 1/1 passed with
  `PFH_STORAGE_MODE=medplum`; a run lacking that setting instantiated memory
  storage and is not counted.
- Independent stateful provider simulator authentication/read-back/restart:
  1/1 passed. Relational provider worker delivery/read-back/recovery remained
  included in the 24 PostgreSQL tests.
- Integrated 390 px browser journey passed three conversational revisions,
  one latest approval before reload, approval on the same page, and no approval
  control after a second reload.
- The memory-profile browser matrix reached 66 passes and 23 declared skips,
  then found one restored named-recipient label regression. The repaired exact
  recipient case and the final approval/reload case both passed on focused
  desktop rerun. This is kept separate from integrated-store evidence and is
  not described as one clean post-fix matrix run.
- `verify:security`, `verify:ops` and `verify:airgap` passed. The source scan
  found no embedded secrets.

Runtime used for these journeys: `deterministic-clinical-router-v1`, OpenUI
`0.9.13`, Vercel AI SDK `6.0.282`, PostgreSQL 16, Medplum 5.1.37 and the
stateful synthetic provider simulator. The public demo process deliberately
sets `OPENAI_API_KEY` empty and uses deterministic mode. The ignored local env
still contains the reported prior key; it was not printed or used. The user
will install the replacement key manually through authorized account/secret
access. Until a new key passes the full non-writing model journey without
fallback, connected-model acceptance remains **unpassed**.

Publication evidence: remote branch and PR head matched
`684e44f4b969e339e58bf6fc9fba8b5114c0c638`; the rebuilt live API and PWA
reported the same clean source SHA and build ID `pfh-684e44f4b969`. GitHub CI
run `34929873156` then passed `verify`, security, the complete post-fix E2E
matrix and operations from a clean checkout in 4m39s. A later evidence-only
documentation commit does not change implementation SHA `690901a8`.

## September completion-contract and visual recheck — 2026-09-19

Implementation SHA:
`2d99c8789e575131cb251eefa39d150b2d5020ec`.

This increment adopts the supplied September completion contract and exact
light/dark visual-direction files while preserving the existing OpenUI
replacement and server authority. Reference SHA-256 values are:

- light: `464b5d80eb827c8fb7b9a03d1ba1a85abd5e7b3d84165070f9bfaef0ab90d4b1`;
- dark: `bca1c876b1b0741feef534dc48339963173df043d8213ea8aa16f95f02ae33a1`.

The reference is not a clinical fixture. The implementation uses its hierarchy,
compact scope treatment, conversation rhythm and restrained light/dark mood but
does not copy unsupported “Stabil”, “keine dringenden Massnahmen”, wound,
measurement or patient assertions. The live header now shows conversation
scope, actor identity and synchronization state; composer actions use maintained
SVG symbols; handover readability and opening copy are improved; and OpenUI's
hard-coded light scroll fades are theme-safe. Mobile offline state remains
literal and visible while submission is disabled.

### Lifecycle race found and closed

The first real-store browser run found a mixed-read race after successful
approval. PostgreSQL had atomically committed the command and reported proposal
revision 1 as `consumed`, but the client could combine a conversation response
captured just before that commit (`pending`) with an authority response captured
just after it (none). The safe archived warning appeared even though execution
had succeeded.

The conversation adapter now detects that disagreement and re-reads explicit
proposal lifecycle once. A consumed revision renders the completed state; a
still-pending revision without authority remains archived and no approval is
reconstructed. `tests/openui-client-lifecycle-race.regression-1.test.ts`
recreates this exact interleaving. No rendered-string detection or authority
widening was introduced.

### Current verification

- `pnpm verify`: formatting, zero-warning lint, both TypeScript configurations,
  428 enabled tests with 25 declared environment skips and both production
  builds passed.
- Memory-profile Playwright: 67 passed, 23 deliberate skips and zero failures
  across 360, 390, 768, 1024 and 1440 px. An earlier run exposed the hidden
  mobile offline label (65 passed / 23 skipped / 2 failed); the focused repair
  passed 2/2 before the final clean matrix.
- Sequential PostgreSQL: 7 files / 24 tests passed against the live PostgreSQL
  16 container.
- Medplum 5.1.37: seed/transaction atomicity succeeded and the explicitly
  enabled stale-version integration passed 1/1.
- Independent stateful provider simulator: authentication/read-back/restart
  passed 1/1. Provider lease/read-back/recovery coverage remains included in
  the 24 PostgreSQL tests.
- Integrated deterministic browser: source-linked refresh passed; one bedside
  sentence produced four review items and executed successfully; the three-turn
  Luca correction left two superseded drafts, one current approval, rendered
  `Ausgeführt` on the same page and still rendered it after reload with no older
  approval control.
- `verify:security`, `verify:ops` and `verify:airgap` passed. The operations
  probe verified the synthetic backup/restore checksum.
- Final measured main OpenUI bundle: 2,368.70 kB minified / 689.04 kB gzip. It
  remains explicit G7 optimization work.

The Playwright assertion wait is now 15 seconds while the total test remains 60
seconds. This accommodates cold PostgreSQL/Medplum reset and verified projection
latency; it does not relax clinical validation, authorization or stale-version
checks.

### Model and credential result

The integrated process reported the configured hosted fast model as
`gpt-5.6-terra`. The required real non-writing synthetic contract call was made
and returned `ready:false` after 2,908 ms with
`deterministic-clinical-planner-v1` as fallback. That is a failed model call,
not acceptance. ASR remained configured but unaccepted, and browser TTS remains
synthetic-demo only. No credential value was read, printed or committed.

Authorized account/key remediation and a successful actual-model journey still
remain open. Until ordinary dialogue, an authorized read, a specific
clarification, a faithful draft, correction and approval all pass without
fallback, connected AI stays **NOT READY**.

### Runtime and remaining release state

Verified runtime: Node 24.19.0, OpenUI 0.9.13, Vercel AI SDK 6.0.282,
PostgreSQL 16, Medplum 5.1.37, Redis, the independent stateful provider
simulator and `deterministic-clinical-planner-v1` for accepted journeys. The
hosted `gpt-5.6-terra` attempt failed separately as described above.

G0 remains PASS. G1–G7 remain PARTIAL for the exact closure items in
`COMPLETION_MATRIX.md`; connected AI/audio, the full synthetic product,
institutional read-only pilot and controlled real-write pilot remain NOT READY.
This is a completed internal conversation-layer increment, not a clinical
deployment or vendor acceptance claim.

Publication evidence: PR #1 branch `codex/genui-production-showcase` reached
remote head `86d4b99448a4517e38e36c375377bde7e6250e49`. The clean rebuilt PWA and API
both reported `pfh-86d4b99448a4`, `dirty:false`. GitHub Actions run
`35442169455` passed install, `verify`, security, the complete memory browser
matrix and operations in 4m09s. This publication evidence does not change the
implementation SHA above or advance any PARTIAL/NOT READY gate.

## Same-runtime model diagnostics and conversation repair — 2026-09-20

Implementation SHA:
`43edbdbcf55e920c947cf133f8cead3e207cb9f5`.

The model acceptance probe previously called the legacy clinical-plan path,
which could replace a provider failure with a deterministic plan and discarded
the actionable provider cause. The normal interactive path also replaced safe
patient-workspace dialogue and useful explanatory clarification with fixed
phrases, while checking factual prose as one combined paragraph.

The repair makes the probe use the same `agentAdapter`, bounded agent runtime,
instruction assembly and authorized tool registry as interactive chat. It runs
one nonclinical no-tool turn and one isolated authorized read, never invokes a
write and never counts fallback. A successful result is `smoke-tested`; the
separate full application scenario remains unpassed. Provider failure now
retains safe stage/model/adapter/API/schema, status, allowlisted provider code,
type and parameter, request ID, retry/finish/schema-path, elapsed/usage and
digest fields while excluding prompt/response bodies and credentials.

Conversation verification now preserves harmless source-free patient-context
dialogue and a specific multiline clarification with a short explanation. For
factual prose it validates each clause against one exact referenced rendered
row/atom, removes unsupported factual clauses and leaves exact clinical facts
to deterministic rendering. Unauthorized tools, unsupported clinical claims,
unapproved writes and stable server authority remain prohibited.

Current evidence:

- targeted conversational/model regressions: 3 files / 43 tests passed;
- `pnpm verify`: formatting, zero-warning lint, both TypeScript targets,
  431 tests passed with 25 declared environment skips and both production
  builds passed;
- memory-profile Playwright: 67 passed and 23 deliberate skips across the five
  configured viewport projects; this remains separate from integrated-store
  evidence;
- PostgreSQL 16: 7 files / 24 tests passed sequentially with the live API
  worker stopped and a 30-second integration test budget. A run made while the
  API worker competed for the same destructive fixture queue is excluded;
- Medplum 5.1.37 optimistic stale-version rejection/read-back: 1/1 passed;
- independent authenticated provider simulator restart/read-back: 1/1 passed;
- integrated 390×844 browser smoke reached the scoped Anna thread, reloaded
  server-owned history and produced no console errors. The typed request
  accurately reported unavailable model service rather than pretending a model
  answer;
- `verify:security`, `verify:ops` and `verify:airgap` passed. The source scanner
  contains no embedded credential; the operations check verified its synthetic
  backup/restore checksum;
- Node 24.19.0, pnpm 11.19.0, OpenUI React UI 0.13.10, AI SDK 6.0.282,
  PostgreSQL 16, Medplum 5.1.37 and the stateful external simulator were used.

No hosted model call was made. The ignored `.env.demo` file predates the
reported exposed credential and was not read, printed or invoked. Connected
model, ASR and full application acceptance therefore remain **NOT READY**.
Owner/action: the authorized account owner installs a newly issued key through
the approved secret mechanism, or configures an approved local runtime; then IT
or Quality runs the progressive same-runtime smoke and the isolated real-store
application journey. A `/models` success, fallback or fixture output is not
acceptance.

G0 remains PASS and G1–G7 remain PARTIAL for the internal closure items in
`COMPLETION_MATRIX.md`. This increment closes acceptance-path parity and safe
diagnostics; it does not relabel shared collaboration/library, resource-native
recovery, inbound conflicts, two-shift workday, identity/RLS, governed site
publication, analytics, multi-instance restore, performance or external vendor
authorization as complete.

Publication evidence: implementation `43edbdbcf55e920c947cf133f8cead3e207cb9f5`
and its evidence update reached PR #1 head
`40f62f22170a19b601acc0a9e9f0e526d8721998`. Clean PWA and API artifacts both
reported build ID `pfh-40f62f22170a`, `dirty:false`. GitHub Actions run
`35490168863` passed install, `verify`, security, the complete memory browser
matrix and operations from a clean checkout in 3m17s. This later publication
evidence does not change the implementation SHA or advance a PARTIAL gate.

## Outcome-closure merge, task claim binding and value-report boundary — 2026-09-21

Implementation SHA: `cecb38ac549a04a1de50c5836bde788348d348d5`.

Reviewed starting head: `4595e7c33635f51aac2781d284e065a43b9831ee` on
`codex/genui-production-showcase`, draft PR #1. GitHub Actions run
`35490423770` was successful at that head. The supplied outcome closure was
merged into `PFLEGEHELFER_COMPLETION.md`; it was not added as a competing
master contract. G0–G7, inherited MD/AG/CT/WF/TX/AI/VA/UI and C1–C16 remain
binding, and all earlier evidence above remains dated historical evidence.

The supplied isolated task-claim cases were reproduced against the production
source-claim verifier. The production `AssistantService` caller was also
exercised with two same-patient task rows carrying different states. The repair
uses row-bound task/concept labels plus exact selected evidence rather than a
new patient/task phrase whitelist. A state can no longer be borrowed from
another matched task row. Local grammatical negation prevents the same
completion term from producing both open and completed tokens. If any factual
clause conflicts with its bound row, the whole model-authored factual dialogue
is withheld and exact server-rendered facts remain; clauses are not silently
spliced into changed meaning. Model tools, write authorization, proposal review
and one-use command authority were not widened or removed.

The same increment adds a bounded organizational-value report calculator and
an `analytics:aggregate`-authorized, active-institution/department API route.
Its versioned definition records the real comparison alternatives declared by
the evaluator. Observed, customer-reported, estimated and synthetic evidence
are aggregated separately. Human effort includes capture, review, correction,
failed attempts and downstream reconciliation. Identical retried observations
deduplicate; changed retry content fails. Unknown baseline stays not measured,
negative released time can recommend `do-not-roll-out`, and modeled opportunity
value is explicitly not cash saving. No patient content, private-chat mining,
presence/care-timer scoring, tariff or billing inference is part of the input.

Verification on the implementation worktree immediately before commit:

- focused source-binding, caller, value-report and API suites: 4 files / 51
  tests passed;
- `pnpm verify`: repository formatting, zero-warning lint, both TypeScript
  configurations, 440 enabled tests with 25 declared skips, and PWA/API
  production builds passed;
- measured PWA main chunk remained 2,368.71 kB minified / 689.05 kB gzip, so
  the existing G7 performance item remains open;
- `verify:security`, `verify:ops` and `verify:airgap` passed; the operations
  check verified only its labelled synthetic backup checksum;
- no hosted/local model, ASR/TTS, destructive shared fixture, integrated
  PostgreSQL/Medplum/provider journey or browser matrix was invoked in this
  slice. Existing connected-model and G1–G7 closure claims therefore remain
  PARTIAL/NOT READY exactly as recorded in the matrix.

The report boundary is not yet durable analytics completion. It still needs
ward-loop event projections, export and authorized UI, small-cell handling in
the persisted query layer, and the governed improvement publish/pilot/rollback
cycle. Actual institution comparator observations and customer benefit remain
external evidence and were not invented.

### Exact resume point after this increment

The next dependency-ordered internal slice is G2 append-only post-cutoff
handover addenda, followed by the event projection that can feed the value
report without duplicate service evidence. Implement it across the existing
boundary rather than as a JSON field on the frozen snapshot:

1. add migration `011` for immutable, institution-scoped addenda bound to the
   exact handover, patient, encounter, source reference, author and recorded
   time; do not mutate `handover_snapshots.content`, version or content hash;
2. add memory/PostgreSQL parity in `src/infrastructure/operational-store.ts`
   and the typed command/view in `src/core/workday.ts`;
3. authorize patient/encounter and exact handover version in the existing
   `/api/v1/workday` command boundary, then show source/time/author separately
   from the frozen four-section snapshot in `WorkdayPanel`;
4. prove duplicate-source replay, altered replay rejection, stale/wrong
   handover, wrong encounter, post-acknowledgement visibility and two-shift
   receiver visibility in memory plus an isolated PostgreSQL database;
5. add the corresponding typed process event once, then project it into the
   organizational-value input without counting a note/task/message as another
   patient service.

Resume commands:

```sh
git switch codex/genui-production-showcase
git pull --ff-only origin codex/genui-production-showcase
pnpm verify
pnpm exec vitest run tests/interrupted-shift.test.ts --reporter=dot
```

Before the PostgreSQL/Medplum/provider or browser proofs, create a dedicated
test database/project/provider namespace and verify the runtime identity. Do
not reuse or reset the running demonstration stores. The existing shared-fixture
PostgreSQL suites remain sequential until that isolation work is complete.

External prerequisites remain separate: the authorized account owner supplies
a newly issued model credential or approved local runtime; institutions supply
their approved comparator observations, privacy/clinical decisions and vendor
contracts. None of those external owners blocks the addendum, projection,
shared ACL/file, OIDC/RLS, publication, retention or restore engineering.

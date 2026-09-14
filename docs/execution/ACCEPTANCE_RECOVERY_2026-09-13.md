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
could hide an earlier socket disconnect after the first pre-insert revocation.
The disconnect state is now irreversible, so a post-insert revocation always
runs. The five cancellation cases passed ten consecutive runs, followed by the
full 411-test repository verification.

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

The bounded agent now permits natural terminal prose only when tool-backed
answers cite exact result references emitted during that run. Missing or
invented references, authority claims, URLs/tokens and unsupported numbers are
withheld while server-grounded components remain usable. No-model operation is
labelled degraded and offers verbatim review. The latest pending review is
restored after refresh by a fresh short-lived token for the same proposal;
parallel tokens consume that proposal only once. The focused mobile 390 px
Playwright regression passed in 1.3 minutes.

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

## Browser acceptance evidence

The integrated PWA (not the memory profile) was inspected at 390×844,
768×1024 and 1280×800 in light and dark themes. The handover shows a compact
roster with exactly one selected-patient expansion, human-facing recipient and
encounter labels, reachable review actions and no horizontal overflow. At
390×844 the fixed composer measured 73.5 px high with its lower edge at 801 px;
at 768×1024 its lower edge was 994 px. Every visible interactive control
measured at least 44 px high. A 150% root-font-size plus reduced 560-px
keyboard viewport regression is part of the Playwright suite.

The full memory-profile Playwright regression at `977e3ae` passes 66 tests with 19
deliberate project skips. It exposed a fast patient-transition busy-state race:
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
operational store (14), provider worker (3), natural continuity (2), projection
ordering (1), synchronization summary (1) and Medplum concurrency (1) all
passed sequentially against the live stores.

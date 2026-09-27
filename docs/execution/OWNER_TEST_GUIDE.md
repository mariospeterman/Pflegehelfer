# Pflegehelfer owner test guide — editable synthetic ward day

## Public owner entry point — 27 September verified

Run the full integrated demonstration from the repository root:

```sh
pnpm demo:public
```

The command reuses healthy local services, starts anything missing and prints
the exact public URL. Keep that terminal open when it started services. In a
second terminal, copy the URL or run the safe status acceptance:

```sh
pnpm demo:public:url
pnpm demo:public:check
```

Expected result: the PWA and authenticated API are reachable; API and PWA show
the same clean source SHA; PostgreSQL and Medplum are ready; the current model
state is reported without making a new paid call; browser TTS is labelled as a
synthetic ready-for-test capability; ASR stays not accepted until the real
audio case passes; and all five provider adapters say `SIMULATED`. A generic
fallback, `/models` connectivity or the ngrok page alone is not model
acceptance.

The hostname is temporary unless `PFH_NGROK_DOMAIN` contains a hostname
assigned to this ngrok account. No key belongs in this guide or in Git. The
current account rejected the chosen `pflegehelfer-mvp.ngrok.app` hostname on
the free plan (`ERR_NGROK_313`); log in to the ngrok dashboard to assign the
account's available development domain, then add only that hostname to the
ignored `.env.demo` file. The complete runtime intentionally remains together
behind ngrok; it is not split into a Vercel frontend and a separate clinical
backend.

On 27 September the temporary public route passed the PWA, `/ready`, build,
status, PostgreSQL, Medplum and simulator checks against
`8ffba9b75e2c37091d9164b35b7f13e72ecc546e`. The no-write same-runtime model
probe remained `smoke-tested` on `gpt-5.6-terra`, with fallback disabled. This
preserves the dated evidence; run the two commands above for the current URL
and exact current build identity before every owner session.

## 27 September scenario and document increment — locally verified

Reviewed baseline: `45ad887a13d0245d137cda5fc61797daf7949738` on
`codex/genui-production-showcase`, PR #1. The preserved pre-change archives and
hash manifest are local under
`.data/exports/pre-scenario-release-20260926T195022Z/`; they contain synthetic
stores and are intentionally ignored by Git. Both PostgreSQL custom archives
pass `pg_restore -l` with PostgreSQL 16.15. That is archive-readability
evidence, not the still-open fresh-environment restore/reconciliation drill.

The current canonical scenario is
`config/demo-scenarios/kronenhof-ward-day-v1.json`: 15 fictional staff, 15
fictional patients, eight care-assistant assignments, six initial tasks, seven
observations, nine notes, one communication, two initial shared comments, two
private text attachments and one bounded project. `src/core/seed.ts` is now only
a compatibility projection of that validated pack. Owner edits persist in the
active PostgreSQL scenario run and ordinary startup does not replace them.

Use **Demo verwalten** as `u-it`, or the equivalent CLI:

```sh
PFH_BASE_URL=http://127.0.0.1:3000 pnpm pfhctl demo status
PFH_BASE_URL=http://127.0.0.1:3000 pnpm pfhctl demo export ./scenario-export.json
PFH_BASE_URL=http://127.0.0.1:3000 pnpm pfhctl demo clone "Owner working copy" frozen current
PFH_BASE_URL=http://127.0.0.1:3000 pnpm pfhctl demo apply patients ./fictional-patient.json
PFH_BASE_URL=http://127.0.0.1:3000 pnpm pfhctl demo event call-luca
```

Exports are created with mode `0600` and refuse to overwrite an existing path.
Imports and clones remain inactive. **Reset preview** is read-only and returns
a confirmation digest; integrated activation is explicitly blocked until a
stopped isolated process can restore and reconcile PostgreSQL, Medplum, files
and provider receipts together. The old broad reset is available only in the
isolated memory test profile, never against the integrated owner demo.

Library uploads now expose an inspection result. Plain UTF-8 text is read
locally. PDF/PNG/JPEG analysis truthfully says unavailable unless the isolated
pinned Docling service is configured; start that optional service with
`pnpm documents:up` and configure
`PFH_DOCUMENT_INSPECTION_BASE_URL=http://127.0.0.1:5001` before starting the
API. Extracted text is digest-bound and visibly marked untrusted/human-review
required. It is not yet automatically injected into the clinical conversation,
and successful OCR is not proof that a statement is clinically true.

Implementation `3c006f0ed3b4cc61b4878d0d70947c99456214ac` is the tested source
for this increment. On 26–27 September, `pnpm verify` passed formatting,
zero-warning lint, both TypeScript targets, 54 test files with 474 enabled tests
and 26 declared skips, plus the PWA/API production builds. The complete
five-project Playwright run passed 101 journeys with 39 deliberate capability
or viewport skips and no failures. Security and air-gap preflights passed;
operations health/readiness and an isolated synthetic backup/restore checksum
passed. The explicitly isolated PostgreSQL acceptance database passed all 24
real-store tests before it was dropped, and the Medplum stale-version check
passed 1/1 and cleaned its resource. These results do not close the remaining
two-replica, previous-release restore, OIDC/RLS or institutional gates.

The preserved integrated run is
`581433ab-51a4-4624-b794-2c186056f894`. The inactive owner copy is
`8ad792ef-5edd-4711-8bd6-cc0ed55d5d3a`. The pre-change archives are readable
and their manifest retains exact SHA-256 hashes, but the live demo was not
reset. A real private UTF-8 upload was inspected through the API as attachment
`b3969edb-a978-461a-9768-f03be31f71cd`; Library read-back showed the exact
digest-bound content and the untrusted-input warning.

The same-runtime no-write probe passed on `gpt-5.6-terra` in 6.1 seconds with
one application read, fallback `false` and no writes. The normal caller then
answered `Was ist bei Anna heute wichtig?` using one
`get_patient_summary` function call and five exact, row-provenance-bound facts.
Its two provider responses reported 2,968 uncached input + 15 output tokens,
then 1,464 uncached input + 2,188 cached input + 556 output tokens. This is
progressive real-model read acceptance, not the unpassed held-out draft,
correction, model-swap or ASR suite.

Prepared 24 September and updated/exercised 25 September 2026. This is the tested handoff for the
UI foundation at `2ad9c228a2f4479631c3a1f150db49ddbbd5a9ed` plus the audited
startup/provider/mobile fixes through
`e5eaddaec220af0de15f85cccadf452587e15a56` on
`codex/genui-production-showcase`, PR #1, and the 25 September UI/model
implementation `314e88959c088b94c81a5906ac15cecb4109e6e0`.

The coherent ward-day and populated demo-fixture increment is
`14d0374d1aa262b77cc97e3ed81d39543f68813d`. It preserves the same APIs and
authority model while changing the default AGS early shift to eight fictional
patients. The current coworker correction keeps three explicit views over that
same authority. From the empty general conversation, click **Schichtübergabe
öffnen**: this opens **Übergabe**, shows `0/8`, and creates no user chat bubble.
Open each patient, read the three handover sections, optionally use that
patient's small **Vorlesen** control, then click **Gelesen & übernehmen**.
After the eighth acknowledgement, open **Pläne** for the ordered read-only
working plan and **Aufgaben** to begin, interrupt, resume or add work. A task's
summary is shown once more before **Geprüft schreiben & abschliessen**; only
then is it accepted for the existing persistence/delivery path and later
outgoing handover. **Bibliothek**, **Projekte** and **Team & @Fragen** continue
to show the labelled synthetic checklist, the Morgenmobilisation project and
Nora's direct early-shift message after a demo reset.

The 26 September bounded model probe used the configured hosted-test key and
passed the actual same-runtime transport plus one authorized application read
in 6.1 seconds. It reported `fallbackUsed:false`, one tool call and no clinical
write. Treat this as connected read acceptance only. The complete progressive
model/write suite, ASR acceptance and institutional/vendor approval remain
open.

Use only the fictional fixtures named here. Do not enter real patient,
employee or credential data. The independent provider is a stateful simulator;
none of its results are vendor acceptance, institutional approval or customer
benefit.

## Environment card

| Item                        | Tested value                                                                                                         |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| Reviewed pre-increment head | `45ad887a13d0245d137cda5fc61797daf7949738`                                                                           |
| Implementation source       | Editable scenario/document/model increment `3c006f0ed3b4cc61b4878d0d70947c99456214ac`                                |
| Last clean API artifact     | `pfh-3c006f0ed3b4`, source `3c006f0ed3b4cc61b4878d0d70947c99456214ac`, `dirty:false`                                 |
| Last clean PWA artifact     | `pfh-3c006f0ed3b4`, same source, `dirty:false`, `matchingSource:true`                                                |
| Local URLs                  | PWA `http://127.0.0.1:5173`; API `http://127.0.0.1:3000`; clean memory artifact `http://127.0.0.1:4173`              |
| Runtime                     | `integrated-demo`, persistent PostgreSQL, Medplum FHIR R4 `5.1.37-82e609c`, independent provider simulator           |
| Primary/second/denied roles | `u-nurse` Nora Frei; `u-assistant` Lea Bernasconi; `u-hr` Lina Wenger                                                |
| Subjects                    | Anna Beispiel `p-anna`, Fall `SH-260901-001`; Luca Demo `p-luca`                                                     |
| Model                       | Hosted synthetic-only `gpt-5.6-terra`; transport and one authorized read path accepted, full suite **not accepted**  |
| ASR                         | Hosted `gpt-4o-transcribe`; configured/ready-for-test, positive acceptance **blocked**                               |
| TTS                         | Browser SpeechSynthesis demo ready-for-test; supported API journey passed, actual-device/server TTS **not accepted** |
| Provider operations         | All five adapters explicitly `SIMULATED`; no real provider write is enabled                                          |
| Visual modes                | GStack Chromium, 1440×900 desktop and emulated 390×844 mobile, light and dark                                        |

The bounded no-write model probe previously reached the provider and genuinely
failed HTTP 429 with sanitized `credit_balance_exhausted`/
`insufficient_quota`, model `gpt-5.6-terra`, fallback `false`. On 26 September,
the current configured provider passed transport and authorized-read probes;
one natural patient-context request also completed through the real caller with
one authorized tool call and exact evidence claims. `/models` connectivity and
deterministic fallback still do not count as acceptance, and the full held-out
application suite remains open.

## Owner walkthrough

### 1. Shell, subject and own profile — PASS

1. Open the PWA. The initial subject is **Mein Assistent**.
2. Click the centered **Mein Assistent** subject control. Search `Anna`, then click
   **Anna Beispiel**.
3. Confirm the centered header says `Anna Beispiel`, `214A · Privat` and the
   compact patient bar shows birth date, Fall `SH-260901-001`, allergy and
   risks.
4. Click the `LB` own-profile button.

Expected durable result: subject selection calls the existing assistant-context
API and restores the authorized patient thread; it does not start work or
change the actor. The own-profile control opens Lea's authenticated staff
profile with role, organization, site, scoped wards, purpose and managed-device
state. Click it again or use **Zurück zum Gespräch** to return. It does not open
a patient profile or merely expose the menu.

Automated evidence: the mobile and desktop subject-isolation journeys and the
new own-profile journey pass. The full ward roster is absent from the private
patient conversation.

### 2. Direct patient lenses — PASS

1. With Anna selected, click her name/avatar or **Profil**.
2. Click **Verlauf**, **Werte**, **Team** and **Mehr** in turn.
3. Return to **Chat**.

Expected durable result: each lens reads the authorized snapshot or workspace
API directly. No artificial user message, model request, work start or approval
is created. The profile uses Fall/MRN `SH-260901-001`, never internal encounter
ID `enc-anna-2026`. **Mehr** exposes only role-authorized provider/clinical
detail information.

Automated evidence: direct-lens/no-model and MRN association regressions pass.

### 3. Source-bound conversation — progressive connected-read PASS; full model suite PARTIAL

1. In Anna's **Chat**, ask `Zeige mir bitte Annas Patientenübersicht.`
2. Inspect the patient summary and source labels.
3. For connected-model acceptance, ask `Was ist für Anna noch offen?`, then
   `Zeig mir dieselben Aufgaben als Tabelle. Danach erkläre es kurz.`

Observed on 26 September: the configured model completed a natural Anna-context
request through the actual caller, selected one authorized
`get_patient_summary` native function and returned five exact row-provenance-
bound facts with fallback `false`. The earlier 429 remains retained failure evidence,
not the current provider state. The UI must still show component failures
without relabelling API or records offline. Do not accept a generic fallback as
T04 success. Clarification, faithful draft/correction, model swap and all agreed
held-out cases remain open.

### 4. Reviewed patient profile update — integrated browser/PostgreSQL PASS

1. As `u-nurse`, open Anna → **Profil**.
2. Enter a fictional care preference and click **Änderung prüfen**.
3. Verify current value, proposed value and source, then click
   **Geprüft übernehmen** once.
4. Reload **Profil**.

Expected durable result: prepare stores a pending proposal only. Accept checks
role, current patient visibility and expected version atomically; reload shows
version 1. A stale version returns conflict, and a care assistant receives 403.
Current visibility is rechecked before an idempotent replay.

Evidence: API denial/prepare/accept tests pass. Isolated PostgreSQL database
`pflegehelfer_codex_workspace_20260924_1140` passed denied-scope, accept,
restart and read-back, then was dropped. The actual integrated browser then
prepared, reviewed, accepted and re-read the fictional preference `Morgens
zuerst informieren.` for Anna in the preserved demo store.

### 5. Shared comments, `@` and `#` — one-way two-user browser PASS

1. Open Anna → **Team**.
2. Choose the governed `#Mobilität` filter and select `@Lea Bernasconi` from the
   authorized picker.
3. Enter `Bitte in der nächsten Schicht eine Rückmeldung zur geplanten
Mobilisation ergänzen.` and click **Teilen**.
4. In the demo-only account menu, switch to Lea and reopen Anna → **Team**.

Expected durable result: one attributed patient-team comment retains the
selected person/topic and is visible only to authorized team members. A role
mention remains a role queue. It does not mark mobilization performed or widen
patient access. General **Team & @Fragen** instead creates an explicit direct
message after a staff profile and recipient are selected.

Evidence: scoped create/list/replay, unauthorized HR denial, team-member
filtering and PostgreSQL restart/read-back pass. Nora shared the fictional
comment from the integrated browser; Lea then reopened Anna and saw the exact
persisted `@Lea Bernasconi #Mobilität` entry. Reply/read-receipt/revocation and
concurrent conflict acceptance remain unpassed.

### 6. Attachment and Library — private browser upload PASS; patient-message path pending

1. In Anna's chat, click **Datei anhängen**; select a benign fictional PDF,
   PNG/JPEG or text file no larger than 8 MiB.
2. Check the pending chip; remove it once, select again, then send.
3. Open menu → **Bibliothek** and click **Öffnen** on the stored item.

Expected durable result: the browser computes SHA-256 and uploads to the
subject-bound private workspace before message submission. The server checks
declared media type, content signature, digest, actor and patient visibility;
content is returned authenticated with `no-store`/`nosniff`, never as a public
URL. Failed upload keeps recoverable text.

Evidence: digest/signature/other-actor denial and byte-for-byte PostgreSQL
restart/read-back pass. The actual browser file picker uploaded
`synthetic-library-note.txt` to Lea's private Library and the durable item was
listed after navigation. Attaching and sending a patient-bound file, then
opening its authenticated bytes in a second browser, remains unpassed.

### 7. Projects reuse existing work — integrated browser/member read-back PASS

1. Return to **Mein Assistent**, open menu → **Projekte**.
2. Create `Synthetische Mobilitätskoordination`, purpose `Vorhandene Arbeit
gemeinsam verfolgen`, member Nora.
3. Select Anna's existing blood-pressure task and click **Aufgabe verknüpfen**.
4. Reload and switch to Nora.

Expected durable result: one versioned project is visible to both members and
links the existing task ID; no copied task or second completion lifecycle is
created. Linked objects remain filtered by each viewer's underlying access.

Evidence: create, optimistic link and member read-back tests pass. Nora created
`Synthetische Mobilitätskoordination`, added Lea, and linked the existing Anna
task through the integrated browser. After switching accounts and recovering
the browser session, Lea saw the same versioned project and link. Concurrent
member conflict acceptance remains pending.

### 8. Übergabe, Arbeitsplan, Aufgaben, dictation and read-aloud — mixed result

1. In **Mein Assistent**, click **Schichtübergabe öffnen** or open menu →
   **Übergabe**. Confirm the ward handover appears here, not beneath Anna's
   private conversation.
2. Expand Anna and confirm **Wichtig zu wissen**, **Was in der letzten Schicht
   passiert ist** and **Wichtige nächste Schritte**. Click Anna's small
   **Vorlesen** control below those sections, stop it, then acknowledge Anna.
3. Open **Pläne**. Confirm the ordered plan shows patient, activity, time,
   reason/source, dependencies and state without work-execution controls.
4. After all eight handover acknowledgements, open **Aufgaben**. Begin one
   milestone, enter only work actually performed, interrupt it, add a
   spontaneous item, complete that item, resume the first item and inspect the
   explicit summary review before writing. Resolve or transfer all remaining
   responsibilities before preparing the next-shift handover.
5. In chat, use **Sprachnachricht aufnehmen**, stop, inspect
   **Sprachtranskript prüfen**, submit, check the explicit transcript/context
   box, then edit the transcript.
6. On a completed assistant message, click **Nachricht vorlesen**, then
   **Vorlesen stoppen**.

Expected durable result: acknowledgement, episodes, interruption drafts,
completion evidence and responsibility transfers remain in the PostgreSQL
workday authority; accepted documentation follows the existing Medplum and
provider delivery path. Browser SpeechSynthesis receives only the selected
visible frozen patient handover; listening never acknowledges it. A synthetic
MediaRecorder and accepted fixture response prove patient binding, explicit
transcript review and review invalidation after correction; this is not real
ASR acceptance. Actual device audio, server TTS and a real microphone remain
blocked/not run.

### 9. Precise status and provider view — PASS for truthful display

1. Open menu → **Betriebsstatus**.
2. Confirm separate rows for **Netz / API**, **Sitzung**, **Daten**, **KI** and
   **Zustellung**.
3. As nurse/IT/quality-safety, open **Anbieter**; then repeat as a denied role.

Expected result on this run: API authenticated; PostgreSQL ready; Medplum ready
with its own message; model configured and `smoke-tested` after the successful
current probe; ASR ready-for-test; browser TTS ready-for-test; delivery queues
shown independently. Provider cards say `SIMULATED`, show separate
state/latency/check time and no longer expose raw JSON; a denied role sees no
diagnostics.

## Actual API and persistence trace

| Interaction                 | API                                                                                                                    | Durable authority/result                                                            |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| Subject selection           | `POST /api/v1/assistant/context`                                                                                       | Existing scoped conversation/context revision                                       |
| Profile read/prepare/accept | `GET /api/v1/workspace/profile`, `POST /api/v1/workspace/profile/prepare`, `POST /api/v1/workspace/profile/:id/accept` | PostgreSQL `workspace_records`, versioned field/proposal, command receipt and audit |
| Shared/direct comment       | `GET/POST /api/v1/workspace/comments`                                                                                  | Attributed scoped comment plus per-actor read table/invalidation                    |
| Team picker                 | `GET /api/v1/workspace/team-members`                                                                                   | Current authorized patient-team projection                                          |
| Attachment                  | `POST /api/v1/workspace/attachments`, authenticated content GET                                                        | Private scoped metadata and bytes, SHA-256/content signature, command receipt       |
| Project/link                | `GET/POST /api/v1/workspace/projects`, `POST /api/v1/workspace/projects/:id/links`                                     | Versioned project that references existing task/comment/file IDs                    |
| Capability status           | `GET /api/v1/status`                                                                                                   | Independent runtime checks; no combined success placeholder                         |
| Read aloud                  | `GET /api/v1/ai/status`, then server speech or browser SpeechSynthesis                                                 | No clinical write; chosen visible message only                                      |

## Verification record

- The 27 September source gate for `3c006f0ed3b4cc61b4878d0d70947c99456214ac`
  passed 474 tests with 26 declared skips, formatting, lint, both typechecks and
  both builds. The five-project browser matrix passed 101/101 executed journeys
  with 39 deliberate skips. `verify:security`, `verify:airgap` and `verify:ops`
  passed. The measured main PWA chunk is 2,414.46 kB minified / 700.11 kB gzip
  and therefore remains an open G7 performance item.
- The 25 September `pnpm verify` rerun passed formatting, zero-warning lint,
  both TypeScript targets, 462 enabled tests with 26 declared environment skips,
  and matching PWA/API production builds. The exact clean implementation SHA
  and artifact IDs are recorded in the dated evidence update below.
- The isolated PostgreSQL workspace test passed 1/1 after restart/read-back and
  scope-revocation denial; its temporary database was dropped.
- The refreshed main PWA chunk is 2,399.64 kB minified / 696.31 kB gzip. This is
  measured and remains a G7 performance failure/open item, not a success.
- The current full Playwright matrix passed 76 journeys with 39 deliberate
  project/viewport skips across 360 px, 390 px, 768 px, 1024 px and 1440 px.
  An initial audit rerun failed because a long-lived test server retained its
  old static asset manifest across `clean-dist`; restarting that exact isolated
  server from the clean artifact restored hashed assets, 12/12 affected mobile
  journeys passed, and the complete matrix then passed.
- The 25 September five-project run exercised all 130 configured cases: 90
  passed and 39 were deliberate capability/viewport skips. Its only failure
  correctly reported unavailable TTS because the manually launched isolated
  server omitted the documented `PFH_TTS_MODE=browser-demo`; after restarting
  with that setting, the affected message playback passed 1/1. Clean remote CI
  remains the combined acceptance gate.
- GitHub Actions run `35994652724` is retained as a failed run: 68 journeys
  passed, 27 were deliberately skipped and the same shell journey failed at
  all five widths because its test helper did not await the asynchronous
  drawer close after selecting **Mein Assistent**. The helper now waits for the
  completed transition; that exact journey then passed 5/5 at 360, 390, 768,
  1024 and 1440 px. The replacement full CI run is the remote acceptance gate.
- The integrated API on port 3000 reports persistent `integrated-demo`, healthy
  PostgreSQL, Medplum 5.1.37 and available simulated providers. On 25 September
  it was intentionally reset to the current synthetic fixture revision and to
  remove failed model-attempt leftovers before the owner handoff.
- `verify:security`, `verify:ops` and `verify:airgap` passed. The operations
  probe verified health/readiness and a synthetic backup checksum; this is not
  the still-open previous-release/integrated restore acceptance.
- The release audit reproduced one hidden development-only 500 caused by
  duplicate concurrent startup context bindings. PostgreSQL recorded the
  active-session uniqueness collision. The coordinator regression passed 2/2,
  the development reload then issued exactly one context POST (HTTP 200), and
  the focused production browser file passed 3 journeys with 3 deliberate
  project skips across desktop/mobile.
- The preserved integrated demo now contains two fictional private Library
  files, one reviewed Anna profile preference, one addressed Anna team comment
  and one two-member project linked to an existing task. These are additive
  synthetic fixtures; no live-demo reset or provider fault injection was run.

## Screenshot index

These are local evidence files from the actual integrated PWA, not automatic
acceptance of the remaining gates:

The 26 September in-app inspection additionally covered the live subject
picker, full Anna and Lea profiles, `0/8` three-part handover, Library parsed
excerpt, project, patient, team and role-authorized provider views at desktop
and 390×844 dark compact width with no console errors or horizontal overflow.
The browser capture command timed out twice, so no new screenshot file is
claimed for that run; the retained dated files below remain the capture index.

The 27 September workday correction added actual integrated captures of the
single shift entry and patient-local handover at desktop and 390×844 in light
and dark modes. The dark capture deliberately remains a conversation start;
it does not claim hardware audio playback.

- `.gstack/qa-reports/screenshots/after-initial-desktop.png`
- `.gstack/qa-reports/screenshots/after-handover-desktop.png`
- `.gstack/qa-reports/screenshots/after-live-handover-mobile.png`
- `.gstack/qa-reports/screenshots/after-live-handover-expanded-mobile.png`
- `.gstack/qa-reports/screenshots/after-live-handover-mobile-dark.png`

- `.gstack/qa-reports/screenshots/ui-wiring-after-patient-desktop-2026-09-24-v4.png`
- `.gstack/qa-reports/screenshots/ui-wiring-after-patient-desktop-dark-2026-09-24.png`
- `.gstack/qa-reports/screenshots/ui-wiring-after-patient-mobile-light-2026-09-24-v2.png`
- `.gstack/qa-reports/screenshots/ui-wiring-after-patient-mobile-dark-2026-09-24.png`
- `.gstack/qa-reports/screenshots/ui-wiring-after-drawer-desktop-2026-09-24-v2.png`
- `.gstack/qa-reports/screenshots/ui-wiring-after-profile-desktop-2026-09-24-v3.png`
- `.gstack/qa-reports/screenshots/ui-wiring-after-profile-review-desktop-2026-09-24.png`
- `.gstack/qa-reports/screenshots/ui-wiring-after-library-desktop-2026-09-24.png`
- `.gstack/qa-reports/screenshots/ui-wiring-after-team-desktop-2026-09-24.png`
- `.gstack/qa-reports/screenshots/ui-wiring-after-source-bound-summary-desktop-dark-2026-09-24.png`
- `.gstack/qa-reports/screenshots/ui-wiring-after-status-desktop-dark-2026-09-24-v2.png`
- `.gstack/qa-reports/screenshots/release-audit-conversation-2026-09-24.png`
- `.gstack/qa-reports/screenshots/release-audit-profile-accepted-2026-09-24.png`
- `.gstack/qa-reports/screenshots/release-audit-team-recipient-2026-09-24.png`
- `.gstack/qa-reports/screenshots/release-audit-mobile-dark-patient-2026-09-24.png`
- `.gstack/qa-reports/screenshots/release-audit-mobile-provider-cards-2026-09-24.png`

## Explicitly failed, blocked or not run

- **PARTIAL:** connected natural-model read acceptance now passes, but the full
  held-out dialogue/draft/correction/model-swap suite is not accepted and no
  fallback counts.
- **BLOCKED/NOT ACCEPTED:** real ASR microphone, server TTS and actual-device
  audio playback.
- **NOT RUN:** actual phone/tablet hardware, complete five-viewport/system-theme
  matrix, patient-bound send/open file journey, live two-user reply/read/
  revocation, concurrent project/profile conflict UI, complete two-shift
  integrated ward loop.
- **OPEN INTERNAL:** department/publication flows, test-IdP OIDC/BFF and
  non-bypass RLS, previous-release migration/restore, retention/egress,
  measured value projection/improvement and final performance/code splitting.
- **EXTERNAL:** real vendor mappings/contracts, institutional security/privacy/
  clinical approval and any real-write pilot.

G0 remains PASS. G1–G7 remain PARTIAL. This guide is a resumable acceptance
record, not a declaration that the product or institutional pilot is complete.

## Reproduce without touching the live demo

```sh
git switch codex/genui-production-showcase
git show --stat 3c006f0ed3b4cc61b4878d0d70947c99456214ac
pnpm install --frozen-lockfile
pnpm verify
pnpm verify:e2e
pnpm verify:security
pnpm verify:airgap
pnpm verify:ops
PFH_TTS_MODE=browser-demo pnpm demo:test-memory
PFH_BASE_URL=http://127.0.0.1:3000 pnpm pfhctl demo status
```

For destructive/restart tests create a dedicated temporary database and
provider namespace. The integrated demonstration was intentionally reset on 25
September to remove prior failed synthetic model attempts and load the current
fictional fixture revision; do not run further reset, restore or provider fault
injection unless explicitly refreshing that demo again.

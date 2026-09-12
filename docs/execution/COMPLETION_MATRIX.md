# G0–G7 completion matrix

Updated: 2026-09-12  
Baseline: `573ff547e9f362acc79f4653240eae091921325d`

This matrix is the short evidence index for the binding completion contract in
[`PFLEGEHELFER_COMPLETION.md`](PFLEGEHELFER_COMPLETION.md). `PASS` requires code,
an acceptance test and runtime evidence. `PARTIAL` is internally achievable
work. `EXTERNAL` is evidence that this repository cannot invent.

| Gate                            | Current evidence                                                                                                                                                                                    | Status  | Required closure                                                                                                                                                                                                                                   |
| ------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| G0 — common baseline            | Canonical product/architecture/workflow documents, exact baseline SHA, Medplum 5.1.37 + PostgreSQL + PWA runtime, 298 enabled tests, 39 enabled browser journeys, 11 real-store tests               | PASS    | Keep this matrix and verified sources current at every gate.                                                                                                                                                                                       |
| G1 — reliable core              | Durable scoped sessions/episodes/proposals/authority/audit; numbered SHA-256 migration history; actor-audienced durable replay; Medplum transaction failure test                                    | PARTIAL | Atomic accepted-command transaction, relational leased provider workers/inbound mapping, resource-native reconstruction without the checkpoint Binary, captured previous-release migration fixtures.                                               |
| G2 — complete workday           | Six-person shift over 15 synthetic profiles, zero-assignment handling, encounter-bound four-part clinical snapshot/digest, interruptible episodes, exact readout, defer and receiving-shift receipt | PARTIAL | Append-only post-cutoff addenda, richer explicit conflicts/preferences and two consecutive full-shift browser proofs.                                                                                                                              |
| G3 — communication/organization | Named/role-queue Communications and site-governed topic vocabulary exist                                                                                                                            | PARTIAL | ACL-enforced patient-team/department/direct threads, publication preview, comments/addenda, durable unread/replay, real topic filters and protected document/image library.                                                                        |
| G4 — connected AI               | Strict local/hosted LLM, ASR and TTS adapters; bounded structured output; durable context-bound ASR receipt; honest configured/tested/accepted states                                               | PARTIAL | Real accepted model + microphone ASR + TTS calls, two-adapter held-out evaluation, durable multi-turn correction/pending-review recovery. Missing runtime/key is external only for the connected call, not for adapter/test tooling.               |
| G5 — site/operations            | Two validated site packs, air-gap preflight, security/ops smoke tests and production demo-header rejection exist                                                                                    | PARTIAL | Test-IdP OIDC/BFF, non-bypass RLS, multi-department/site runtime tests, two replicas/workers, retention/legal hold, real isolated restore/reconciliation and blocked-egress proof.                                                                 |
| G6 — evidence/value             | Episode segments and one non-billable service-evidence row per episode exist; provider simulators expose state/conflicts                                                                            | PARTIAL | One typed performance event feeding note/task evidence without duplication, completeness review, bounded analytics dictionary/views and governed improvement publish/pilot/rollback. No real tariff or revenue claim without an approved contract. |
| G7 — UI/total acceptance        | One responsive conversation, scoped patient lenses, offline lock, keyboard/focus and current multi-viewport Playwright matrix pass                                                                  | PARTIAL | Complete navigation functions, readout, team/topics/library/admin/sync-error/shift-close browser journeys, light/dark/system/reduced-transparency/200%-zoom/virtual-keyboard and measured performance, CI at final implementation SHA.             |

## Readiness outputs

| Output                        | Status    | Reason                                                                                                                |
| ----------------------------- | --------- | --------------------------------------------------------------------------------------------------------------------- |
| Synthetic product completion  | NOT READY | G1, G2, G3, G5, G6 and G7 still contain internal work.                                                                |
| Connected AI/voice demo       | NOT READY | No accepted real model, ASR or TTS scenario call is recorded.                                                         |
| Institutional read-only pilot | NOT READY | OIDC, RLS/isolation, provider authorization and institutional approvals are missing.                                  |
| Controlled write pilot        | NOT READY | Real provider contracts/mappings/read-back, atomic local acceptance, recovery and institutional sign-off are missing. |

Production WiCare, careCoach, SAP, device and nurse-call operations remain
`EXTERNAL_VENDOR_GATE` individually until their private contracts, credentials,
sandbox behavior, mapping and acceptance evidence exist. The generic adapter,
worker, simulator, identity and isolation work is internal and may not be moved
behind that label.

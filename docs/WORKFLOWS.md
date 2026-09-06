# Configurable workflows

`WorkflowTemplate` is stable; edits create draft `WorkflowTemplateVersion`s. Publishing is immutable and activation uses compare-and-swap. `WorkingSession` pins one published version and one `AssistantThread`; `WorkflowStepInstance` records progression/evidence.

Allowlisted step kinds are `orientation`, `context-selection`, `work-queue`, `documentation`, `review`, `handover`, `reconciliation`, and `completion`. Predicates are bounded comparisons over server state. Definitions cannot grant permission, skip policy review, contain executable code/URLs/arbitrary OpenUI, auto-select patients or enable providers.

## Nursing day (`nursing-day-v1`)

| Order | Step             | Completion                                             |
| ----- | ---------------- | ------------------------------------------------------ |
| 1     | Delta handover   | Opened and acknowledged                                |
| 2     | Prioritize       | Queue reviewed; urgent work addressed                  |
| 3     | Select patient   | Server context event recorded                          |
| 4     | Perform work     | Assigned/spontaneous/alarm work accepted or deferred   |
| 5     | Document         | Required observations/notes drafted with evidence      |
| 6     | Communicate      | Questions acknowledged/answered or escalation visible  |
| 7     | Review/sign      | Identity/diff/source checks pass                       |
| 8     | Prepare handover | Delta includes open work, changes, risks, pending sync |
| 9     | Reconcile        | Conflicts assigned; pending provider state visible     |
| 10    | Complete         | Session summary appended                               |

Steps 3–7 loop for each explicitly selected patient. A nurse-call event may insert priority work but never select the patient or mark work complete.

## Physician and other roles

`physician-rounds-v1` begins with addressed messages, abnormal source-linked observations and rounds. The physician explicitly opens a patient, reviews evidence, answers/records an allowlisted follow-up, and closes the loop. Medication/diagnosis/treatment changes remain separately governed.

Therapies get assigned intervention/evidence flows. Transport/service see only needed operational task fields. Administration/management/HR/IT receive no clinical thread payload by default. Quality uses governed projections; management analytics are aggregated/small-cell suppressed.

## Workflow Studio and validation

Authorized administrators list, clone, edit bounded fields, validate, preview with fictional data, publish, activate and inspect history. Rollback activates a published version for new sessions; active sessions stay pinned.

Tests cover immutable publishing, activation CAS, session pinning/restart, invalid transitions, concurrent step completion, revocation, alarm insertion without context switch, stale intent invalidation and completion with handover/sync state.

# Configurable workflows

`WorkflowTemplate` is stable; edits create draft `WorkflowTemplateVersion`s. Publishing is immutable and activation uses compare-and-swap. `WorkingSession` pins one published version and one `AssistantThread`; `WorkflowStepInstance` records progression/evidence.

Allowlisted step kinds are `orientation`, `context-selection`, `work-queue`, `documentation`, `review`, `handover`, `reconciliation`, and `completion`. Predicates are bounded comparisons over server state. Definitions cannot grant permission, skip policy review, contain executable code/URLs/arbitrary OpenUI, auto-select patients or enable providers.

The executable demo configuration is the strictly validated `config/sites/tertianum-kronenhof.json`; this Markdown file explains it for humans and is not parsed as executable policy. Configuration may select permissions and workflows but can never grant an action outside the allowlisted policy vocabulary.

## Nursing day (`nursing-day`, version 2)

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

The early-shift demo assigns six fictional patients to the care assistant and registered nurse. Every handover patient must be acknowledged before the plan opens. Planned episode metadata is derived server-side from the configured assignment, not trusted from the browser. Steps 3–7 loop for each explicitly selected patient. A nurse-call event may insert priority work but never mark planned responsibility complete. Exact subtask-level defer/delegate/transfer outcomes and acknowledgement by the next responsible shift are still production work.

## Site and role configuration

The site file owns institution/site/department identity, `Europe/Zurich`, session TTL, shift windows and next responsible actor, provider-route intent, role-to-workflow/action profiles, staff-to-shift/patient assignment and six demo responsibilities. Zod validation rejects missing workflow references, unknown actions, duplicate staff or patient assignments and references to unknown shifts/patients. The repository currently loads one selected site at build time; a two-house runtime selector and immutable published configuration store remain incomplete.

## Physician and other roles

`physician-rounds-v1` begins with addressed messages, abnormal source-linked observations and rounds. The physician explicitly opens a patient, reviews evidence, answers/records an allowlisted follow-up, and closes the loop. Medication/diagnosis/treatment changes remain separately governed.

Therapies get assigned intervention/evidence flows. Transport/service see only needed operational task fields. Administration/management/HR/IT receive no clinical thread payload by default. Quality uses governed projections; management analytics are aggregated/small-cell suppressed.

## Workflow Studio and validation

The target Workflow Studio lets authorized administrators list, clone, edit bounded fields, validate, preview with fictional data, publish, activate and inspect history. Rollback activates a published version for new sessions; active sessions stay pinned. The current repository validates the checked-in site/workflow configuration and pins its version into working sessions; the administrative Studio, immutable configuration store and activation-CAS API are not implemented yet.

Current tests cover configuration rejection, session reuse/restart, context revision, alarm interruption/resume, episode evidence, full six-patient completion and visible handover/provider state. Immutable publishing, activation CAS, receiver-side handover acceptance and concurrent workflow mutation remain production acceptance work.

# Configurable workflows

`WorkflowTemplate` is stable; edits create draft `WorkflowTemplateVersion`s. Publishing is immutable and activation uses compare-and-swap. `WorkingSession` pins one published version, links multiple explicitly scoped `AssistantThread`s and keeps one active-thread pointer; `WorkflowStepInstance` records progression/evidence. Changing conversation scope never starts, pauses or completes clinical work by itself.

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

The early-shift demo assigns six fictional patients to the care assistant and registered nurse while the wider synthetic clinical fixture contains at least twelve longitudinal profiles. A configured zero-patient shift is valid and produces no invented work. Every handover patient must acknowledge the immutable content digest before the plan opens. Planned episode metadata is derived server-side from the frozen configured assignment, not trusted from the browser. The optional readout uses the same text and cutoff as the visible snapshot. Steps 3–7 loop for each explicitly selected patient. A nurse-call event may insert priority work but never mark planned responsibility complete. Episode-bound draft text survives interruption, responsibility can be explicitly deferred to the configured next shift, and sender/receiver views distinguish a pending transfer from its durable acknowledgement receipt.

## Site and role configuration

The selected immutable site pack owns institution/site/department identity, timezone, session TTL, shift windows and next responsible actor, provider-route intent, role-to-workflow/action profiles, independent-review qualifications, staff-to-shift/patient assignment and demo responsibilities. `PFH_SITE_PACK_PATH` selects the pack at process start. Zod validation rejects missing workflow references, unknown actions, permission expansion beyond the centrally reviewed role ceiling, duplicate staff or patient assignments and references to unknown shifts/patients. Tests accept 2- and 12-patient assignments. The second fictional institution proves different shifts, provider routes, workflow version/language and a three-patient care-assistant assignment without TypeScript changes. A governed published-configuration store and in-product Studio remain incomplete.

## Physician and other roles

`physician-rounds-v1` begins with addressed messages, abnormal source-linked observations and rounds. The physician explicitly opens a patient, reviews evidence, answers/records an allowlisted follow-up, and closes the loop. Medication/diagnosis/treatment changes remain separately governed.

Therapies get assigned intervention/evidence flows. Transport/service see only needed operational task fields. Administration/management/HR/IT receive no clinical thread payload by default. Quality uses governed projections; management analytics are aggregated/small-cell suppressed.

## Workflow Studio and validation

The target Workflow Studio lets authorized administrators list, clone, edit bounded fields, validate, preview with fictional data, publish, activate and inspect history. Rollback activates a published version for new sessions; active sessions stay pinned. The current repository validates the checked-in site/workflow configuration and pins its version into working sessions; the administrative Studio, immutable configuration store and activation-CAS API are not implemented yet.

Current tests cover configuration rejection, session reuse/restart, context revision, alarm interruption/resume, episode drafts/evidence, full six-patient resolution, explicit defer and receiver acknowledgement, and visible provider state in memory and real PostgreSQL. Immutable publishing, activation CAS and concurrent workflow mutation remain production acceptance work.

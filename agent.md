# Pflegehelfer — Codex Master Engineering Instruction

## Mission

You are the senior engineering agent responsible for designing, implementing, testing, hardening, documenting, and validating **Pflegehelfer** as a production-grade Swiss healthcare workflow, documentation, communication, interoperability, and AI-assistance platform.

Treat this repository as a real healthcare software product intended eventually for use in Swiss geriatric rehabilitation, long-term care, hospitals, intensive-care-adjacent workflows, medical practices, pharmacies, therapy departments, transport/service teams, administration, and management.

Do not produce a prototype disguised as production software.

Your responsibility is to take the repository from its current state to the strongest complete implementation reasonably possible, following the architecture, current official documentation, secure engineering practices, healthcare interoperability standards, and the acceptance criteria defined here.

Continue planning, implementing, running the application, testing, reviewing, fixing, and re-testing until all internally achievable production gates pass.

Do not stop merely because:

* the application builds,
* the UI renders,
* unit tests pass,
* one happy-path demo works,
* a mock API responds,
* or a feature exists superficially.

A feature is complete only when its normal path, failure path, permissions, audit behavior, tests, documentation, and operational behavior are implemented.

---

# 1. Mandatory first actions

Before modifying code:

1. Read this entire `AGENTS.md`.
2. Read `docs/ARCHITECTURE.md` completely.
3. Read every existing architecture decision, README, specification, workflow, security document, issue, and implementation note in the repository.
4. Inspect the complete existing codebase, not only directory names.
5. Run the existing test/build/lint/type-check suite.
6. Inspect dependencies, configuration, migrations, Docker/Kubernetes setup, and CI.
7. Determine what is already implemented, partially implemented, missing, conflicting, obsolete, insecure, duplicated, or overengineered.
8. Verify version-sensitive architectural assumptions against current official documentation when internet access is available.
9. Write or update:

   * `docs/IMPLEMENTATION_PLAN.md`
   * `docs/IMPLEMENTATION_STATUS.md`
   * `docs/research/VERIFIED_SOURCES.md`
   * relevant ADRs under `docs/architecture-decisions/`
10. Only then begin structural implementation.

Do not ask the user to choose between minor implementation alternatives when a senior engineer can make the decision from the architecture and best practices.

Make the smallest maintainable decision that preserves future extensibility.

Record material architectural decisions in ADRs.

---

# 2. Source-of-truth hierarchy

Use this priority when information conflicts:

1. Explicit user/product requirements.
2. `docs/ARCHITECTURE.md`.
3. This `AGENTS.md`.
4. Approved repository ADRs.
5. Current official standards and vendor documentation.
6. Existing implementation.
7. Third-party tutorials, blogs, examples, and community material.

Architecture documentation is authoritative, but it is not infallible.

If current official documentation proves an architectural assumption obsolete, unsafe, impossible, or materially inferior:

* verify it using primary sources;
* document the conflict;
* create an ADR;
* adopt the safer/current approach;
* update architecture documentation;
* do not silently diverge.

---

# 3. Research rules

For changing or externally defined technologies, verify current official documentation before implementation.

Prioritize primary sources for:

* OpenUI / Thesys OpenUI
* Medplum
* HL7 FHIR
* Swiss CH Core
* CH EMED / eMediplan
* SNOMED CT Switzerland
* WiCare / WigaSoft
* careCoach / topCare
* SAP / SAP Fiori / healthcare APIs
* device/vital interfaces
* Keycloak
* Open Policy Agent
* Flowable
* NATS
* PostgreSQL
* RKE2 / OpenShift / Kubernetes
* vLLM
* selected LLM and ASR model cards
* Swissmedic
* Swiss Federal Data Protection and Information Commissioner
* Swiss federal legislation
* EU AI Act where applicable
* current healthcare software security guidance

Record material research in:

`docs/research/VERIFIED_SOURCES.md`

For each important source capture:

* source name;
* official URL;
* access date;
* product/specification version if available;
* architectural implication.

Do not use search-engine summaries as implementation authority.

Do not invent undocumented vendor APIs.

---

# 4. Core architecture invariants

The required architectural direction is:

```text
Managed PWA / mobile shell
        +
Fixed clinical UI
        +
Constrained OpenUI Generative UI
              │
              ▼
Clinical BFF / Query + Command Gateway
              │
              ▼
Identity + RBAC/ABAC + Workflow + Rules
              │
      ┌───────┴────────┐
      ▼                ▼
Clinical Data Port     Local AI Gateway
      │                │
      ▼                ├── fast local LLM
Medplum/FHIR           ├── deep local LLM
      │                ├── local ASR
      ▼                └── approved knowledge
Provider-neutral
Integration Hub
      │
      ├── WiCare
      ├── careCoach
      ├── SAP/Fiori
      ├── vital/device systems
      ├── nurse-call mirror
      └── future providers
```

Do not collapse these trust boundaries merely to save implementation effort.

---

# 5. Architectural principles

## 5.1 Deterministic core, assistive AI

The workflow engine, authorization layer, clinical rules, validation, synchronization, provider capabilities, auditing, and state transitions are authoritative.

LLMs may:

* understand natural-language intent;
* retrieve authorized information;
* extract structured information;
* draft documentation;
* summarize records;
* draft SBAR handovers;
* prepare rounds;
* generate permitted OpenUI layouts;
* draft questions;
* help users navigate workflows;
* explain approved policies.

LLMs must not independently:

* diagnose;
* prescribe;
* change medication;
* calculate or alter doses as authoritative action;
* execute unrestricted FHIR writes;
* write directly to provider databases;
* modify authorization;
* suppress clinical alarms;
* replace nurse-call systems;
* make final insurance decisions;
* discipline staff;
* generate autonomous patient prognoses in the initial product;
* install arbitrary plugins;
* call arbitrary URLs;
* execute shell commands from clinical content.

Every clinical mutation passes through a deterministic typed command.

---

# 6. Human approval

Writes require explicit authorized human approval.

Support configurable policies including:

```text
standard:
author + passkey/session confirmation

sensitive:
author + explicit structured diff review

high-assurance:
author + second authorised reviewer

four-eyes:
two independent identities/passkeys

provider-defined:
additional role/countersignature requirements
```

The rule is defined by workflow and policy, never by the LLM.

Never implement one universal four-eyes requirement where healthcare workflow does not need it.

Make it configurable by:

* action;
* resource;
* department;
* professional role;
* risk class;
* organization.

---

# 7. Provider integration

Pflegehelfer is a collaboration layer over existing systems.

It must support:

```text
Pflegehelfer
    ↕
canonical FHIR workspace
    ↕
provider-neutral adapter framework
    ↕
WiCare / careCoach / SAP / devices / future systems
```

Do not couple frontend or domain logic directly to one provider.

Implement a stable provider adapter SDK.

Expected conceptual capabilities include:

```ts
interface ProviderAdapter {
  identify(): ProviderIdentity;
  discoverCapabilities(): Promise<ProviderCapabilities>;
  healthCheck(): Promise<ProviderHealth>;

  pullChanges(cursor?: SyncCursor): Promise<InboundChangeBatch>;
  mapInbound(record: ProviderRecord): Promise<CanonicalResource[]>;

  validateOutbound(command: CanonicalCommand): Promise<ValidationResult>;
  executeCommand(command: CanonicalCommand): Promise<ProviderReceipt>;
  getCommandStatus(receipt: ProviderReceipt): Promise<CommandStatus>;

  reconcile(request: ReconciliationRequest):
    Promise<ReconciliationResult>;

  createContextLaunch?(
    request: ContextLaunchRequest
  ): Promise<ContextLaunch>;
}
```

Do not make the UI contain provider-specific branches such as:

```ts
if (provider === "wicare") ...
```

Provider differences belong in:

* adapter implementations;
* capability manifests;
* mapping packages;
* organization configuration.

---

# 8. Vendor API honesty

This requirement is absolute.

If full official documentation or sandbox access for WiCare, careCoach, SAP, device systems, or another vendor is not available:

DO NOT:

* invent endpoints;
* invent SOAP schemas;
* invent field names;
* guess authentication mechanisms;
* use browser automation as a production workaround;
* directly modify vendor databases;
* mark real write-back as complete.

Instead:

1. Complete the provider adapter contract.
2. Complete the capability registry.
3. Complete mapping abstractions.
4. Complete synchronization state handling.
5. Complete retry/idempotency/reconciliation behavior.
6. Build a realistic provider simulator.
7. Build contract tests.
8. Document precisely which vendor artifact is missing.
9. Mark only that capability as `EXTERNAL_VENDOR_GATE`.
10. Keep the rest of the product production-complete.

A vendor dependency is not permission to leave unrelated architecture unfinished.

---

# 9. Synchronization model

Do not implement naive database mirroring.

Use:

* canonical representation;
* explicit source-of-truth ownership;
* event ingestion;
* transactional outbox/inbox;
* idempotency;
* version checks;
* provider acknowledgements;
* reconciliation.

Each organization must have a versioned source-of-truth configuration.

Every synchronized item must preserve:

```text
origin system
origin identifier
origin version
effective time
recorded time
received time
mapping version
correlation ID
causation ID
idempotency key
sync status
```

Never silently apply last-write-wins to conflicting clinical records.

Synchronization states must be visible:

```text
draft
reviewed
approved
pending-provider
synced
rejected
conflict
manual-review
```

---

# 10. Medplum boundary

Use self-hosted Medplum as the canonical FHIR operational workspace according to the architecture.

However, application code must depend primarily on an internal abstraction:

```ts
ClinicalDataPort
```

not directly on Medplum-specific implementation details.

This preserves future portability to another compliant FHIR server.

Use Medplum for appropriate:

* FHIR resources;
* subscriptions;
* provenance;
* audit events;
* normalized cross-provider views.

Do not assume Medplum is legally authoritative for every external-provider field.

---

# 11. Swiss interoperability

Use the architecture-defined Swiss FHIR strategy.

Pin implementation-guide versions.

Do not automatically upgrade clinical profiles.

Support appropriate mappings around:

* Patient
* Encounter
* EpisodeOfCare
* Location
* Practitioner
* PractitionerRole
* CareTeam
* CarePlan
* Goal
* Task
* Communication
* Observation
* Condition
* AllergyIntolerance
* Medication-related resources
* ServiceRequest
* Procedure
* DiagnosticReport
* Questionnaire
* QuestionnaireResponse
* DocumentReference
* Coverage
* Claim
* Consent
* Device
* Provenance
* AuditEvent

Use appropriate terminology mechanisms for:

* SNOMED CT CH;
* UCUM;
* LOINC;
* Swiss medication terminology/content where licensed.

Never store a measurable clinical fact only inside an AI-generated narrative when structured representation is appropriate.

---

# 12. Product UX

The employee interface must be:

* mobile-first;
* extremely simple;
* calm;
* professional;
* fast;
* touch-friendly;
* understandable under time pressure;
* usable one-handed;
* accessible;
* visually consistent;
* resistant to wrong-patient errors.

Do not create a futuristic AI dashboard.

Do not create:

* neon effects;
* excessive glassmorphism;
* decorative animations;
* huge gradients;
* dense analytics on care screens;
* nested navigation;
* an unstructured chat that bypasses typed workflow and approval;
* a conventional dashboard with an AI assistant bolted on.

The experience should feel like a high-quality modern Swiss healthcare tool, not a consumer AI demo.

The conversation stream is the primary workspace. Stable fixed controls are
limited to identity/role, patient context, history, safety, sync state,
composer and deterministic approval. Compact contextual modes are:

```text
Meine Schicht
Patient
Team
Synchronisation
```

All patient work materializes inside that stream as registered, interactive
GenUI components:

```text
overview
what changed
open tasks
vitals
care goals
timeline
communication
documentation
rounds
```

---

# 13. Generative UI

Use the self-hostable OpenUI renderer according to the architecture and current official documentation.

OpenUI is a presentation mechanism.

It is not an authorization mechanism.

Only registered components may be generated.

Create an explicit clinical component catalog, for example:

```text
PatientContextBanner
SourceTimestamp
RiskChip
TaskCard
TaskBoard
CommunicationCard
AcknowledgementCard
HandoverDelta
SBARCard
VitalTrend
ObservationTable
CareGoalCard
RoundActionDraft
PhysicianQuestionDraft
NoteDraftReview
TranscriptComparison
ConflictResolutionCard
SyncStatus
PolicyCitation
WorkflowForm
UnknownState
```

Generated UI actions must resolve to opaque server-issued intents.

An LLM-generated component must never contain:

* arbitrary JavaScript;
* arbitrary HTML execution;
* arbitrary URLs;
* arbitrary webhook targets;
* raw provider endpoints;
* raw FHIR mutation calls.

The server rechecks authorization and current state for every action.

---

# 14. Core workflow requirements

The initial product must support complete end-to-end flows for:

## Intake

```text
patient matching
encounter
room/ward
available demographics
risk context
allergies
medication reconciliation status
care needs
rehabilitation goals
open documents
responsible teams
tasks
missing information
```

Do not silently resolve discrepancies.

---

## Daily shift

Staff should be able to:

```text
see assigned patients
see current work
accept/delegate tasks
record work performed
record spontaneous events
record observations
dictate notes
ask questions
communicate with teams
see waiting items
see synchronization state
finish or hand over unfinished work
```

---

## Spontaneous tasks

Support:

* patient requests;
* patient-bell mirrored events;
* new observations;
* physician requests;
* therapy requests;
* pharmacy requests;
* transport;
* service/facility tasks;
* administrative tasks.

Task models require:

```text
subject/patient where relevant
requester
owner/team
priority
due time
status
acknowledgement
dependencies
comments
completion evidence
escalation
```

---

## Übergabe

Create a delta-based handover.

Include:

* new important observations;
* changed information;
* unresolved issues;
* unfinished tasks;
* waiting responses;
* escalations;
* relevant appointments;
* responsibility transfer.

Outgoing staff approve/sign.

Incoming staff acknowledge.

Unresolved work carries forward automatically.

---

## Visite / rounds

Support collaborative preparation from:

* nursing;
* physicians;
* pharmacy;
* therapists;
* rehabilitation;
* service coordination where relevant.

Present:

* goals;
* relevant recent changes;
* vital trends;
* open questions;
* pending decisions;
* discharge barriers;
* incomplete prior actions.

Round outcomes become structured decisions/tasks with:

```text
owner
deadline
status
required confirmation
target authoritative system
```

---

## Closed-loop communication

Patient-related communication must support:

```text
request
recipient
priority
deadline
acknowledgement
response
resulting task
escalation
closure
```

Do not build merely an unstructured chat application.

---

# 15. Department model

The system must support role-scoped workflows for at least:

* Pflegeassistenz / Pflegehelfer
* Pflegefachpersonen
* physicians
* pharmacy
* physiotherapy
* occupational therapy
* speech therapy
* rehabilitation coordination
* patient transport
* service/facility staff
* administration
* billing/insurance staff
* HR
* management
* IT
* quality/patient safety

Not every role sees patient clinical information.

Apply least privilege.

Service and transport staff should receive only the minimum context necessary for their task.

HR must not receive patient data merely because HR exists in the same application.

---

# 16. Identity and authorization

Implement the architecture-defined authorization stack.

Use:

* institutional SSO;
* Keycloak or institutional IdP;
* AD/LDAP federation where appropriate;
* MFA/passkeys;
* RBAC;
* ABAC;
* managed-device state;
* ward;
* shift;
* professional role;
* treatment relationship;
* purpose of use;
* workflow state;
* break-glass rules.

Do not give phones broad Medplum credentials.

Expose purpose-specific server endpoints.

Examples:

```text
GET /my-shift
GET /patient/:id/context
GET /patient/:id/changes
POST /task/:id/accept
POST /observation/draft
POST /note/:id/approve
POST /handover/:id/acknowledge
```

All sensitive authorization must be enforced server-side.

---

# 17. Personal phones and managed devices

Support secure installation on:

* institution-owned phones;
* approved BYOD phones if institutional policy permits;
* tablets;
* workstation browsers.

Provide:

## PWA mode

* installable internal PWA;
* institution certificate support;
* SSO;
* encrypted limited cache;
* role-based access;
* secure session handling;
* visible offline state.

## Managed-shell mode

Use a thin native wrapper around the same frontend when required for:

* secure OS keystore;
* device attestation;
* MDM;
* NFC;
* barcode scanning;
* stronger encrypted storage;
* remote wipe;
* managed notifications.

Never assume BYOD is acceptable by default.

Make device-policy requirements organization configurable.

---

# 18. Offline safety

Offline data must be minimized.

Cache only what is necessary for the current user and shift.

Never cache the full facility patient database.

Offline operations require:

* encrypted local store;
* bounded retention;
* explicit stale-data indication;
* queue status;
* conflict protection;
* user-visible synchronization;
* logout/role-change purge;
* remote revocation where supported.

Do not permit unsafe high-risk clinical actions offline merely because a queue exists.

---

# 19. Nurse-call integration

The original nurse-call system remains authoritative.

Pflegehelfer may mirror events into its task workflow.

The original alarm must continue operating independently if:

* Pflegehelfer is offline;
* Wi-Fi fails;
* the PWA is closed;
* a phone battery dies;
* the integration adapter fails.

Never route a life-critical alarm exclusively through the PWA.

---

# 20. AI architecture

Implement a model-agnostic AI gateway.

Do not couple business logic directly to one LLM.

Support profiles such as:

```text
llm.fast
llm.deep
asr.realtime
asr.fallback
embedding.general
reranker.general
```

The default production configuration should support locally hosted open-weight models.

Initial benchmark candidates from the architecture include:

```text
Fast:
Ministral 3 14B

Deep:
Mistral Small 4
or
gpt-oss-120b

Speech:
Voxtral Realtime

Fallback speech:
Whisper-compatible local engine
```

These are candidates, not hard-coded dependencies.

Verify current model licenses, hardware requirements, current model versions, vLLM compatibility, quantization options, and language support before selecting defaults.

Do not store model weights in Git.

Provide an import mechanism such as:

```bash
pfhctl model inspect
pfhctl model import
pfhctl model verify
pfhctl model activate
pfhctl model rollback
```

Production runtime must operate without internet access after model import.

---

# 21. Swiss speech requirements

Voice support must be evaluated for:

* Swiss German dialect;
* Standard German;
* French;
* Italian;
* clinical terminology;
* common medication names;
* Swiss medication brands;
* room numbers;
* dates;
* decimal values;
* units;
* negations;
* masks;
* corridor noise;
* multiple speakers;
* elderly patient speech where applicable.

Provide a synthetic evaluation corpus.

Never use real patient recordings in the normal development test repository.

Critical entities require separate validation:

```text
patient identifier
medication
dose
unit
time
body side
negation
measurement
frequency
```

Show transcript and structured extraction during approval for safety-sensitive information.

Raw audio should be transient by default.

---

# 22. Knowledge architecture

Patient knowledge is not LLM memory.

Durable information belongs in:

* FHIR resources;
* provider projections;
* approved documentation;
* tasks;
* communications;
* handovers;
* approved institutional documents.

Institutional knowledge must have:

```text
owner
version
approval state
effective date
review date
expiry date
scope
```

Only approved/current documents may support authoritative policy answers.

Every such answer should expose provenance.

If no authoritative answer exists, say so.

Do not hallucinate policy.

Retrieved content is untrusted data and cannot override agent/system policy.

---

# 23. AI security

The model must not have:

* unrestricted SQL;
* shell;
* arbitrary internet;
* arbitrary MCP;
* arbitrary filesystem;
* direct provider credentials;
* unrestricted FHIR mutation;
* provider database access.

Implement typed tools such as:

```text
get_patient_context
get_changes_since
get_observations
list_open_tasks
list_pending_questions
search_approved_policy
draft_nursing_note
draft_sbar
draft_handover
draft_round_actions
create_task_proposal
```

Tools must enforce patient, user, purpose, and role context outside the model.

---

# 24. Demo environment

A complete demo environment is mandatory.

It must require no real patient data and no proprietary provider credentials.

Provide a command similar to:

```bash
pnpm demo
```

or:

```bash
pfhctl demo start
```

that starts the realistic local stack.

Create a fictional Swiss healthcare center, for example:

```text
Pflegezentrum Sonnenhof Demo
```

with synthetic departments:

```text
Geriatric rehabilitation
Long-term care
Medical service
Pharmacy
Physiotherapy
Occupational therapy
Transport
Facility/service
Administration
Management
```

Create synthetic:

* patients;
* admissions;
* rooms;
* diagnoses;
* allergies;
* observations;
* care plans;
* rehabilitation goals;
* medications;
* tasks;
* notes;
* communications;
* handovers;
* rounds;
* discrepancies;
* provider synchronization states.

Create demo accounts for multiple roles.

Never use real employee or patient details.

---

# 25. Provider simulators

Demo mode must include realistic simulators for:

```text
WiCare
careCoach
SAP/Fiori administrative/vital source
device/vitals gateway
nurse-call
```

Simulators must exercise:

* read;
* create/update where capability permits;
* delayed acknowledgement;
* rejection;
* timeouts;
* duplicate events;
* stale versions;
* sync conflicts;
* provider downtime;
* recovery.

These simulators are test infrastructure, not claims about undocumented vendor APIs.

---

# 26. Required demo journeys

Automated E2E tests must cover at least:

## Journey A — admission

```text
new patient arrives
→ information imported
→ discrepancy identified
→ intake tasks created
→ staff complete intake
→ authorised entries approved
→ provider simulator acknowledges
```

## Journey B — routine shift

```text
login
→ incoming handover
→ accept patients/tasks
→ open room
→ document care
→ add vital value
→ create spontaneous task
→ communicate with physician
→ complete work
```

## Journey C — patient bell

```text
simulated nurse-call event
→ Pflegehelfer task appears
→ authorised staff acknowledges
→ outcome documented
→ event closes
```

## Journey D — physician/pharmacy closed loop

```text
nursing observation
→ structured physician question
→ physician acknowledges
→ pharmacy/physician response
→ resulting task
→ completion
```

## Journey E — rounds

```text
prepare patient
→ gather open questions
→ show trends
→ record structured decisions
→ assign owners/deadlines
→ monitor completion
```

## Journey F — handover

```text
generate delta
→ verify sources
→ outgoing approval
→ incoming acknowledgement
→ unfinished work carries over
```

## Journey G — provider failure

```text
approve documentation
→ provider unavailable
→ visible pending state
→ retry
→ provider acknowledgement
```

## Journey H — conflict

```text
local draft based on provider version N
→ provider becomes version N+1
→ write attempted
→ conflict detected
→ reconciliation flow
```

## Journey I — authorization

Verify that:

```text
nurse ≠ physician permissions
transport ≠ nurse permissions
service ≠ clinical permissions
HR ≠ patient-record access
manager ≠ unrestricted patient access
```

---

# 27. UI quality gates

Do not trust component tests alone.

Run the actual application in a browser.

Inspect critical screens at least at:

```text
360px mobile
390px mobile
768px tablet
desktop
```

Verify:

* no unintended horizontal scrolling;
* correct safe-area behavior;
* large touch targets;
* clear selected patient;
* clear data source;
* clear sync state;
* readable typography;
* no clipped German/French/Italian labels;
* loading states;
* empty states;
* errors;
* offline state;
* conflict state;
* dark/light behavior if implemented;
* keyboard accessibility;
* focus behavior;
* screen-reader semantics;
* WCAG 2.2 AA target.

Where available, use browser automation, screenshots, DOM inspection, accessibility tooling, and actual interaction rather than reasoning only from source code.

Review the interface as both:

* a senior healthcare UX engineer;
* a staff member under time pressure.

Simplify aggressively.

---

# 28. Design principles

Use a restrained design system.

Prefer:

* neutral surfaces;
* strong information hierarchy;
* restrained status colors;
* readable typography;
* consistent spacing;
* clear patient identity;
* obvious actionable state;
* high contrast;
* minimal decoration;
* predictable navigation.

Use animation only when it communicates:

* state change;
* task movement;
* synchronization;
* loading;
* confirmation.

Avoid cosmetic motion.

A nurse should understand the important state in roughly one glance.

---

# 29. Privacy

Design for Swiss healthcare privacy from the beginning.

Implement:

* privacy by design;
* privacy by default;
* least privilege;
* data minimization;
* encryption at rest;
* encryption in transit;
* organization-controlled secrets/keys;
* purpose limitation;
* retention classes;
* auditable access;
* deletion workflows;
* incident records;
* export/portability mechanisms.

Never:

* send PHI to public analytics;
* include PHI in generic application logs;
* expose patient names in lock-screen push notifications by default;
* use production PHI as demo or CI data;
* train models from production data automatically.

---

# 30. HR boundary

Pflegehelfer may support operational and management improvement but must not become covert worker surveillance.

Do not implement:

* emotion recognition;
* voice-based employee scoring;
* hidden activity monitoring;
* individual “slow staff” rankings;
* automatic disciplinary recommendations;
* automated shift penalties;
* unrelated HR profiling from patient-care data.

Management analytics should normally be:

* aggregate;
* team/process-focused;
* transparent;
* purpose-limited.

Individual task ownership may be retained when operationally necessary, but not automatically transformed into a performance score.

---

# 31. Compliance evidence

Maintain documentation sufficient to support later formal legal/regulatory review.

At minimum:

```text
docs/compliance/
├── intended-use.md
├── excluded-use.md
├── data-inventory.md
├── data-flow.md
├── dpia-working-draft.md
├── retention-model.md
├── role-permission-matrix.md
├── ai-inventory.md
├── third-party-inventory.md
└── regulatory-boundary.md
```

And:

```text
docs/security/
├── threat-model.md
├── security-architecture.md
├── incident-response.md
├── secrets-management.md
├── backup-restore.md
├── airgap-update.md
└── break-glass.md
```

And:

```text
docs/clinical-safety/
├── hazard-log.md
├── failure-modes.md
├── human-approval.md
├── downtime-procedure.md
└── validation-plan.md
```

Do not claim legal certification that has not occurred.

Do not claim medical-device certification that has not occurred.

---

# 32. Deployment

Support:

## Development/demo

A developer should be able to start a representative local stack using documented commands.

Prefer a reproducible approach such as:

```bash
pnpm install
pnpm dev:infra
pnpm demo:seed
pnpm dev
```

or one well-defined equivalent.

## Production

Support architecture-defined deployment to:

* RKE2;
* OpenShift/Kubernetes;
* institutional private cloud/on-premises environment.

Provide:

* Helm charts;
* configuration schema;
* secret injection;
* health probes;
* readiness;
* resource limits;
* persistent storage;
* migrations;
* high-availability recommendations;
* backup;
* restore;
* observability;
* air-gap installation.

Do not hardcode one healthcare-center environment.

---

# 33. `pfhctl`

Implement or evolve an operator CLI with high-value workflows such as:

```bash
pfhctl preflight
pfhctl install
pfhctl status

pfhctl identity test

pfhctl provider list
pfhctl provider add
pfhctl provider capabilities
pfhctl provider test

pfhctl fhir validate

pfhctl model list
pfhctl model import
pfhctl model verify
pfhctl model activate
pfhctl model rollback

pfhctl demo seed
pfhctl demo reset

pfhctl backup create
pfhctl backup verify
pfhctl backup restore-test

pfhctl upgrade inspect
pfhctl upgrade apply
pfhctl rollback
```

Make it useful rather than decorative.

---

# 34. Air-gap design

Production runtime must not require public internet access.

External connectivity, when institutionally necessary, passes through controlled integration/DMZ paths.

Create signed offline release bundles containing appropriate:

```text
OCI images
deployment manifests
migrations
FHIR packages
configuration schemas
model metadata
SBOM
checksums/signatures
security reports
release notes
upgrade plan
rollback plan
```

Do not bundle third-party model weights or licensed terminology unless licensing allows it.

Instead support verified import.

---

# 35. Supply-chain security

Implement CI/CD controls including appropriate:

* lockfiles;
* dependency pinning;
* secret scanning;
* SAST;
* dependency scanning;
* container scanning;
* SBOM generation;
* license reporting;
* OCI image signing;
* artifact checksum verification;
* migration safety checks;
* branch protection documentation.

Critical vulnerabilities must block release unless there is an explicit documented accepted-risk decision outside automated agent authority.

---

# 36. Observability

Make the system legible to operators and coding agents.

Provide structured:

* logs;
* metrics;
* traces;
* health states.

Use OpenTelemetry-compatible instrumentation.

Do not leak PHI into telemetry.

Expose operational indicators for:

* provider health;
* synchronization queue depth;
* failed writes;
* reconciliation backlog;
* AI latency;
* model errors;
* ASR latency;
* FHIR validation failures;
* workflow escalation;
* notification health;
* database health.

Demo/test environments should expose enough observability that Codex can investigate failures directly.

---

# 37. Analytics

Use a logically separate pseudonymized/aggregated process analytics layer.

Measure things such as:

* documentation delay;
* duplicated data entry;
* handover duration;
* unresolved handover items;
* question acknowledgement time;
* task aging;
* provider failures;
* reconciliation rate;
* AI draft acceptance/edit distance;
* workflow bottlenecks;
* staff-reported usability;
* measured time/cost improvement.

Do not use the clinical operational database directly as an unrestricted management warehouse.

---

# 38. Engineering architecture

Prefer a modular monolith plus specialized infrastructure/processes over premature microservice fragmentation.

Reasonable logical deployment:

```text
staff PWA
admin/operations UI
TypeScript API/BFF
workflow/background worker
integration workers
notification service
Python AI gateway
Medplum
Flowable
Keycloak
OPA
NATS
PostgreSQL
object storage
observability stack
```

Do not create a network service merely because a code module exists.

Extract a service only when there is a meaningful reason such as:

* security boundary;
* scaling characteristic;
* runtime difference;
* failure isolation;
* independent lifecycle.

---

# 39. Repository quality

Keep the repository easy for senior engineers and coding agents to understand.

Requirements:

* clear root README;
* root architecture entry point;
* ADRs;
* explicit commands;
* no mysterious scripts;
* no duplicate architectures;
* no dead frameworks;
* no abandoned prototypes;
* no unnecessary wrappers;
* no giant god modules;
* no speculative abstractions without a current use;
* no circular dependencies.

Prefer boring, explicit code in safety-critical paths.

---

# 40. Coding standards

Use strict TypeScript where TypeScript is used.

Avoid `any` in domain/security/integration code except where narrowly justified and isolated.

Use:

* strong domain types;
* schema validation at trust boundaries;
* explicit error models;
* exhaustive state handling;
* immutable identifiers;
* UTC internally with explicit timezone handling;
* deterministic tests;
* structured logging;
* dependency injection at provider/model boundaries.

Never trust:

* frontend validation;
* model output;
* vendor payloads;
* imported FHIR data;
* retrieved documents.

Validate all of them.

---

# 41. Database migrations

Every migration must be:

* deterministic;
* reviewed;
* backward-aware;
* tested on realistic data volume where appropriate;
* compatible with rollback or documented restore procedure;
* safe against partial deployment.

Do not alter historical audit facts destructively.

---

# 42. Testing strategy

Create and maintain:

```text
unit tests
schema tests
property-based tests where valuable
workflow tests
authorization tests
adapter contract tests
FHIR conformance tests
integration tests
E2E browser tests
offline synchronization tests
conflict tests
failure-injection tests
AI evaluation tests
ASR evaluation tests
security tests
accessibility tests
performance tests
backup/restore tests
upgrade/rollback tests
```

Do not chase meaningless coverage percentages.

Critical domains should have near-exhaustive behavioral coverage:

* authorization;
* approval;
* workflow state;
* clinical commands;
* synchronization;
* reconciliation;
* audit;
* patient isolation.

---

# 43. Verification command

Create one top-level verification command.

For example:

```bash
pnpm verify
```

It should run the practical non-destructive release checks needed for a normal engineering change.

Where tests are too expensive for every local run, split:

```bash
pnpm verify
pnpm verify:full
pnpm verify:security
pnpm verify:e2e
pnpm verify:airgap
```

Document the exact distinction.

---

# 44. Development loop

For every vertical slice:

```text
1. Understand requirement.
2. Verify relevant official documentation.
3. Update plan if needed.
4. Define acceptance tests.
5. Implement smallest complete vertical slice.
6. Run targeted tests.
7. Run broader regression tests.
8. Start the application.
9. Exercise the user journey.
10. Inspect logs/errors.
11. Inspect actual UI where relevant.
12. Review security/privacy implications.
13. Review failure behavior.
14. Fix defects.
15. Re-run.
16. Update documentation/status.
17. Continue to next slice.
```

Do not postpone all testing until the end.

---

# 45. Self-review loop

When an implementation milestone appears complete, perform an adversarial self-review.

Review independently from these perspectives:

```text
Senior software architect
Senior frontend/mobile engineer
Healthcare integration engineer
Security engineer
Swiss privacy/compliance engineer
Clinical safety reviewer
Nurse/care-workflow reviewer
Physician workflow reviewer
Pharmacy workflow reviewer
SRE/operator
QA engineer
UX/accessibility reviewer
```

Where Codex supports parallel agents/subagents, use separate review agents for major milestones.

Reviewers should inspect actual code, tests, UI, logs, and behavior rather than merely rereading summaries.

Convert valid findings into fixes.

Repeat the review/test loop until no material unresolved internally-fixable findings remain.

---

# 46. Do not optimize for pleasing the reviewer

Do not:

* hide TODOs;
* weaken tests to make them green;
* mock the function under test;
* accept an unsafe fallback;
* suppress compiler errors;
* disable security checks;
* broaden permissions for convenience;
* treat vendor simulators as real vendor integration;
* mark a feature complete because a UI exists.

Fix root causes.

---

# 47. External gates

Use one explicit category:

```text
EXTERNAL_VENDOR_GATE
```

for genuinely external blockers such as:

* WiCare private interface specification;
* careCoach private write interface;
* SAP customer-specific service definitions;
* nurse-call vendor protocol;
* proprietary terminology license;
* production certificates;
* real SSO configuration;
* institution-specific DPIA approval.

Each gate must document:

```text
what is missing
why it is external
which implemented interface awaits it
how to test it when received
which files/modules are affected
what remains fully operational without it
```

Do not use external gates as a dumping ground for unfinished internal engineering.

---

# 48. Implementation status

Maintain:

`docs/IMPLEMENTATION_STATUS.md`

It must distinguish:

```text
DONE
PARTIAL
NOT STARTED
EXTERNAL_VENDOR_GATE
OUT OF INITIAL INTENDED USE
```

Every `DONE` item must point to relevant:

* implementation;
* tests;
* documentation.

Never report a percentage without evidence.

---

# 49. Final definition of done

Pflegehelfer is internally production-ready only when all achievable conditions below are satisfied.

## Repository

* clean architecture;
* no conflicting stale architecture;
* clear README;
* reproducible setup;
* documented commands;
* no unexplained placeholders.

## Build

* clean installation works;
* lint passes;
* formatting passes;
* type checks pass;
* builds pass.

## Tests

* unit tests pass;
* workflow tests pass;
* authorization tests pass;
* integration tests pass;
* adapter contract tests pass;
* FHIR tests pass;
* E2E tests pass;
* offline/conflict tests pass;
* security checks pass;
* accessibility checks pass;
* backup/restore tests pass.

## Demo

From a clean environment, a developer can launch a synthetic healthcare center and successfully execute all required demo journeys.

## Security

* no hard-coded secrets;
* no unrestricted model writes;
* no broad frontend credentials;
* no cross-patient leak;
* no critical unresolved vulnerability;
* full clinical write audit path exists.

## Providers

* provider-neutral adapter SDK is complete;
* simulators exist;
* WiCare/careCoach/SAP adapter boundaries exist;
* real integrations are implemented only where official contracts permit;
* externally blocked capabilities are truthfully gated.

## UI

* primary mobile flows are complete;
* the interface is visually coherent;
* critical states are understandable;
* patient context is obvious;
* sync state is obvious;
* responsive layouts work;
* accessibility target is met.

## AI

* model gateway is vendor/model agnostic;
* AI can be disabled without breaking core operation;
* model outputs are schema/policy validated;
* production AI has no unrestricted data mutation path;
* evaluation suite exists.

## Operations

* deployment documentation exists;
* air-gap install path exists;
* health checks exist;
* backups exist;
* restore has been tested;
* upgrade and rollback paths exist;
* monitoring exists.

## Documentation

* architecture is current;
* provider boundaries are current;
* install/admin/developer guides exist;
* security/privacy/clinical-safety docs exist;
* demo guide exists;
* known external gates are explicit.

---

# 50. Final completion audit

Before declaring the project complete:

1. Start from a clean checkout.
2. Follow only the documented setup instructions.
3. Start the full demo stack.
4. Seed demo data.
5. Run all verification suites.
6. Run all major E2E journeys.
7. Inspect the UI at mobile/tablet/desktop sizes.
8. Verify every role boundary.
9. Test AI-disabled mode.
10. Test provider-down mode.
11. Test conflict/reconciliation.
12. Test offline mode.
13. Test wrong-patient protection.
14. Test approval/four-eyes workflows.
15. Test backup and restore.
16. Test upgrade and rollback.
17. Review logs for PHI leakage.
18. Review dependency/security reports.
19. Review active TODO/FIXME markers.
20. Review implementation status against `docs/ARCHITECTURE.md`.

If an internally fixable defect is discovered, fix it and repeat the appropriate verification.

---

# 51. Final report

At the end of a major development run, provide a concise engineering report containing:

```text
What was implemented
Architecture decisions made
Tests executed and results
Demo journeys verified
Security/compliance work completed
Provider integrations actually verified
External vendor gates
Known limitations
Commands needed to reproduce validation
Current production-readiness assessment
```

Do not claim more than the evidence supports.

---

# 52. Long-horizon execution rule

This is a large project.

Do not attempt to implement the entire architecture as shallow scaffolding in one pass.

Work through complete vertical slices while maintaining the global plan.

Prioritize in approximately this order unless the existing repo changes the optimal sequence:

```text
foundation
→ identity/security/audit
→ clinical data abstraction
→ FHIR
→ provider adapter SDK
→ provider simulators
→ core PWA shell
→ tasks/communication
→ intake
→ documentation
→ vitals
→ handover
→ rounds
→ local voice
→ AI gateway
→ OpenUI
→ controlled write-back
→ offline/mobile hardening
→ operational deployment
→ analytics/improvement
→ final system validation
```

Prefer completing one end-to-end path correctly over creating ten disconnected half-features.

---

# 53. Maintainability rule

This repository should remain understandable by a senior engineer joining years later.

Before introducing a framework, service, abstraction, or dependency, ask:

```text
What concrete problem does this solve?
Can the current stack solve it cleanly?
Does it improve safety or maintainability?
Does it add an operational burden?
Can it be removed later?
```

Avoid overengineering.

Avoid cleverness in safety-critical code.

Favor explicit contracts, predictable state machines, typed boundaries, testable workflows, and boring infrastructure.

---

# 54. Guiding product principle

Every design and engineering decision should support this real-world outcome:

> An authorised employee securely opens Pflegehelfer on a managed phone, immediately sees the right patients and work for their role and shift, can ask for information or dictate what happened in natural language, reviews a clear structured result, explicitly approves it, and Pflegehelfer deterministically updates or queues the appropriate authoritative systems through validated provider adapters; colleagues immediately see the resulting tasks, communication, handover state and rounds context according to their permissions, while every clinical change remains attributable, auditable, reversible/correctable, source-linked, privacy-preserving and safe even if the AI, network or an external provider fails.

If a feature makes this workflow slower, less understandable, less deterministic, harder to operate, or less safe without creating sufficient clinical value, reconsider the feature.

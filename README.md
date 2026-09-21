<div align="center">

Pflegehelfer

A conversational coworker for healthcare teams.

Chat-first workflows. Human-reviewed documentation. Accountable integrations.

Quick start · Architecture · Configuration · Project status · Documentation

</div>

Pflegehelfer is a self-hostable healthcare workflow and interoperability project designed around the day-to-day needs of Swiss care teams. It combines an OpenUI chat interface, text and voice interaction, Medplum/FHIR clinical resources, and persistent operational state to help staff retrieve information, document work, coordinate responsibilities and review changes before they are delivered to connected systems.

The objective is straightforward: report work once, review meaningful changes once, and keep information and responsibilities aligned across the working day.

Pflegehelfer is designed to complement existing institutional systems rather than ask staff to maintain another disconnected patient record. Its value must be demonstrated through less repeated entry, clearer responsibility transfer and reliable delivery—not assumed from the presence of AI.

[!IMPORTANT]
Active development · synthetic evaluation only. The current implementation is on codex/genui-production-showcase and is under review in draft PR #1. It is not yet approved for real patient data or clinical production. The completion matrix separates implemented features, remaining engineering work and external approvals. A running demo or successful CI does not mean that connected AI, speech, institutional security or real-provider integrations have passed acceptance.

Why Pflegehelfer

A single episode of care can create several administrative obligations: a note, a task update, a question for another professional, a handover item and information needed by an external system. Pflegehelfer is being built to connect these obligations in one working context instead of making staff repeatedly navigate modules and re-enter the same facts.

Its product principles are:

Conversation first. Staff ask questions, report work and correct drafts in ordinary language. Interactive views appear when useful—not as a compulsory form for every message.

Faithful records. Reported facts, existing records, assistant interpretation and approved documentation remain distinguishable.

Explicit responsibility. Starting work, pausing it, handing it over and accepting it are different events with visible owners and states.

Integration without hidden assumptions. Each provider operation has a defined capability, source ownership, mapping and acceptance requirement.

Configurable institutions. Approved role and workflow guidance should adapt the product without creating a separate application for every care center.

Measurable improvement. Faster entry is not an improvement if it creates more corrections or transfers administrative work to someone else.

These are the product's design commitments. The implementation status below shows which parts are complete enough for synthetic evaluation and which remain in development.

Project status

Status snapshot: 21 September 2026, based on development commit eed4ac34. The current G0–G7 matrix is the primary readiness reference; dated tests and recovery results are recorded in the acceptance ledger.

Area

Current position

OpenUI conversation surface

Implemented with AgentInterface, one guarded composer, AI SDK UIMessage SSE, and server-owned general/patient history.

Reviewed documentation and delivery

Synthetic implementations and regression evidence exist for proposal revisions, one-use approval, atomic local acceptance, interruption recovery and simulator read-back; remaining mutation and recovery work is open.

Workday and handover

Synthetic handover, planned/spontaneous work, pause/resume and responsibility-transfer flows exist; post-cutoff addenda and consecutive full-shift acceptance remain incomplete.

Clinical workspace

Medplum/FHIR projections and concurrency tests exist; resource-native reconstruction and additional synchronization work remain open.

Organizational configuration

Reviewed directory-based Markdown packs, shared role/workflow guides and validation exist; complete publication tooling and multi-department operation remain unfinished.

Team collaboration and files

Named/role-queue communications exist; full shared-thread ACLs, durable unread/replay, topic workflows and the protected library remain in progress.

Analytics and improvement

An authorized value-report calculation boundary exists; persistent event collection, complete reporting UI/export and governed improvement publication remain in progress.

Connected model and audio

Adapters and same-runtime smoke tests exist; the complete real-model, ASR and TTS acceptance journeys remain unpassed.

Institutional deployment

Production identity, isolation, retention, restoration and institution-specific approval requirements remain open.

WiCare, careCoach and SAP

Simulated contracts are available for development; real operations remain individually gated pending vendor specifications, access, mappings and acceptance.

G1–G7 remain partial. Feature implementation, test coverage, successful real-model operation, institutional approval and production-provider acceptance are separate milestones.

The tests demonstrate the scenarios and environments recorded in their evidence. They are not clinical certification, proof of zero hallucinations or evidence of financial benefit at a real institution.

Experience and interface

The everyday workspace is Pflegehelfer—not the Medplum administration interface. The mobile-first design uses a compact context selector, visible acting identity, a single text/voice composer and optional in-conversation components for records, work, questions and review.

The intended workspace model is:

Workspace

Purpose and boundary

My assistant

The employee's own working context, guidance, open responsibilities and private drafts.

Patient workspace

Patient-and-encounter-scoped assistance, record views, work and documentation. The assistant talks about the patient; it does not impersonate them.

Team conversations

Explicitly shared patient-team, department and direct communication, with visible audiences and responsibility. Full shared-channel implementation is still in progress.

Staff workspace

Permitted work coordination and direct contact, without exposing a colleague's private assistant history. The complete workspace remains a roadmap item.

Management and administration

Appropriate configuration, operational health and aggregate value reporting. A senior job title does not imply unrestricted clinical or personnel access.

Visual direction

<details>
<summary>View the light and dark design references</summary>

These are design mockups, not live product screenshots. Depicted clinical labels, values and conclusions are illustrative and must not become runtime defaults.

<p align="center">
  <img src="https://raw.githubusercontent.com/mariospeterman/Pflegehelfer/codex/genui-production-showcase/docs/design/reference/pflegehelfer-light-reference.png" alt="Pflegehelfer light-mode design reference, not a production screenshot" width="300" />
  <img src="https://raw.githubusercontent.com/mariospeterman/Pflegehelfer/codex/genui-production-showcase/docs/design/reference/pflegehelfer-dark-reference.png" alt="Pflegehelfer dark-mode design reference, not a production screenshot" width="300" />
</p>

The visual reference contract specifies the calm blue/white and graphite themes, mobile/desktop adaptation, accessible controls and deliberate overrides. It preserves the canonical Edelweiss/negative-space-plus mark rather than adopting every symbol in the mockups.

</details>

Example of the intended interaction

The following illustrates the desired behavior; it is not a claim that the real-model acceptance gate has passed.

Employee: “Was ist für Luca noch offen?”
Pflegehelfer: Retrieves the permitted current responsibilities and answers with source references.

Employee: “Beim Waschen geholfen, ungefähr 200 ml getrunken. Mobilisation später.”
Pflegehelfer: Prepares a compact, editable draft without completing mobilisation.

Employee: “Korrektur: eher 150 ml. Sonst nichts ändern.”
Pflegehelfer: Revises the same draft, preserving approximation and unaffected information.

Employee: Reviews and approves the selected changes.
Pflegehelfer: Records local acceptance and shows the subsequent Medplum/provider delivery state.

A question does not require an approval. Preparing a draft is not signing a clinical record. A provider request being sent is not proof that the destination has stored the intended update.

Architecture

Pflegehelfer uses a modular TypeScript backend and a single PWA. The model is an assistive component above the data and execution services—not an authority over them.

The diagram shows the intended service boundaries. Inbound processing, collaboration, institutional identity and other unfinished parts remain subject to the status matrix.

flowchart TD
    UI["Pflegehelfer PWA\nOpenUI · text · voice"]
    CONTEXT["Authenticated context\nApproved role/workflow guidance"]
    AGENT["Bounded conversational agent"]
    TOOLS["Authorized read and draft tools"]
    REVIEW["Human review / explicit action"]
    COMMAND["Validated local command acceptance"]
    PG[("Operational PostgreSQL")]
    FHIR[("Medplum / FHIR")]
    WORKERS["Delivery and reconciliation workers"]
    ADAPTERS["Capability-based provider adapters"]
    PROVIDERS["Designated institutional systems"]

    UI --> CONTEXT --> AGENT
    AGENT --> TOOLS
    TOOLS --> FHIR
    TOOLS --> PG
    TOOLS -->|"Answer, view or editable draft"| UI
    UI --> REVIEW --> COMMAND
    COMMAND -->|"Local transaction"| PG
    PG -->|"Durable jobs"| WORKERS
    WORKERS --> FHIR
    WORKERS <--> ADAPTERS
    ADAPTERS <--> PROVIDERS

Data ownership

Concern

Responsibility

Normalized clinical information

Medplum/FHIR resources, identifiers, versions, occurrence times and provenance.

Workday and conversation state

Operational PostgreSQL for sessions, drafts, approvals, work episodes, receipts and delivery state.

External source records

The designated provider for each configured information domain and installation.

Institutional guidance

Reviewed Markdown plus validated workflow/configuration metadata.

Authorization and execution

Server policy, supported commands, review authority and version checks.

AI output

An answer, interpretation or proposal—not a permission grant, signed record or delivery receipt.

PostgreSQL is not intended to become a second independently editable electronic health record. Medplum is not automatically the master of every field held by an incumbent system. Source ownership is explicit and destination-specific.

Reviewed commands are accepted in a local transaction; external services are updated through recoverable processing. There is no claim of one atomic transaction spanning PostgreSQL, Medplum and every vendor system.

See the architecture and completion contract for the detailed boundaries and remaining reconstruction work.

Technology

Layer

Current foundation

Interface

React, TypeScript, Vite, OpenUI AgentInterface and an allowlisted clinical renderer

Conversation transport

Vercel AI SDK v6 UIMessage SSE

Backend

Fastify, TypeScript and Zod

Clinical workspace

Medplum and FHIR resource types

Operational persistence

PostgreSQL

Local development infrastructure

Docker Compose, separate application/Medplum databases, Medplum Redis and an independent provider simulator

Verification

Vitest, Playwright, lint/type checks, security/operations checks and GitHub Actions

The exact pinned versions are in package.json and pnpm-lock.yaml. No additional agent framework, vector database or distributed event platform is required by the baseline architecture.

Faithful documentation and human approval

The central distinction is flexible conversation, controlled execution.

The model may retrieve authorized information, explain a workflow, ask a specific clarification or prepare a draft. It must not invent a performed activity, silently change a measurement, grant permissions or approve its own proposal.

Pflegehelfer's record boundary distinguishes:

Original employee input and reviewed speech-transcript corrections.

Existing source records, with their identity, time and provenance.

Assistant interpretation or optional reformulation.

The exact proposal revision and selected effects reviewed by the human.

Accepted content, mapping versions and delivery receipts.

For example, “Anna mobilisiert, danach kurz schwindlig” must not acquire a walking distance, normal blood pressure, resolved symptoms or a physician notification without supporting information.

Once accepted, documentation is not rewritten by another model call. Later material changes require an attributed correction or amendment under the applicable workflow. Numbers, units, uncertainty, negation, timing and performed-versus-planned status must retain their meaning.

Human-in-the-loop approval is a record and execution boundary—not independent proof that the reported event occurred. Source references and schemas also do not guarantee factual accuracy. Connected-model evaluation and appropriate professional review remain necessary.

The current implementation includes one-use approval authority, proposal revision tracking, stale-control rejection and patient/thread binding. Natural-language quality and broader production acceptance remain open work, not solved claims.

Institution and workflow configuration

The project already loads directory-based instruction packs and shared role/workflow guidance. The complete administrator publication and multi-department experience is still being developed.

config/
├── assistant/
│   └── BASE.md
├── shared/
│   ├── guidance-catalog.json
│   ├── roles/
│   └── workflows/
└── sites/
    ├── <typed-site-configuration>.json
    └── packs/
        ├── tertianum-kronenhof/
        │   ├── site.json
        │   ├── SITE.md
        │   ├── departments/
        │   ├── stations/
        │   ├── providers/
        │   └── workflows/
        └── alpenblick-demo/

Shared files and pack-specific references are deliberate: the published manifest binds the selected instruction content and configuration versions.

Configurable concern

Where it belongs

Institution terminology, responsibilities, communication and documentation guidance

Reviewed Markdown

Supported workflow structure, role/profile mappings and provider instances

Validated typed configuration

Current employees, assignments, qualifications and patient records

Authorized directory/database records

Credentials

Private runtime configuration or deployment secret management—not Git

Executable permission enforcement

Backend policy and domain services—not prose

The shared guides cover Pflegeassistenz/SRK, AGS, FaGe, HF/FH, nursing leadership, physicians, pharmacy, therapies, transport, service/cleaning, administration, Heimleitung, HR, finance, education, quality and IT. A guide's existence is not evidence that every role's complete workflow is implemented, nor a universal grant of professional authority.

The intended publication lifecycle is:

Edit → validate → preview → test → authorized review
→ immutable publication → activation → measurement / rollback

This publication lifecycle and configuration-only second-institution acceptance remain roadmap work. Existing validation can be run with:

pnpm pfhctl site validate

See the configuration directory and workflow documentation.

Provider interoperability

Pflegehelfer's integration boundary is organized by provider instance and supported operation, not merely by vendor name. It is intended to handle source ownership, permitted reads/writes, mappings, versions, acknowledgments and reconciliation explicitly.

System or adapter family

Repository status

Medplum

Integrated synthetic FHIR workspace with recorded concurrency and projection tests.

WiCare

Provider-neutral contract and synthetic behavior; production operations remain vendor-gated.

careCoach

Provider-neutral contract and synthetic behavior; production operations remain vendor-gated.

SAP / vital-data interfaces

Contract/simulator work; actual installed services and mappings require verification.

Device gateways and nurse call

Simulated event/operation boundaries; not a replacement clinical alarm system.

A simulated connector is not a certified or verified integration with the named vendor. An implemented interface may be reusable across additional instances, but a new proprietary operation still needs its real specification, authorization, mapping and acceptance tests.

The planned complete synchronization loop includes initial import, incremental updates, reviewed outbound changes, read-back and explicit conflict handling. Relational inbound processing, some reconciliation paths and resource-native reconstruction remain unfinished.

MCP is an optional future access mechanism for the same authorized services—not the implementation of a vendor API and not a requirement between every internal component.

A future standalone mode would require an explicit decision about which clinical domains Medplum owns, along with migration, reconciliation and separate acceptance. The current project is not presented as a complete standalone hospital system.

Analytics and governed improvement

Pflegehelfer aims to help an institution understand whether a workflow improves—not simply count messages or generated notes.

The current organizational-value calculation separates observed, customer-reported, estimated and synthetic evidence. Its reporting boundary accounts for review, correction, failed attempts and downstream reconciliation and permits missing baselines and negative outcomes.

The full event pipeline, authorized reporting UI/export and improvement publication cycle are still in development. Planned measures include:

Question

Evidence to examine

Is administrative effort decreasing?

Capture, review, correction, unsuccessful attempts and downstream reconciliation per eligible activity.

Is repeated entry being removed?

Explicitly observed re-entry across steps or systems.

Does unfinished work retain an owner?

Receiving-owner acceptance, unresolved transfer and missing responsibility.

Does documentation reach its destination?

Contract-verified delivery, pending age, rejection and uncertainty.

Are records remaining faithful?

Human-reviewed omissions, unsupported additions and meaning-changing corrections.

Is the service useful and sustainable?

Voluntary staff feedback, model/audio latency, delivery cost and support effort.

The intended improvement cycle is:

Observe a defined problem → inspect evidence → propose a small change
→ review a Markdown/configuration diff → test → human approval
→ limited rollout → compare outcomes → retain or roll back

For example, unanswered questions addressed to an employee who has finished their shift might motivate a reviewed change to duty-queue routing. The proposal should show its evidence and limitations, then be tested before activation.

This is human-governed process improvement, not autonomous changes to clinical procedures, permissions or records. Released time is not automatically payroll savings. Customer benefit must be measured in an authorized evaluation; synthetic reports are not ROI evidence.

See the value-report implementation and G6 acceptance requirements.

Quick start

Prerequisites

Use the project's supported toolchain: Node.js 24, pnpm 11.19.0, a running Docker daemon with Compose, and a modern Chromium browser for the documented local showcase. Match the exact CI runtime when reproducing its results.

A model runtime is configured separately; installing the application does not provide model credentials or establish model/audio acceptance.

Run the integrated synthetic environment

The implementation currently lives on the development branch:

git clone --branch codex/genui-production-showcase \
  https://github.com/mariospeterman/Pflegehelfer.git
cd Pflegehelfer

pnpm install --frozen-lockfile
pnpm demo:env
pnpm dev:infra
pnpm dev

The documented development endpoints are:

Service

Local address

Pflegehelfer PWA

http://127.0.0.1:5173

API readiness

http://127.0.0.1:3000/ready

Medplum inspection UI

http://127.0.0.1:3001

Wait for API readiness. On a new database, Medplum first initializes definitions, indexes and related resources; do not treat an initial startup delay as proof of failure.

pnpm dev uses the integrated-demo profile: real operational PostgreSQL, Medplum and the independent synthetic provider. The role switcher and all example records are for synthetic testing, not institutional authentication.

Demo configuration is generated in ignored .env.demo. Keep credentials private, out of terminal captures, issues and commits. The generated Medplum administrator credentials are for local synthetic inspection, not staff-device access or production integration.

For the built local showcase, after starting its infrastructure:

pnpm demo

This serves the built PWA/API on http://127.0.0.1:4173. It is a built demo, not a clinical-production release.

See the demo guide for the complete walkthrough. Do not reset a shared demo database while another person or worker is using it.

Runtime profiles

Profile

Purpose

memory-demo

Disposable, fictional UI/workflow testing without durable integration evidence.

integrated-demo

Synthetic data with PostgreSQL, Medplum and an independent provider simulator; no silent memory fallback.

production

A separately gated deployment configuration; the profile name is not proof of release readiness.

The documented local PWA is bound to loopback. Testing on another device requires a deliberately configured, appropriate access route; do not expose real patient data or unrestricted paid-model endpoints through a public tunnel.

Model and voice configuration

The current configuration includes disabled/deterministic operation, a local OpenAI-compatible model path, and explicitly enabled hosted testing with synthetic data. Model agnosticism is an architectural goal supported by adapters—not a claim that every model or API contract already works.

Relevant settings are documented in .env.example:

Area

Configuration family

Model mode and endpoint

PFH_AI_MODE, PFH_LLM_BASE_URL, PFH_LLM_MODEL

Private credentials

PFH_LLM_API_KEY or the configured server-side provider secret

Hosted synthetic consent

PFH_DEMO_MODE, PFH_LLM_DATA_CLASSIFICATION, PFH_ALLOW_EXTERNAL_AI

Speech recognition

PFH_ASR_*

Speech output

PFH_TTS_*

Use the currently authorized key through private configuration. Do not reuse an identified exposed/revoked key. Hosted-test mode is not permission to process real institutional data.

With the development API running, inspect or exercise the configured runtime using:

PFH_BASE_URL=http://127.0.0.1:3000 pnpm pfhctl model list
PFH_BASE_URL=http://127.0.0.1:3000 pnpm pfhctl model test

The model test is a bounded smoke/read probe. A successful probe is not full conversational, draft/revision, voice or clinical acceptance. A deterministic fallback cannot count as a successful connected-model run.

Voice capture, transcript review and read-aloud adapters are present, but their complete acceptance is outstanding. Browser speech is restricted to the synthetic demonstration. The intended local-only deployment must not silently route speech or model data to an external service.

Security, privacy and deployment boundaries

The implementation includes server-owned scoped history, review authority, resource/version checks, audit and explicit delivery states. Remaining institutional identity, RLS/isolation, retention, multi-instance and restore requirements are tracked as open work.

The current deployment guide restricts the application to a single replica while resource-native reconstruction and concurrency work remain incomplete. Do not infer horizontal scalability from shared PostgreSQL alone.

The deployment target includes managed hosting and institution-controlled local operation. Self-hostable does not mean air-gap acceptance is complete. Network isolation, voice, identity, updates and recovery must be tested for the actual deployment.

Before real patient use, the institution-specific release process must address access, professional responsibilities, privacy, outsourcing, device policy, retention, recovery, intended purpose and the relevant approvals. Neither Swiss hosting, a human confirmation nor a green test suite establishes these automatically.

Initial scope does not include originating diagnoses, patient prognosis, prescribing or changing medication orders, autonomous clinical triage, diagnostic image interpretation, replacement alarm monitoring or automated employment decisions. Reading an existing professional record and faithfully documenting an authorized report are different from generating a new clinical decision.

Do not put patient information, private staff records, credentials or sensitive vulnerability details in public issues, screenshots or logs.

Evaluation and planned commercial model

The proposed delivery model is a scoped discovery/implementation pilot, separately defined cloud or on-premises/air-gapped setup, followed by an organization-level subscription and transparently defined AI/audio usage terms—not employee/device seat charges.

Scope, included allowances, support, integrations and any additional usage would be agreed per institution. Customer-owned API consumption should not be charged twice; a local deployment's compute and support costs are distinct from cloud token fees.

This is a planned commercial direction, not an implemented billing system, published price list, existing customer contract or offer of a production-ready service. A useful pilot compares Pflegehelfer against the institution's actual available workflow, including incumbent capabilities, and can conclude that further changes or no rollout are appropriate.

Verification and development

pnpm verify             # Format, lint, types, unit tests and builds
pnpm verify:e2e         # Playwright journeys
pnpm verify:security    # Repository security checks
pnpm verify:ops         # Operations checks
pnpm verify:airgap      # Current preflight/security checks
pnpm verify:full        # Combined repository verification commands

The current default Playwright configuration starts the memory-demo profile. Real PostgreSQL, Medplum, independent-provider and connected-model results must therefore be identified separately. Environment-dependent skips are not passing integration tests.

Likewise, the air-gap preflight command is not a substitute for a complete blocked-egress deployment test, and an operations smoke check is not the full institution restoration drill. Consult the matrix and acceptance ledger for the exact tested scope.

Contributions should follow AGENTS.md and the existing architecture. Preserve applied migrations and useful regression evidence; avoid adding a parallel assistant, duplicate state authority or conflicting completion specification.

The repository's licence position should be clarified with the maintainer before adopting or contributing code under an assumed licence.

Repository structure

config/                  Reviewed guidance, site packs and typed configuration
src/ai/                  Model, voice, knowledge and agent boundaries
src/core/                Workflow, policy, proposals and integration contracts
src/infrastructure/      Persistence and clinical workspace implementations
src/pwa/                 OpenUI PWA and presentation components
src/server/              API, runtime profiles and simulator services
tools/                   CLI, validation and development tooling
scripts/                 Build, environment and verification scripts
tests/                   Unit, regression, integration and browser tests
docs/                    Architecture, workflows, evidence and design references
compose.yaml             Local integrated development infrastructure

Documentation

Document

Purpose

Architecture

System boundaries, ownership and target behavior

Completion matrix

Current implementation and release gates

Completion contract

Binding development and acceptance requirements

Acceptance/recovery ledger

Dated verification results and limitations

Implementation history

Detailed implementation notes; use the current matrix for readiness

Demo guide

Local synthetic workflow and operational walkthrough

Workflows

Role and working-day design

Deployment guide

Deployment assumptions and operational requirements

Visual reference contract

UI mockups, constraints and safe interpretation

Verified source register

Research and implementation references

Developer instructions

Repository working conventions

Licence and project information

No project-level licence was identified in the repository metadata or root files checked for this README. Dependency licences are separate. Contact the maintainer to clarify project reuse and commercial licensing; this README does not select or grant a licence.

Maintainer: mariospeterman. Use GitHub Issues for non-sensitive questions and reproducible synthetic bugs. Do not publish confidential data or exploit details there; agree on a private channel for sensitive reports.

The demo is labelled Tertianum Kronenhof · Demo and uses fictional records and example policies. It is not evidence of a customer relationship or endorsement. Vendor and product names identify intended interoperability boundaries; they do not imply certification, affiliation or a verified production connector.

Natural conversation above. Faithful reviewed work underneath. Measurable value as the goal.

<!-- Links deliberately target the active development branch because main has not yet received PR #1. After integration, update the branch notice, quick-start branch and link targets together. -->

# Pflegehelfer — Agentic Coworker, Runtime Markdown and Verified Product Completion

> **Build low-code institutional configuration over a small, reliable execution layer.**
> Approved Markdown explains the work. One bounded agent interprets requests and chooses permitted tools. Reusable backend services enforce access, review, persistence and delivery. Staff remain the authors/approvers of their professional work.
>
> **Execute this contract; do not deliver another plan-only response.** Rewrite defective implementation where necessary, preserve verified behavior, and leave one coherent product—not a parallel prototype.

**Instruction date / source recheck:** 13 September 2026
**Repository:** `mariospeterman/Pflegehelfer`  
**Branch:** `codex/genui-production-showcase`  
**Rechecked branch head:** `b6d76d9ec8b649e5d9884faf94a098dd9b99e247` (unchanged at this review)
**Canonical destination:** `docs/execution/PFLEGEHELFER_COMPLETION.md`
**Evidence index:** `docs/execution/COMPLETION_MATRIX.md` (retain G0–G7)

This document is for the coding agent. Do NOT paste it into the clinical runtime system prompt: deployed role/skill instructions must stay concise and load progressively.

## Locked natural-coworker correction

The binding invariant is: **a natural agentic coworker on top, faithful reviewed documentation underneath—not a deterministic chatbot and not an unrestricted model writer.** “Deterministic” applies to permission, validation, preservation, acceptance and delivery, not to canned conversation. Ordinary questions normally receive source-linked natural answers without a proposal. Write requests preserve immutable input/source provenance, revise one pending review and expose only the minimum useful GenUI. Schema validity and human approval identify an attributable reviewed report; neither independently proves the event, eliminates hallucination risk or establishes compliance. AI-disabled operation is explicitly degraded and offers direct controls plus verbatim capture.

This correction preserves all G0–G7 gates. In particular, source input/reviewed transcript, provider/history evidence, model interpretation, reviewed revision/action set, accepted record and Medplum/provider receipt remain separate. After approval, no model may rewrite the accepted content. See ADR-0015.

This is the complete revised contract replacing the attached Runtime Markdown/Workspaces instruction. It preserves its patient/staff privacy, roles, workflows, UI, provider, operations and acceptance requirements, while making the runtime agent loop and low-code boundary explicit. All paths and commands introduced below are implementation targets unless identified as currently verified.

## 0. Mission, precedence and what this document is

Finish the existing Pflegehelfer application by closing its real end-to-end gaps and reducing unnecessary custom code. This is an implementation contract, not another prototype, visual concept, architecture fork or request for a plan without execution.

Replace/consolidate the existing canonical completion document with this contract, reconciling any newer explicit user requirement before changing it. Preserve G0–G7 and all still-applicable acceptance IDs; map prior requirements to their retained section/test instead of silently dropping them. Keep `AGENTS.md` a short coding-agent entry point. Consolidate `agent.md` and overlapping historical prompts into references or clearly marked archives. Keep one current `docs/ARCHITECTURE.md`, an evidence-backed status and an exact resume state. Do not erase decision/failure history.

The attached source instruction is a requirement baseline, not evidence that code exists. The repository is the implementation baseline. External official sources support the cited engineering/regulatory principles, not a claim of certification. On a conflict: non-bypass safety and applicable law first; explicit current user intent next; then this reviewed contract and reconciled architecture. Document material conflicts rather than silently choosing the convenient version.

The source recheck confirmed the branch has not advanced beyond `b6d76d9`. `src/core/site-config.ts` still loads JSON at module initialization; role IDs, one department object and provider routes are enumerated. `src/ai/model-gateway.ts` still chiefly classifies/extracts into a predefined schema and validates against a handwritten compiler; it is not the required dynamic tool-result loop. The migration runner still validates history after pending SQL. The repository's own matrix has G0 PASS and G1–G7 PARTIAL, including shared threads/media, durable pending revisions, identity/isolation, relational delivery workers, resource-native clinical reads, analytics and governed publishing.

These are source observations, not reproduced incidents. The task author did not run the local app/test suite; the GitHub Actions query returned no runs for this SHA. Reproduce the baseline yourself and do not inherit reported test counts as proof. The green clean-checkout subset is useful but is not the full product finish line.

Read the actual current branch before changing code; it may have advanced. Reproduce prior findings before treating them as current defects. Preserve fixes already completed, especially encounter-scoped conversations, explicit source states, stateful provider simulations, handover content snapshots and numbered migrations.

**Product contract:** Pflegehelfer is a role-aware documentation, retrieval, communication and work-coordination coworker. Staff speak, type or tap naturally. The assistant retrieves authorized information, prepares faithful documentation and other proposed changes, and helps maintain working-day continuity. Reviewed actions are accepted durably and delivered to the correct existing systems. Staff do not need to operate Medplum or choose a database during normal work.

**Excluded initial intended uses:** diagnosis, patient prognosis, treatment recommendation, medication prescribing/dose changes, autonomous medical triage, replacement of primary alarms, automated employment decisions, covert employee surveillance and fabricated billing. Existing diagnoses, prescriptions and performed professional actions may be faithfully displayed or documented within authorized scope. Do not censor an existing fact merely because the application must not originate that decision.

Human approval is necessary for relevant actions but does not itself establish medical-device exemption or legal certification. Swiss institutional, cantonal, privacy and intended-use assessments remain deployment requirements.

The role/workflow examples below are proposed synthetic product defaults. They are not an assertion of Tertianum's internal procedures, universal Swiss professional permissions, or actual patients and employees.

### Human-centered design basis, without a false no-code claim

The supplied Weinberg book photographs discuss programming as complex human activity and the need to judge quality meaningfully. They do not establish a Markdown architecture, a no-code claim or healthcare compliance. The separate workflow diagram makes inputs, instructions, outputs and owner review explicit through verbs such as reads/uses/writes. Apply those ideas as clarity of responsibility and measurable human benefit—not as a patient-file database or a claim the book endorses this stack.

Evaluate two outcomes together: less remembering/searching/retyping/correcting for staff, and less site-specific source-code modification for implementers. Count successful work completion and recovery, not feature names, lines of code, cards rendered or whether a response is called “agentic.”

## 1. Execution autonomy: continue until the internal contract is closed

Work autonomously in the authorized development/test environment. Do not stop after the next isolated feature or green subset of tests. Do not treat successful installation, a sidebar button or a simulated acknowledgment as completion of its entire workflow.

Use this loop for every vertical slice:

```text
Select an unmet acceptance ID
→ inspect the relevant code and official contracts
→ reproduce the defect or define the failing behavior
→ implement the smallest complete change
→ run targeted tests against real local stores where relevant
→ run the application and exercise the UI
→ inspect persisted records, permissions, traces and delivery receipts
→ obtain an independent review where available
→ fix root causes and rerun regression
→ update evidence and commit a coherent slice
→ continue to the next unmet acceptance ID
```

The coding-agent loop, the bounded runtime assistant loop and the production improvement loop are DIFFERENT:

- **Development:** Codex may modify code and synthetic environments within this task's authorization.
- **Staff assistant:** bounded tools and model calls; no code execution, self-modification or permission changes.
- **Institution improvement:** propose → simulate → responsible human approval → publish → pilot → compare/rollback.

Use independent review agents when available, with specific questions and non-overlapping file ownership. Their opinions do not replace executed tests. Repeated failure means investigate assumptions and data flow, not rerun indefinitely or weaken checks.

Treat “one go” as one bounded delivery programme with complete, reviewable vertical slices. Do not attempt one huge unverified commit. Start the hardest integrated path early, preserve working code behind a short-lived migration seam only while parity tests run, then delete the retired path. Do not keep old/new staff products indefinitely behind feature flags.

After each coherent slice: commit only authorized project changes, record the exact acceptance IDs and evidence, check the next unmet dependency, and continue without asking the user about minor engineering choices. Stop only for a genuinely non-resolvable external authorization/input, an execution limit, or the completed internal matrix. Continue independent tasks when one item is externally blocked. Do not classify all remaining engineering as external merely because a production credential is absent.

Operate within explicit time, compute, API and concurrency limits. Do not publish real data, contact vendors, spend unbounded money, rotate institution credentials, reset production stores or expose new public services without separate authorization. Once a paid AI key is enabled, protect the demo with authenticated access and request/budget limits before exposing it through a tunnel.

If tools, context or runtime end before completion, persist the exact SHA, uncommitted work, test commands, current failure and next steps in the existing progress document. Report an execution handoff, not “complete” or an imaginary background process. External gates cannot be closed by invention; complete every independent internal task while retaining the exact blocked test.

## 2. Keep one small architecture and explicit ownership

Retain React/TypeScript, the existing OpenUI renderer, the modular Fastify backend, PostgreSQL, Medplum and compatible model/audio adapters. Prefer established SDKs and security libraries over implementing protocols yourself. Do not add an agent fleet, workflow platform, message broker, separate vector database or service mesh without measured need and a reviewed ADR.

Implement ONE logical agent definition reused with per-request authorized context, not one shared-memory process or separate model/agent per employee. Concurrent sessions remain isolated. The logical boundaries are instruction pack → agent runtime → tool registry → services/data/adapters; they do not require new network services.

Choose the smallest maintained runtime approach that satisfies the requirements: an existing SDK with tool execution/streaming/budget hooks, or a thin loop over official provider SDKs. Record the choice in one ADR using local-model compatibility, self-hostability, security hooks, removal of current code and operational burden. Reuse existing safe code. Do not build a universal agent framework, an expression language, a generic workflow compiler or a second dependency-injection layer.

PostgreSQL is retained because this product already needs durable drafts, responsibilities, jobs and receipts. It is not mandated because all AI products need another database. Medplum remains the FHIR workspace; do not recreate a FHIR server. Reuse Medplum SDK searches, history, AccessPolicy and supported conditional operations rather than inventing equivalents. A semantic/vector index is optional derived retrieval only; no mandatory vector store and no clinical truth in model memory.

```text
Approved institution/department/role/workflow instruction pack
                              ↓
General assistant / Patient workspaces / Staff profiles / Team threads
                              ↓
                One conversation and GenUI implementation
                              ↓
             Authorized context + bounded tools + proposals
                              ↓
                  Human review + command acceptance
                   ┌──────────┴───────────┐
                   ↓                      ↓
             Medplum FHIR          Operational PostgreSQL
          clinical representation  sessions, jobs, approvals,
                                   events, config and receipts
                   └──────────┬───────────┘
                              ↓
                   Capability-based provider adapters
                 WiCare / careCoach / SAP / other systems
```

Ownership must be explicit:

| Domain                                        | Authority and rule                                                                                                                                 |
| --------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| Existing provider clinical records            | The designated provider remains authoritative for its domain unless the institution explicitly changes this.                                       |
| Normalized clinical information               | Medplum FHIR, with original source, version, timestamps, correction state and provenance.                                                          |
| Working sessions and operational coordination | Pflegehelfer PostgreSQL, with references to clinical records rather than an unnecessary duplicate EHR.                                             |
| Drafts, proposals, approvals and delivery     | PostgreSQL stores the necessary content and binding until retained/deleted under its policy. An approved pending command is not a semantic cache.  |
| People and staff memberships                  | Institution identity/directory plus approved application role mappings. Do not model all support/HR personnel as clinicians merely for uniformity. |
| HR/personnel case information                 | Approved HR system or restricted operational records; never a broadly accessible patient FHIR collection.                                          |
| Instructions                                  | Reviewed Markdown plus validated metadata, published as immutable runtime packs.                                                                   |
| AI                                            | Interpretation and presentation, never authority over permissions or factual truth.                                                                |

Do not require an LLM to render deterministic rosters, timestamps, status or approval buttons. Do not ban legitimate FHIR Binary documents/images when removing the whole-application Binary checkpoint.

The source-of-truth matrix is per domain and provider INSTANCE: existing SAP/KIS identity, nursing-provider documentation, prescribing-system orders, device observations and Pflegehelfer-owned operational tasks may have different masters. Medplum is the canonical normalized representation, not automatically the legal master of every external field. Importing provider changes normally requires mapping/validation, not human reapproval of each replicated record. All user-originated final changes follow the configured review policy.

Do not interpret `schema-valid`, `within numeric range`, `verbatim quote` or `two reviewers` as proof that a reported event truly occurred. The deterministic layer validates authorized execution and structural integrity; the responsible professional confirms what was actually observed/performed.

## 3. Baseline audit and concrete inherited findings

Read all active architecture/product/workflow documents, the existing completion matrix, code on affected paths, migrations and tests. Run the documented baseline before changing behavior. Record actual test coverage, not only counts.

Trace these paths end to end:

1. JSON/Markdown loading → effective published role/workflow → runtime model request.
2. Sign-in → effective purpose/role → patient or staff subject → tool permissions.
3. Conversation and pending draft → correction → final review → command receipt.
4. Incoming provider data → Medplum → UI; accepted work → remote write → read-back.
5. Patient/team/staff/HR audiences → search, media, notification, export and revocation.
6. Handover → plan → interruption → completion/defer → actual receiving shift.
7. Improvement proposal → reviewed configuration change → activation → measured result.

Verify these inherited source-level findings. They describe the rechecked baseline at `b6d76d9`, not the current branch; resolved items remain here as acceptance history and current evidence belongs in `IMPLEMENTATION_STATUS.md` and `COMPLETION_MATRIX.md`:

- Baseline finding, partially resolved by the directory-v2 runtime loader and shared guidance catalog: `src/core/site-config.ts` read one JSON file at module initialization; roles and provider destinations were enumerated, the department was singular, and `workflows.ts` returned configured descriptions rather than a complete configurable workflow runner. Do not replace this with an arbitrary-code workflow engine; extend reviewed step types and predicates.
- Baseline finding, resolved for arbitrary pack validation: `tools/pfhctl.ts` validated two hard-coded site files instead of an arbitrary pack path.
- Most non-nursing roles share `support-day`; FaGe and HF/FH are not properly represented as separate configurable profiles.
- Baseline finding, resolved for the bounded read-tool loop while model-driven draft-tool work remains: model prompts remained in TypeScript; developer `AGENTS.md` was not runtime guidance, and the gateway's `classify`/`planCareUpdate` calls did not implement a model-selected sequence of authorized tools with tool-result feedback. Loading Markdown alone is not completion of the runtime-agent requirement.
- The proposal verifier still insists on some fixed German messages and handwritten semantic patterns. Do not add more brittle branches as the default response.
- Baseline finding, resolved by verify-before-migrate under the advisory lock: the migration runner verified recorded checksums after applying pending SQL. Continue to verify history before ANY new schema/data change, with an explicit safe legacy-attestation path.
- Clinical reconstruction still depends on the entire application checkpoint. Provider work is not yet fully relational/leased.
- Shared patient/team/direct ACL threads, real library/media, persistent proposal resumption, production OIDC/RLS and genuine restore are still listed as incomplete.

A source-level finding is a hypothesis to reproduce, not evidence that a real production incident happened.

## 4. Runtime Markdown packs: implement the missing product capability

### 4.1 One authoring format, not parallel configuration systems

Evolve `config/sites` and `PFH_SITE_PACK_PATH`; do not add a disconnected second configuration mechanism. Support importing the current single-file JSON packs through one documented migration. The final normal path loads a directory manifest and referenced instruction files. One immutable published pack is swapped atomically into the registry; a run must not mix a new SITE.md with old policy/workflow metadata. Configuration changes are scoped per institution/site, not mutable globals shared between tenants.

Use this target layout. Names may be normalized consistently, but every listed role and workflow must have substantive guidance and a tested mapping, not empty placeholders.

```text
config/sites/
  tertianum-kronenhof/
    site.json                         # manifest, references, departments,
                                      # providers, role-policy bindings, defaults
    SITE.md                           # operating context and general guidance
    stations/
      rehabilitation-2.md
      long-term-care-1.md
      # institution-defined units reference their parent department in site.json
    providers/
      wicare/PROVIDER.md               # approved supported use/freshness/limitations
      carecoach/PROVIDER.md            # documentation only, not invented APIs
      sap/PROVIDER.md                  # installed backend services, not UI automation
      devices/PROVIDER.md
      directory/PROVIDER.md
    departments/
      rehabilitation.md
      long-term-care.md
      nursing.md
      medical-service.md
      pharmacy.md
      therapies.md
      hotel-service-cleaning.md
      transport.md
      administration-finance.md
      hr.md
      management.md
      quality-it.md
    roles/
      pflegeassistenz-srk.md
      ags-eba.md
      fage-efz.md
      pflege-hf.md
      pflege-fh.md
      pflege-teamleitung.md
      arzt.md
      apotheker.md
      pharma-assistenz.md
      physiotherapie.md
      ergotherapie.md
      logopaedie.md
      ernaehrungsberatung.md
      transport.md
      service-hotellerie.md
      reinigung.md
      administration-eintritt.md
      abrechnung-versicherungskoordination.md
      heimleitung.md
      geschaeftsleitung.md
      finanzen-cfo.md
      hr.md
      berufsbildung.md
      qualitaet-patientensicherheit.md
      it-integration.md
    workflows/
      nursing-early/SKILL.md
      nursing-early/workflow.json
      nursing-late/SKILL.md
      nursing-late/workflow.json
      nursing-night/SKILL.md
      nursing-night/workflow.json
      physician-rounds/SKILL.md
      pharmacy-review/SKILL.md
      pharmacy-logistics/SKILL.md
      therapy-day/SKILL.md
      transport-day/SKILL.md
      service-day/SKILL.md
      cleaning-round/SKILL.md
      intake-discharge/SKILL.md
      service-evidence-review/SKILL.md
      team-lead-shift/SKILL.md
      home-management-day/SKILL.md
      finance-review/SKILL.md
      hr-onboarding-training/SKILL.md
      education-supervision/SKILL.md
      quality-review/SKILL.md
      it-operations/SKILL.md
      workflow-improvement/SKILL.md
      ... corresponding workflow.json where executable progression is required
    references/
      README.md                       # approved source inventory; no invented SOPs
      sources.json                    # source IDs, licenses, approval/freshness metadata
  alpenblick-demo/
    site.json
    SITE.md
    ... independent configuration demonstrating another center
```

Use a small common `config/assistant/BASE.md` for product interaction instructions and, only where it prevents actual duplication, explicitly referenced `config/shared/` guidance. The BASE file does not replace security code. Its version is reviewed and recorded. Do not load Codex/developer AGENTS.md into the clinical assistant.

Every provider descriptor states the verified operations, source ownership, delays, fallback and escalation from available documentation; endpoints, secrets and mappings are in the manifest/adapter configuration, not invented in prose. A new instance of an existing adapter is configuration; a new undocumented API is not.

`SKILL.md` follows the open Agent Skills packaging convention where practical: `name`, `description`, Markdown body and optional metadata pointing to the workflow definition. Its existence does not automatically integrate with the app; YOU MUST implement the loader and test that approved content reaches the actual LLM request. Do not enable arbitrary `scripts/` execution or rely on experimental `allowed-tools` as a security boundary.

Use one source for each value. Workflow progression lives in its validated definition; role entitlements live in reviewed capability profiles; guidance lives in Markdown. A generated manifest may reference them, but must not contain a competing hand-maintained copy. Shared role-independent guidance can be referenced explicitly; avoid an elaborate inheritance/templating language.

### 4.2 What belongs in files and what does not

Markdown contains institution procedures, department/station practice, role responsibilities, terminology, documentation style, collaboration etiquette, examples and the approved purpose/limits of integrations. Validated metadata contains stable IDs, profile bindings, step types, predicates, supported tool IDs, provider instance references and publication rules. The manifest represents institution → sites → departments → stations/units without creating a custom unlimited hierarchy language. Rooms/beds/current occupancy are operational locations, not Markdown security identities.

Live patients, current staff lists, rosters, qualifications, assignments, conversations, payroll, absence reasons, passwords and tokens DO NOT belong in Git or per-person Markdown files. Import actual identities/assignments from the directory or administer them in the database. The pack references those sources and defines mappings. Synthetic identities may be fixtures stored separately from production configuration.

“Configure staff via Markdown” means define role guidance, approved policy bindings and the directory mapping—not create an editable `nora.md` that grants Nora permissions or contains her private life.

### 4.3 Runtime loading and precedence

At sign-in and every relevant context change, resolve an approved immutable pack version, effective institution/site/department/station, acting role, current workflow/step and permitted skill catalog. Load only the necessary instruction bodies. Initially provide compact skill names/descriptions; a read-only `load_workflow_skill` tool loads the selected approved body by ID. A deterministic required workflow may preload its current skill without an extra model call. Cache by content hash and authorized scope, not globally by role label. Do not include the entire center's SOP library and every role at each request.

There must be no arbitrary filesystem tool in the clinical agent. The loader resolves approved manifest references under a fixed root and checks the published hash/version. A hash alone is integrity evidence, not approval: the active publication record and permissions are required. Unknown/retired/unapproved references fail safely.

The model request should be assembled from:

1. Non-overridable product/safety instructions.
2. Approved institution, relevant department and station/unit guidance.
3. Approved role guidance and selected workflow/skill instructions.
4. Authorized work/session/proposal context.
5. Bounded clinical or operational tool results, clearly marked as data.
6. The current employee's request.

No document, profile bio, chat message, attachment or provider text can promote itself into a system instruction. Markdown cannot redefine implemented tool contracts, reveal other users' private material or enable a forbidden operation. Conflicts between machine-readable policy and prose must be rejected or surfaced for publication review; never resolved by silently expanding access.

Validate references, UTF-8, file sizes, duplicate IDs, schema version, dependencies and publication signatures/hashes. Deny path traversal, symlink escape, remote includes, executable MDX/HTML, YAML object constructors and unbounded aliases. No downloads initiated by an instruction file.

Store instruction IDs, pack version and hashes with the request/approval provenance. Do not persist private chain-of-thought or include patient text in debugging logs.

### 4.4 Role identity must be extensible without arbitrary new powers

Replace exhaustive job-title branching with stable configured role/profile IDs built from a SMALL, reviewed catalog of implemented capabilities. Keep forbidden operations absent. Configurable labels are not new clinical licenses.

A site owner can instantiate or narrow a preapproved capability profile. Expanding the central approved ceiling requires a distinct security/professional-governance review, not a normal workflow edit. Publishing a new title cannot bypass this ceiling. Separate qualification, functional role, assignment, delegation and acting purpose.

A person can be both nurse and team lead. Require explicit acting context where the purposes differ; do not union all entitlements into a global superuser. A staff profile's subject is never the executing principal. Use institution-approved capability profiles and contextual constraints rather than replicating professional job titles across route, UI, schema and model enums. Pinned workflow versions preserve continuity, but current permission revocations and security restrictions take effect immediately, including on pending approvals.

### 4.5 Publication and acceptance

Implement:

```text
Edit Markdown/metadata or describe a change in admin chat
→ generate a draft diff
→ validate references/policy
→ preview actual runtime conversation
→ run relevant scenarios
→ responsible person approves
→ publish immutable version
→ activate for NEW sessions
→ compare outcomes / roll back deliberately
```

Do not hot-read unreviewed file edits into active care. Do not claim Markdown is executable merely because it is listed in a manifest.

Mandatory proof: change a late-shift Markdown instruction to present unresolved team questions first; show the exact approved body/hash in the model-request test, demonstrate its user-visible effect, and prove that editing it cannot grant permission. With AI disabled, executable workflow metadata still drives the safe step order.

Structural change such as moving a required step is made in validated metadata through the same review. Prose-only edits change guidance, not secretly executable security rules.

### 4.6 Concrete authoring example and proof of execution

Use plain human-readable guidance such as this illustrative `roles/fage-efz.md` body:

```markdown
# FaGe EFZ — working guidance

Begin with the assigned shift handover and the tasks already authorized for me.
Explain changes briefly, preserve uncertainty, and ask only for missing information.
When I report work, show what you understood and which existing tasks it affects.
Keep incomplete work open. Offer the responsible nursing contact when I ask for help.
My actual permissions come from my approved profile, qualification and assignment,
not from this document. Do not diagnose, prescribe or invent performed work.
```

A role guide can use approved German in the deployed pack. An illustrative portable workflow instruction file is:

```markdown
---
name: nursing-late
description: Guide an assigned employee through the approved late-shift workflow.
metadata:
  pflegehelfer-definition: workflow.json
---

# Spätdienst

Show the authorized unanswered team questions first, then the incoming handover.
Offer “Kurzfassung” and “Vorlesen” using the same approved source content.
After the required handover checks, show the actual remaining work and appointments.
Keep the conversation natural. Preserve paused work when another room needs attention.
At shift end identify unresolved responsibilities; never invent completion.
```

The corresponding `workflow.json` owns actual allowed step order, predicates and transitions. The prose must agree with it. If a manager asks to put questions before handover and that changes a mandatory step sequence, draft BOTH the required metadata change and its explanation for review. Do not claim a prose edit changed enforced workflow order when only a greeting changed.

Keep the site's manifest responsible for selecting the role/profile/workflow references. Do not duplicate the same role eligibility list in every file. The runtime context test must inspect the actual outbound adapter request, not just test that a file was read somewhere.

### 4.7 The reads / uses / proposes / records contract

For each role workflow document:

- **reads:** which authorized source/tool results it needs;
- **uses:** which approved skill/reference version guides the interaction;
- **proposes:** which draft outputs and requests it may prepare;
- **human reviews:** which actor reviews which content/audience;
- **records/delivers:** which backend command and destination own the accepted result.

Example intake:

```text
site manifest selects intake-discharge skill
  → reads existing admission + approved document references through tools
  → uses approved required-information list
  → proposes missing/conflicting items in GenUI
  → staff reviews and supplies only gaps
  → stores revision/approval in PostgreSQL
  → delivers permitted DocumentReference/clinical changes through adapters
```

The production equivalent of `request.md`/`gaps.md` is usually a scoped record/view, not a patient file on disk. An exported report can be an authorized document artifact without becoming the live state store.

Provide a plain-language admin assistant that drafts changes to the same Markdown/metadata sources. It must show exactly what text, mandatory transitions, routing and permissions would change. A prose request cannot silently change a capability ceiling. New workflow using existing capabilities is configuration-only; new action semantics or a new provider protocol require reviewed implementation and tests.

## 5. Every Swiss role needs a useful, distinct working session

Research current official Swiss role/training descriptions and the actual institution's approved responsibilities before finalizing production profiles. Use BAG, SRK, OdASanté/SBFI, relevant professional bodies and cantonal/institution rules as appropriate. Record sources and disagreements. General federal descriptions do not supply a universal activity-permission matrix.

The following are synthetic defaults to IMPLEMENT and test, not legal role grants:

| Profile                                | Guided day and useful outputs                                                                                                                          | Important boundary                                                                                                                              |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| Pflegeassistenz / Pflegehelfende SRK   | Handover → assigned basic support/personal care → report performed work and observations → questions to responsible nursing → transfer unfinished work | Activities/measurement entry only under institution-approved competence and assignment; no prescribing or independent treatment decisions.      |
| AGS EBA                                | Assigned care, everyday support and logistical tasks → evidence → escalation                                                                           | Separate qualification profile; do not equate with FaGe or HF/FH.                                                                               |
| FaGe EFZ                               | Handover → assigned nursing/medical-technical work within approved competencies → documentation → team coordination → handover                         | Not an alias of SRK or HF; medication context is read-only in this product's initial scope, regardless of what the profession may do elsewhere. |
| Pflegefachperson HF                    | Handover → nursing coordination and existing care priorities → review/escalation → rounds collaboration → responsibility transfer                      | New clinical judgments are made by the qualified human, not by the general assistant.                                                           |
| Pflegefachperson FH                    | Equivalent product workflow with separately represented qualification and local responsibility                                                         | Do not invent an HF/FH hierarchy of legal permissions solely from educational labels.                                                           |
| Pflege-Teamleitung / Schichtleitung    | Team brief → coverage/assignment review → unowned or blocked responsibilities → authorized delegation → shift transfer                                 | Operational leadership is not access to employees' private assistant histories or unrestricted patient charts.                                  |
| Ärztlicher Dienst                      | Addressed team questions → source-linked rounds queue → response/decision documentation → follow-up owners → closure                                   | No AI-authored diagnosis/prescription; formal orders remain in the verified authorized system.                                                  |
| Apotheker/in                           | Existing medication lists and discrepancies → reconciliation/review questions → attributed response → outstanding items                                | No automatic medication changes.                                                                                                                |
| Pharma-Assistent/in / pharmacy support | Supply/preparation/logistics queue → completion/exception → pharmacist handoff                                                                         | No independent pharmacist authority; exact local responsibilities must be verified.                                                             |
| Physio / Ergo                          | Appointments → current authorized changes and goals → intervention reported by therapist → outcomes → follow-up                                        | Do not infer clinical treatment from an LLM plan.                                                                                               |
| Logopädie / Ernährungsberatung         | Profession-specific schedule and authorized existing plans → session notes → questions → coordination                                                  | Show only relevant information; preserve existing human-approved swallowing/diet instructions without inventing recommendations.                |
| Transport                              | Transport queue → minimum identity/destination/assistance requirements → pickup/completion/exception                                                   | No broad diagnoses, reports, pharmacy details or private family messages.                                                                       |
| Service / Hotellerie                   | Team brief → meals/room/service work → requests → completion → exception                                                                               | Only operationally necessary preferences and approved instructions.                                                                             |
| Reinigung                              | Scheduled and requested room work → approved hygiene procedure → completion/room-release status → issues                                               | Necessary precautions without unrestricted diagnosis access; no sensor-based productivity surveillance.                                         |
| Administration / Eintritt / Austritt   | Existing intake import → missing administrative data → documents/coverage/appointments → tracked requests                                              | No clinical sign-off merely because intake is administered.                                                                                     |
| Abrechnung / Versicherungskoordination | Approved service evidence → gaps/duplicates → reviewed export → rejection resolution                                                                   | No invented care/time or automatic billing from tags. External insurers are separate authorized recipients, not internal superusers.            |
| Heimleitung                            | Operating brief → coverage, unresolved operational requests, quality exceptions → approved changes → progress review                                   | Minimum necessary individual work info for defined responsibilities; no private transcripts or default clinical access.                         |
| Geschäftsleitung / CEO                 | Aggregated institutional brief → decisions, owners and improvement review                                                                              | Seniority does not grant unrestricted patient or HR case access.                                                                                |
| Finanzen / CFO                         | Completeness and approved financial/process aggregates → reconciliation → planned review                                                               | No autonomous tariff decisions or unexplained revenue projections.                                                                              |
| HR                                     | Employee onboarding/offboarding, required documents, training/qualification expiry and approved requests → assignment to owners → completion           | Personnel confidentiality; no patient access or clinical chat-mining; no automatic hiring, disciplinary or dismissal decisions.                 |
| Berufsbildung                          | Authorized onboarding/training tasks → supervision appointments → human-reviewed learning records                                                      | Distinguish student/supervisor permissions; do not treat general work telemetry as a competence assessment.                                     |
| Qualität / Patientensicherheit         | Authorized incident/review queue → source examination → reviewed improvement → closure                                                                 | Separate case access and purpose; no ability to rewrite original staff evidence.                                                                |
| IT / Integration                       | Service health → failed jobs → scoped diagnosis of integration faults → controlled resolution                                                          | Technical admin is not clinical sign-off or access to all HR/private content.                                                                   |

Specialist intensive-care/emergency departments may use configurable briefing, logistics, rounds and documentation workflows. Existing certified alarms/monitoring/PDMS remain primary. Do not add autonomous acuity sorting or emulate a PDMS under this task.

Each role Markdown must contain: purpose, audience, first step, recurring responsibilities, permitted read context, typical proposed outputs, escalation destination, closure/handover behavior, prohibited inferences, terminology, realistic positive/negative examples and links to approved sources. Each enabled role gets at least one meaningful end-to-end scenario. Do not satisfy this with the same three generic steps and a different heading.

Implement workflow variation through reusable step types, data queries and Markdown—not a custom TypeScript workflow per profession. Scheduling/payroll/HR vendors remain authoritative where present; do not rebuild a whole ERP to demonstrate HR onboarding and operations.

## 6. One working session; several explicit conversation scopes

Use one chat renderer, one composer implementation, one context service and one command pipeline. Support these logical scopes:

- **General assistant:** private to the employee; their current authorized workday.
- **Patient assistant:** private conversation about one patient and encounter.
- **Patient-team:** shared treatment-team discussion with explicit membership/audience.
- **Department/team:** shared operational collaboration for that team.
- **Direct colleague conversation:** messages between named authorized participants.
- **Staff-context assistant:** requester's private assistant view concerning a colleague's permitted profile/work responsibilities; NOT access to that colleague's private assistant.
- **Restricted personnel case:** HR workflow with distinct purpose/audience, only when enabled; never the public staff profile.

Use existing thread tables and explicit membership/subject fields; do not implement six unrelated chat products. Reuse schemas where correct but never equate all audiences.

Every message, proposal, tool result, recording, attachment, event and draft carries origin institution/site, department where applicable, thread, actor, subject kind/reference, encounter where applicable, audience and context revision. General handover can fetch multiple authorized patients intentionally; random prior patient chat must not become global memory.

A scope change preserves useful drafts, scroll position and work continuity but revokes outdated executable authority. A later response is attached to the scope captured when the request began. Two tabs can use different subjects safely; a shared mutable “current patient” cannot silently retarget their requests. Require per-tab/per-request scope/version confirmation and explicit conflict handling.

Never restore a live action token merely from an old chat message. Restore a proposal, reload permitted source state, revalidate and issue fresh review authority.

## 7. Patient profile/work chat: familiar contact, not simulated patient

Selecting a patient opens their private assistant conversation, with a compact contact-style header:

```text
[Photo/initials] Anna Beispiel · Zimmer 001
Geburtsdatum · aktiver Aufenthalt
Pflegehelfer zu Anna · Nur meine Assistenz

[Chat] [Profil] [Verlauf] [Werte] [Team] [Mehr]
```

Use a permitted source photo or initials; no scraped patient photos or AI-generated likeness of a real person. Photo and room do not replace independent identifiers. Clicking the header expands a read-only profile inspector/sheet using the same source records.

Profile sections: preferred name/language, approved short biography and care preferences, communication/accessibility needs, current encounter/location, documented diagnoses, allergies with explicit known/unknown/negative state, existing care/rehab goals, tasks/appointments, values, medication context, documentation timeline and authorized files.

Do not infer habits, personality, diagnoses or treatment from the image or biography. Existing clinical information remains attributed, timestamped and versioned. Medication order, administration, reported use and reconciliation discrepancy are not one undifferentiated list. No generic medication editor.

Provide useful quick lenses without making users repeatedly ask the same query. A true time-series chart uses timestamps and units, an accessible table, source freshness and separate pending/corrected states. Do not draw equally spaced time points unless the graph explicitly represents measurement order. Avoid invented trend/normality judgments.

**Presence rule:** patients are not messaging contacts in this initial product. Show “System verbunden”, “Datenstand 08:42” or “Übertragung ausstehend” in the system area, not “Anna online”. The AI author remains Pflegehelfer, never the patient.

The Team lens explicitly changes audience. Publishing private content requires a visible content/audience preview. A profile is a view, not a new clinical data authority.

## 8. Staff profiles and chats: implement the requested feature without impersonation

Selecting Nora, a team lead or Heimleitung opens a contact-style STAFF workspace with:

- authorized profile image/initials and display name;
- institution/site/team, professional and functional role;
- work contact details, short approved professional bio and relevant directory information;
- permitted shift/duty responsibility and routing information;
- a clearly labelled system connection indicator, optional permitted availability and freshness;
- three explicit modes: **Assistenz zum Arbeitskontext**, **Gemeinsame Arbeit/Plan**, **Direktnachricht**.

### Assistenz zum Arbeitskontext

Pflegehelfer answers the REQUESTER from records the requester is allowed to access. A team lead can ask about Nora's assigned open responsibilities only where the configured supervisory relationship and purpose permit. It must not read Nora's private assistant transcript, unsent drafts, personal memory or unrelated DMs. It does not become “Nora's AI twin”.

A clinical manager may see appropriately scoped clinical responsibilities. A Heimleitung without clinical access sees the permitted operational summary, not patient details obtained indirectly through Nora's task list. HR access does not imply patient access. Directory access does not imply work-detail access. Do not query a broad dataset and rely on the model to redact it.

### Gemeinsame Arbeit/Plan

Use the same task/assignment records as the employee's own workday. Show role-appropriate status, owners, planned times and explicit exceptions. Updating an assignment requires authorized review, version checks, a reason when appropriate and notification/acceptance under local policy. Past completed work cannot be silently edited by a manager. A question about someone's work is not permission to change it.

### Direktnachricht

Clearly indicate that sending contacts the real person or duty queue. The actual authenticated sender authors the message. AI-assisted text remains a draft until the sender chooses Send. Replies are human-authored and separately identifiable. An explicitly simulated teammate in the demo must be visibly labelled as a simulator.

“Ask Pflegehelfer about Nora” and “Send to Nora” must never be visually interchangeable. Switching into DM must not send prior assistant text or include private context automatically.

### Staff example

```text
Heimleitung opens Nora's profile → Assistenz zum Arbeitskontext
“Welche organisatorischen Aufgaben warten heute auf Nora?”

Pflegehelfer retrieves permitted published work only:
“Zwei offene Aufgaben in deinem Zuständigkeitsbereich.
Eine Rückmeldung zur Dienstkoordination und eine Schulungsbestätigung.”

[Öffnen] [Nora schreiben]

Selecting “Nora schreiben” opens a DM draft with visible audience.
The system never quotes Nora's private assistant conversation.
```

### Privacy and presence

Default to duty/availability labels such as “im Dienst”, “abwesend”, “Status unbekannt”, with source and freshness. Never expose the reason for absence to a general directory viewer. Private health, personnel disputes, compensation and performance evaluations belong in specifically authorized systems/scopes.

Connection heartbeat, scheduled duty and willingness to receive a message are distinct. Optional online status must use actual consented/permitted signals with short expiry; no invented status and no continuous presence-history analytics. “Offline” does not imply unreachable or not working. Disable typing/read receipts where institution policy requires. Read/display does not imply responsibility accepted.

A Call action can launch the approved phone/telephony integration through explicit user action. Do not build a conferencing stack, auto-dial, record calls or claim a functioning connector that does not exist.

## 9. General chat, sidebar and real navigation functions

Preserve one modern assistant shell. Recommended staff sidebar:

```text
Pflegehelfer                       [collapse]
Tertianum Kronenhof · Demo
Suche
Mein Assistent
Geplant / Arbeitsplan
Team & Erwähnungen
Bibliothek
  Dokumente
  Bilder
Patienten / Bewohnende
Mitarbeitende / Dienstkontakte
Angeheftet / Verlauf
Profil · Darstellung
Administration (authorized only)
```

Role-specific visibility matters: HR has no clinical patient list; service gets its permitted queue/context. Do not show every feature to everyone merely disabled.

`Mein Assistent` switches to the general private thread before displaying general work. `Geplant` is an actual plan, not a label sending “What is open?” into the wrong patient chat. `Bibliothek` retrieves real documents. Staff-profile navigation returns the intended subject and never destroys a paused patient episode. Search covers only the types it advertises and checks permission before returning hits, counts or snippets.

Patient/staff tabs are lenses and explicitly scoped conversations, not separate duplicated engines. Technical Medplum/provider consoles are expert tools. Ordinary Details opens a clear Pflegehelfer view; expert links require separate authorization and cannot bypass clinical review.

## 10. Visual design and visual inspection are deliverables

Use current official ChatGPT web/mobile references and the existing OpenUI/Vercel-style patterns as design references. Record the actual reference and date. Do not claim a “latest pixel-perfect ChatGPT clone” or copy trademarks. The product should have comparable clarity, spacing, restrained navigation and fluid composer behavior with its own identity.

The requested visual direction is white/near-black, pharmaceutical blue and restrained red, supporting system/light/dark. Build ONE semantic token system. Standard actions use blue or neutral; red retains urgent/error meaning. Status always has text/icon, not color alone.

Keep the original blue geometric Edelweiss and negative-space plus. Refine one canonical SVG source for 16/24/32px and launcher sizes, with unique mask IDs and proper theme contrast. Red can be a separate accent, not a protected red-cross imitation or official Swiss shield. Do not claim legal clearance from a color change; public brand review remains separate. Use no official Tertianum logo.

Use a single maintained SVG icon set with consistent stroke/size; remove emoji/Unicode substitutes for core navigation. Give accessible labels to microphone, send, stop, listen, pause, expand, attachment, search, contact, assign, reply, approve and discard. Typical bedside targets should be 44–48 CSS pixels as a design goal; accurately test applicable WCAG requirements rather than claiming this is every criterion's minimum.

Glassy depth is allowed on the drawer/composer/toolbar only when it adds useful hierarchy. Use controlled blur, subtle light edges and static inexpensive effects. Clinical data, medication lists, tables and approval surfaces stay sufficiently opaque. No animated refraction behind numbers, heavy WebGL or decorative motion. Provide reduced transparency, reduced motion and forced-color/high-contrast support. Measure mobile rendering costs.

Composer requirements: auto-grow, multiline, clear send vs dictation vs listening state, cancellation, safe-area/virtual-keyboard handling, no hidden truncation and no text loss during subject switching. Do not automatically summon the keyboard when opening a profile. Keep source/patient/audience identity visible without a giant header.

Use compact progressive disclosure. Do not repeat the same approval in a toast, banner, chat bubble and profile card. Show one durable status with links to detail. Preserve scroll position; incoming messages never hijack the active subject. No blank cards or “coming soon” buttons presented as completed functionality.

**Visual test matrix:** 360×800, 390×844, tablet portrait/landscape, 1024px and 1440px; system/light/dark, 200% zoom, keyboard navigation, reduced transparency/motion and virtual keyboard. Inspect screenshots and actual interaction after every UI slice. Check text contrast over actual composited backgrounds, focus order, menus, labels, tooltips, reading order and no horizontal overflow.

A screenshot that looks good is not proof of correct function; a passing Playwright selector is not proof of good design. Record both.

## 11. Handover: exact content, useful guidance and human acknowledgment

Start the configured nursing shift with its actual incoming handover, not a marketing introduction or fixed “step 1 of 10”. If none exists, state that and provide an authorized recovery path rather than invent a prior report.

Provide a compact roster with expand/collapse and these four sections per patient:

1. **Kurzprofil / Achtung:** relevant documented diagnoses/care context and confirmed existing precautions.
2. **Seit der letzten Schicht:** source-backed changes, performed work and reported outcomes.
3. **Offen / ungeklärt:** questions, missing information, pending reports and ownership gaps.
4. **Nächste Schicht:** actual tasks with owner, time/window, reason/source and dependencies.

Distinguish no new entry from no symptoms. “What to watch” comes from an existing human-approved plan or explicit staff instruction, not new model triage. Show newer unverified reports visibly alongside previous confirmed facts; do not conceal them under an older normal value.

Persist exact content, patient/encounter IDs, source/version read-set, cutoff, task ownership and snapshot digest. Preserve the current snapshot improvements. New information creates an append-only addendum with appropriate acknowledgment; do not silently rewrite an acknowledged snapshot. Record receipt/transfer explicitly; listening is not comprehension and acknowledgment is not performed care.

Support partial acceptance, questions and late-arriving staff. Routine progression can require the defined handover checks, but never block established emergency communication or legitimate urgent work until every patient has been acknowledged. Such interruption is explicit and leaves the unreviewed roster visible.

TTS reads the frozen visible content, with pause/repeat/speed/stop and optional section focus using actual segment data. A question can pause the readout and return to the same point. Playback cannot trigger microphone-derived approval. A voice “verstanden” must be deliberately captured and bound to the displayed item; higher-assurance signatures are not silently inferred from ambient speech.

## 12. Handover → plan → work → interruptions → next shift

Derive the work plan from assignments, existing care/therapy plans, appointments, accepted carry-over and explicit spontaneous tasks. Keep patient appointments, staff roster and individual work plan conceptually distinct.

Each plan row contains patient/room, time window, actual activity, reason/order reference, accountable role/person, prerequisites/assistance and status. The model may explain an order suggested from published operational constraints; it cannot invent clinical priority from diagnoses or vital signs. Infeasible double staffing/appointments must be visible rather than silently overbooked.

Starting an activity opens the correct patient/encounter episode. Pausing, resuming, completion, partial completion, deferral, cancellation and transfer have explicit meanings. Merely viewing another profile does not start/stop a care timer. A stopped timer is not evidence of care. Legitimate handover of unfinished work must be possible without falsely completing it.

Example: “Luca beim Waschen geholfen, zum Frühstück begleitet, fast alles gegessen, etwa 200 ml getrunken. Gewicht später.” Prepare only supported relevant changes. Retain approximation. Defer the existing weight task. Do not invent a measurement or a follow-up. Structured fluid balance is used only when that supported data type/mapping exists; otherwise preserve the report honestly.

On nurse-call mirror interruption, preserve the original episode and show a return path. The primary alarm remains independent. The day remains open after the planned morning list, supporting family requests, toileting, transport, documentation and unplanned work.

At shift close reconcile unapproved proposals, unsent records, deferred responsibilities and unanswered questions. Reuse approved records instead of generating duplicates. Receiving duty person/team acknowledges the precise outgoing responsibilities. Track unaccepted transfer and an institution-approved escalation without assigning to the first user in a list.

Account for Europe/Zurich time, DST, overnight shifts, multi-role assignments and staff covering more than one department. Do not compute an overnight shift solely from today's calendar date and a fixed global activeShiftId.

## 13. A genuine bounded agent, not an MD-wrapped intent classifier

### 13.1 Runtime responsibilities

Implement one reusable agent runtime whose model can choose permitted read/prepare tools, inspect their actual results, decide whether another read or clarification is needed and produce a grounded answer or editable proposal. Do not make the normal natural-language path a compulsory `intent enum → fixed card → fixed sentence` pipeline.

The model decides **how to investigate and communicate within the granted scope**. The deterministic workflow service decides **which obligations exist and which transitions are currently valid**. The command gateway decides **what can be committed after the human's action**. They must not become three competing interpreters of clinical truth.

A simple direct UI query/action may bypass the model and invoke the same authorized service. For open-ended language, the model must be able to adapt the next tool call to a previous result rather than have every possible dialogue programmed in advance.

### 13.2 Required runtime loop

Use this observable control flow, implemented with current supported SDK/tool-calling mechanisms:

```text
Authenticate employee and pin request's subject/audience/context
  → resolve approved pack/profile/workflow and eligible skills/tools
  → assemble minimal relevant context, pending proposal and source references
  → invoke replaceable model
  → model requests an allowed tool OR responds
      → validate requested tool, args, current access and scope server-side
      → execute bounded read/draft-preparation service
      → return compact typed result with versions/freshness/errors
      → append authorized tool result and continue the bounded model run
  → answer OR ask one concise blocking question OR persist a draft/revision
  → present grounded text and useful GenUI
  → STOP at human review for final side effects

Human edits/approves exact content
  → deterministic gateway reloads current authorization/read-set
  → atomically accepts local command and delivery jobs
  → workers deliver/reconcile
  → truthful receipts/events update the relevant workspace
```

Draft creation/autosave can be a scoped operational write. It is not a final clinical write, publication, task completion or provider update. Separate these clearly in tool effect classes and UI.

Supported terminal outcomes: `answer`, `clarification-needed`, `draft-ready`, `awaiting-review`, `no-action`, `safe-handoff`, `cancelled`, `budget-exhausted`, `failed`. A run does not sit in a costly loop waiting for a nurse to respond. Store resumable state and release compute. Runtime state records IDs, tool events and pending work—not hidden model reasoning.

Do not let the clinical agent execute shell/SQL, edit its own instructions, install skills, grant rights, call arbitrary URLs or use browser automation on providers. MCP is optional transport over the SAME authorized tool registry, not a requirement for every internal function. Do not enable arbitrary remote MCP servers, tool discovery that widens access, or executable scripts bundled in unreviewed skills. A coding agent's toolset is not appropriate for the deployed care assistant.

### 13.3 Small, typed, well-documented tool registry

Expose only the tool subset needed for the current purpose. Prefer useful combined queries over dozens of near-duplicate tiny tools. The following are semantic examples, not a requirement to create a service for every name:

| Tool family       | Examples                                                                                                 | Effect boundary                                                        |
| ----------------- | -------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| Guidance          | `list_available_skills`, `load_workflow_skill`, `read_approved_reference`                                | Approved IDs only; no arbitrary files/network.                         |
| Work              | `get_my_work`, `get_handover`, `get_work_episode`, `get_open_responsibilities`                           | Requester's allowed assignment/shift, real records.                    |
| Patient           | `resolve_patient_candidates`, `get_patient_context`, `get_observation_series`, `get_recent_changes`      | Candidate lookup does not itself silently select a patient for writes. |
| Collaboration     | `resolve_allowed_recipient`, `get_authorized_thread`, `find_existing_question`, `get_staff_work_context` | Requester access; no impersonation or private transcript leakage.      |
| Knowledge/library | `search_approved_policy`, `search_authorized_documents`, `get_document_excerpt`                          | Source/classification/freshness included; requester's ACL.             |
| Drafts            | `prepare_work_update`, `revise_proposal`, `prepare_message`, `prepare_configuration_change`              | Scoped draft only, never final clinical mutation or publication.       |
| Views             | `prepare_view` or supported structured UI output                                                         | Allowlisted components and server-owned data references.               |

The authenticated approval route is NOT a model-accessible tool. Even if an SDK supports automatic tool execution, its dispatcher must categorically reject direct final-write/permission/publish operations from the runtime agent.

Every tool has a stable name/version, purpose, strict input/output schema, effect class, server policy check, limits, known errors and representative examples. Do not expose raw provider credentials or let arguments override actor/tenant/purpose. Use server-bound references; any model-supplied patient/recipient identifier is rechecked for existence and access. Descriptions and “readOnly” annotations are hints, not security enforcement.

Tool results contain the smallest useful content plus source/resource references, version, effective/recorded time, freshness/completeness and permitted status. No unrestricted FHIR bundles, full-facility snapshots or broad SQL results followed by LLM redaction. A tool returning no match must distinguish unavailable/restricted/unknown from a verified negative without exposing forbidden existence.

### 13.4 Bounded runs, interruptions and costs

Configure maximum wall time, model turns, read fan-out, retrieved bytes/tokens, draft count, retry attempts and cost per run/user/site. Choose measured defaults and include their values in operator configuration; do not invent clinical performance guarantees. Detect repeated identical tool calls or no progress. Cancel promptly when possible; after durable command acceptance, canceling display generation cannot silently undo accepted work.

Parallelize only independent authorized reads. Avoid speculative prefetch of unrelated patients. Do not hold database locks while an LLM, human or provider responds. Fairness: a slow run for one employee must not block another employee's task acknowledgment or emergency contact.

Stream honest progress such as “Ich suche die offenen Fragen” and actual generated content where useful. Do not expose chain-of-thought. Guardrails, tracing and SDK exporters must not send PHI to an external telemetry endpoint by default. Bounded internal trace metadata is sufficient for operational debugging; detailed synthetic traces may be retained for evaluation.

### 13.5 Context and memory without cross-person leakage

Assemble context from the active immutable pack and current authorized work, recent relevant employee/assistant turns, pending proposal revision and selected source/tool results. Keep live facts separate from dialogue. Do not use a summary of yesterday's chat instead of a current medication/source query.

Context compaction may produce a derived private session summary with references and uncertainty. It cannot turn an assumption into a fact or cross patient/encounter/audience boundaries. Revalidate sources before final actions. General handover deliberately fetches multiple assigned patients through an authorized aggregate tool; it does not import arbitrary private patient chats into global memory.

Instructions load on demand. Pasting every skill, every employee, all patients and a large raw FHIR Bundle into the prompt is not “agentic memory.” No vector database is required for structured work/vital queries. Optional later semantic retrieval remains rebuildable, source-linked and permission-filtered.

### 13.6 Preserve meaning, simplify the handwritten compiler

Keep one proposal envelope with a small set of typed action subtypes. It can contain reported work, observations, task changes, communications, operational transitions, uncertainty and evidence. Do not create a profession-specific ontology or 100 unrelated intent types.

The server supplies trusted actor/tenant/time/proposal IDs, cryptographic hashes, provider routes and approval authority. The model should not calculate cryptographic IDs or manufacture exact long numeric character offsets. Stable reference handles alone are not bearer authority: the backend always checks them against the current caller and scope. Evidence can reference a current/earlier scoped message, quote, selected task, provider resource/version or explicit inline edit; server code resolves/verifies those references.

Remove arbitrary exact-German-text matching as a validity requirement. Preserve original staff wording and optional visible professional reformulation, negation, attribution, uncertainty, chronology and requested actions. Deterministic code validates supported effects, units, structural consistency, ownership, versions and approval. Semantic ambiguity leads to review/clarification. Do not assert that regex proves what happened.

Replace the expanding linguistic parser with evaluated model/tool behavior gradually: keep existing safety scenarios, add adversarial/held-out paraphrases, prove parity/improvement, then remove obsolete lexical branches. Keep reliable numeric/unit parsers and explicit no-model controls where valuable. Do not loosen safety by accepting every schema-valid output, and do not retain a broad fallback parser that falsely claims unknown free speech was understood.

A prohibited NEW treatment/order cannot be smuggled through a task/note endpoint. An authorized human's report that a prescribed action already happened can still be documented faithfully without the app originating or executing the clinical decision. Product scope restrictions apply across all API entry points.

### 13.7 Durable revision and review

When a user changes a draft, update the SAME proposal with a new immutable revision and supersede old executable authority. Show which fields/actions changed; preserve original provenance. Restoring a pending draft after refresh/restart reloads the actual current revision, sources and permission checks. Do not demand that the user retype the entire report.

Ordinary direct-message Send or an explicit permitted task-completion control can itself be the required human approval. Do not force two confirmation dialogs for the same low-risk action. AI-prepared multi-action clinical updates receive one visible selected-action review where policy permits; high-assurance actions retain their justified additional review. Human review is meaningful content review, not a blanket approval of any future model output.

Required scenario:

```text
Employee: Luca mobilisiert, etwa 200 ml getrunken. Gewicht später.
Assistant: retrieves the relevant existing task; prepares supported draft effects.
Employee: Korrektur: eher 150 ml. Nora informieren, nicht den Arzt.
Assistant: resolves authorized Nora or asks if ambiguous; revises SAME proposal.
Employee: Nur Dokumentation und Nachricht, noch nichts abschliessen.
Assistant: deselects completion; preserves deferred weight and approximation.
Approve → one durable accepted command; no duplicate records or extra follow-up.
```

### 13.8 Prove actual agent behavior

A passing implementation must demonstrate that the model chooses tools and reacts to results through the SAME runtime used in the app. A prerecorded OpenUI string, fixed intent enum or edited mock response is not sufficient.

Use held-out variants of “Prepare my handover.” In one fixture a question is already answered; in another an answer is pending; in another a source is unavailable. The agent must inspect tool results and produce the appropriate grounded answer/review without a new scenario-specific route. A test ledger can record skill ID, tool name, arguments stripped of secrets, result-reference IDs and terminal status. Do not store private chain-of-thought.

A deterministic fixture model is valid for CI protocol/retry/authorization tests, but cannot be reported as real model competence. With actual configured local or authorized synthetic-hosted models, repeat the workflow and model-swap evaluation. Better models should improve understanding and clarification without source changes to permissions, adapters or workflows.

Safe degraded mode remains available: direct rosters/records, explicit task controls, verbatim draft capture and visible “assistant unavailable.” No final write should depend on a model falsely reassuring the user.

## 14. #Topics, @mentions and live collaboration

Use a small governed taxonomy with stable IDs, localized labels, synonyms, audience, sensitivity, owner and version. Start with useful topics such as Mobilisation, Sturzprävention, Schmerz, Ernährung, Flüssigkeit, Wunde, Ausscheidung, Schlaf, Angehörige, Transport, Austritt and Dienstkoordination.

The assistant may suggest a few grounded topic labels. Approval creates real metadata on the appropriate message/document/task reference. Implement actual filters and saved views, not buttons that merely submit another unimplemented prompt. Removal/correction must update results without leaving hidden stale labels.

Separate:

- discussion topic;
- human/provider-authored clinical statement;
- active governed safety notice/Flag.

“Keine akuten Schmerzen”, “Sturz vor fünf Jahren”, “Suizidgedanken verneint” and “Sturzgefahr bitte prüfen” cannot create a new confirmed positive condition. Topic search can find the statement while preserving its polarity/time. Existing confirmed notices cannot be deleted by a new casual tag. A label never autonomously triggers billing, a diagnosis, an alarm or a task.

Resolve @person/@duty-role through the permitted directory. Show ambiguity rather than selecting the first match. A mention does not widen audience; provide an explicit authorized sharing/delegation workflow or deny appropriately. All authored comments have time, author, version and reply references. A report comment is an addendum/reference, not a silent overwrite of signed documentation.

Implement acknowledgments, answers, resolution, reassignment and duty-role takeover using existing responsibility rules. A user's deliberate Send is approval of their authored ordinary message; do not add an unnecessary second confirmation to every text. AI-generated messages and publication of private material receive an appropriate visible review.

Notifications have separate server-stored, delivered, seen where supported, responsibility-accepted and resolved states. Durable SSE/replay and unread counters must recheck audience; revoked members cannot retrieve past payloads. Staff/patient mentions, attachments, counts and search suggestions must not leak restricted existence. Read does not equal accepted.

In-app delivery while connected is different from background OS push. Do not claim reliable air-gapped background PWA alarms. Approved phone/primary alarm paths remain accessible independently.

## 15. Library, knowledge and profile media

Implement one permission-controlled library for documents and images, filtered by permitted patient, team, subject, topic, type and date. A menu named “Bibliothek” must find/open actual resources. Display author/source, status, effective date and version.

Uploads need authorization on bytes and metadata, file type/size validation, quarantine/scanning where applicable, explicit subject/encounter binding, safe thumbnails and retention. No public patient image URLs, leaked EXIF location in derivatives, unsafe SVG/HTML rendering or secrets in logs. Original-document policies are distinct from sanitized derivatives. Do not promise that a PWA can prevent every screenshot.

Patient/staff avatars are directory/media references with ACLs, not biometric identification. Demo may use initials or licensed fictional illustrations. Do not generate clinical wound images and present them as genuine evidence. Provide synthetic placeholders or clearly labelled approved teaching fixtures.

Approved organizational SOPs and news remain separate classes. Knowledge records need audience, owner, source, version, approval/effective/review/expiry dates and withdrawal handling. Answers cite the current permitted source and distinguish unavailable from negative information. No vector database is required for initial structured/full-text lookup.

Loop/Staffbase or other intranet access is an optional authorized read connector with synthetic fixtures; exact tenant access remains external. No scraping private systems or sending patient/staff confidential content into public search. Air-gap means controlled import/DMZ, not a hidden internet dependency.

## 16. Human approval and durable command acceptance

Finish ONE PostgreSQL transaction for local acceptance of a reviewed action set. Correct every active document that asks for a global “atomic cross-store transaction”: the implementable requirement is atomic LOCAL acceptance plus recoverable external delivery, not distributed magic. That local transaction persists:

- checked current authority and one-use token consumption;
- immutable proposal revision/hash and selected actions;
- actor/purpose/subject/audience and relevant source read-set;
- accepted command and idempotency receipt;
- appropriate local workflow changes;
- audit/domain event and remote projection/delivery jobs.

Network/model/provider calls do not run inside a long database transaction or global queue. If the response is lost, the same request ID/payload returns the original receipt. A different payload with the same key is rejected. Two tabs cannot consume the same approval twice.

Bind approval to current actor, acting role, tenant/site/department, thread, patient/encounter or other subject, context revision, workflow/policy version, proposal revision, sources and selected recipients. Translate relative deadlines into visible absolute times with an explicit reference time before approval; do not silently shift them when a delayed job executes.

Provider changes may be imported automatically as source data without forcing staff to reapprove every replicated item. Staff-originated writes require the relevant human review. Autonomous generation of a draft or draft autosave is not a final clinical write.

Use item-level states: draft → locally accepted → clinical projection delivered → designated provider confirmed; otherwise pending/rejected/conflict/manual review. Do not merge unrelated subsystem health into a misleading “everything synchronized”.

Model explicit dependencies within a reviewed action set. An independently valid note can be accepted even when an unrelated message cannot be sent, if that partial result is clear and authorized; a dependent completion must not be reported successful before its prerequisite evidence is accepted. Do not compensate a failed external operation by silently deleting a signed clinical record. Preserve addenda/corrections and put ambiguous delivery into reconciliation. “Approve all” is not a promise of atomic success in every external system.

Unusual reported values remain prominently visible with verification state and original provenance. They are not quietly normalized, erased or used as independently confirmed completion evidence. Institution-approved data-quality rules may require extra review, but urgent care/contact must not wait for a digital countersignature. Do not invent a universal medical threshold policy under this engineering task.

## 17. Medplum reconstruction, migration safety and provider workers

Replace normal whole-state-checkpoint reconstruction with resource-scoped ClinicalDataPort operations and durable operational repositories. Keep supported Medplum SDK features; do not build a second FHIR server. Retain legacy checkpoint access only in an explicit, bounded migration path until parity is proved, then remove it from ordinary runtime.

Do not duplicate task authority: if PostgreSQL owns a work responsibility and FHIR Task is its interoperability projection, record that mapping; provider-owned tasks retain their source authority. Never create two independent mutable lifecycles for the same assignment.

Migration correction is mandatory and re-confirmed at this SHA: read and validate applied migration history, names and checksums BEFORE any pending migration mutates the database. A changed/missing/ambiguous legacy history must fail without new effects unless an explicit reviewed migration manifest authorizes the specific recovery. Apply each new migration and its ledger update atomically where supported. Capture previous-release fixtures; do not test only empty database installation.

Test the historical note projection, missing encounter references, intake/rounds migration and tenant scoping with migration provenance. Unknown encounter mapping is quarantined for review, never attached to the current or first patient by default. Preserve accepted audit evidence; no destructive reset as a migration strategy.

Use relational provider inbox/outbox/cursors/receipts/conflicts with stable IDs, unique deduplication keys, bounded leases and `FOR UPDATE SKIP LOCKED` where appropriate. Process retries, poison records, lease expiry and lost acknowledgments. Two workers must not produce duplicate effective side effects. Providers without idempotency need supported unique identifiers/read-back and an explicit uncertain-outcome reconciliation state, not blind resend.

Incoming source changes pass authentication, matching, mapping, profile validation and source version handling. Avoid feedback loops when own outbound writes return through inbound. Track corrections/tombstones and concurrent edits where supported; do not use silent last-write-wins for clinical disagreement.

Source ownership and provider capabilities are per operation/instance and configuration-driven, not `if providerName` branches in the PWA. Credentials are secret references. A new adapter requires code for its documented contract; a new instance of an implemented adapter should require configuration only. Do not promise Markdown can implement an undocumented proprietary API.

Keep real WiCare/careCoach/SAP/device operations individually gated until documentation, authentication, sandbox behavior, mappings and acceptance are verified. Generic worker/adapter/test-IdP work is INTERNAL. Read access can be activated independently from write access.

Proof must start with empty Medplum and a stateful external fake provider:

```text
Provider initial dataset → durable import → Medplum → staff view
→ reviewed staff change → remote delivery → provider read-back
→ independent later provider edit → inbound → correct staff view
```

The fake provider persists across restart, validates current versions and can deliberately reject/delay/conflict. An acknowledgment alone is not a read/write round-trip proof.

## 18. Authentication, authorization and revocation

Implement production OIDC/BFF using mature libraries and an actual isolated test IdP. Endpoint/client/claim/certificate configuration is external deployment input; the working OIDC integration itself is not an external blocker. Prefer integrating with existing identity rather than inventing passwords.

Use appropriate authorization code/PKCE, state/nonce, server validation, HttpOnly/Secure/SameSite cookies, CSRF defenses, rotation, logout, expiry and revocation. Never accept demo identity headers or a client-supplied role in production. Do not expose test IdP admin credentials or broad Medplum keys through the public tunnel.

Deny by default based on effective identity, role/capability profile, individual qualification/delegation, institution/site/department, assignment/treatment relationship or supervisory relationship, purpose, audience, resource state and operation.

RLS and repository predicates/composite foreign keys protect all operational objects, with connection-pool tenant isolation. Tests must run using the real limited application DB role, not a superuser that bypasses RLS. Choose and document the Medplum project/AccessPolicy boundary appropriate to each institution; tags and UUID prefixes alone are not authorization.

The subject of a staff query is NOT its executing principal. Opening an employee profile must never run tools with that employee's credentials. Delegation is explicit, narrow, time-bound and audited.

No routine manager/HR access to private assistant histories. Any exceptional legal/investigative process is separately governed and audited; do not promise end-to-end secrecy that deployment admins cannot technically guarantee. The product's normal routes and analytics must not expose private histories. Clinic break-glass must not become an HR/private-chat bypass.

Test revoked role, departed staff member, expired delegation, stale IdP claim and queued approved job. Preserve accepted work and provenance while pausing actions that require renewed authorization; never silently delete approved evidence.

## 19. Real LLM, ASR and TTS activation—not just key fields

Preserve model/provider replaceability and local-first production. Hosted use is synthetic-development only unless separately approved. Never assume a historic or marketing model name is available: inspect official docs and test actual account/runtime compatibility. Support the common local and hosted paths without hard-coding business logic to one model.

Use strict transport schemas supported by the selected API, separate from richer domain validation. Handle required/nullable properties, unions, refusal, truncated/incomplete output, context limits, rate limits, timeout and cancellation. Do not silently truncate at 1,200 characters or label fallback output as real-model success. Use sensible bounded input/output budgets and long-utterance tests.

Record states distinctly: unconfigured, configured, smoke-tested, scenario-accepted, production-approved. A successful `/models`, a key in `.env` or one valid JSON answer is not clinical-language acceptance. Persist acceptance evidence against exact model/runtime/prompt/schema versions, not just a process-local timestamp.

Speech pipeline: actual microphone/file bytes → local/approved ASR → visible editable transcript → same conversation/proposal path. General work questions need no patient; patient documentation needs an explicit scope. Highlight uncertainty in numbers, negations, names, medication mentions, body side and times where evidence supports it. Never fabricate calibrated confidence when the engine supplies none.

TTS is distinct: read approved visible content, not an independently embellished summary. Verify audio response format and bounded streaming/download; a header and arbitrary bytes are not a usable speech response. Stop safely on lock/context change and avoid recapturing synthesized speech as staff instructions. Raw and generated audio are transient by default.

Run real synthetic microphone/ASR/LLM/TTS scenarios when a key/runtime is available within the authorized budget. Use held-out speech/text cases, including Swiss German, German and relevant French/Italian workflows. Synthetic TTS-to-ASR loopback is useful integration testing but does not demonstrate human dialect accuracy. Do not claim specialist clinical acceptance from automated graders alone.

Keys stay server-side, never in files committed to Git or logs. Browser speech may use remote infrastructure; keep it explicitly a synthetic fallback. `store:false` does not override a provider's retention policies. Use no hidden cloud fallback for production-local mode.

## 20. Administration and governed improvement

Provide a separate, compact admin area within the product with capability-based entry. Do not expose infrastructure menus to bedside staff.

Required working functions:

- institution/site/department setup and terminology;
- directory import and staff/profile/membership mapping;
- qualification/delegation records and expiry, with restricted evidence;
- role capability profiles and effective-permission preview;
- Markdown/metadata editor and actual runtime preview;
- draft/validation/simulation/review/publish/activation/rollback of workflows;
- provider instances, supported operations, source ownership and secret references;
- AI/audio endpoint setup and actual test results;
- topic registry and library approval;
- system/jobs/conflicts/audit/retention health;
- permitted operational analytics and improvement proposals.

An admin can describe a configuration change naturally. The assistant produces a reviewable diff and tests; it does not silently publish it. Security-impacting changes require the appropriate separate reviewer. No normal workflow editor can grant itself policy-publishing authority.

Real staff membership updates are ordinary directory/DB administration, not site-code edits. Permission preview should explain allowed/denied reasons without exposing hidden records. Include non-clinical HR and manager scenarios, not only IT simulator controls.

Self-improvement consumes permitted structured process metrics and approved feedback, not everyone's private transcripts. It may propose less repetitive wording, different question routing, useful quick actions or step ordering. It cannot change clinical facts, rights, patient risk labels or metrics to make results look better.

## 21. Service evidence, billing support and value measurement

Create one accepted work event with actual performer(s), role, patient/encounter where relevant, activity, effective time, recorded/approved time, status, appropriate quantity/unit, task/order reference, time segments if deliberately tracked, source/proposal revision and delivery links.

Reuse references from this event for notes, task evidence and reporting. Multiple tags/messages/attachments do not create multiple services. Distinguish planned time, actual reported time, interruption, concurrent participation and corrections. Two staff at one activity do not automatically mean two identical billable patient services.

Provide an evidence-completeness review: documented, missing required information, possible duplicate, assignment/order to review, ready for the approved export path, delivered/rejected. Billing classification/tariff rules are setting-specific, versioned and separately approved. No real CHF revenue forecast, charge submission or upcoding from model interpretation or timers. Real billing prerequisites remain with authorized workflows and providers.

Initial analytics should use a small documented event dictionary and PostgreSQL views: documentation delay, repeated entry, correction steps, unresolved transfer, answer/ownership latency, job age, sync failures, model/ASR latency/cost and staff-reported usefulness. Denominators, windows, missing data and deduplication are explicit.

Heimleitung/CEO sees permitted aggregate operations; team leads may see the specific individual work needed to coordinate their team. HR personnel workflows are separate. Do not ban useful supervision, but do not turn it into covert surveillance, chat sentiment analysis, automatic staff scoring or disciplinary recommendations. Presence duration is not productivity.

Baseline and pilot measurements use comparable definitions and identify shift/case-mix differences. Time saved, available capacity and realized money saved are distinct. Do not claim causality or ROI from synthetic data; show the measurement mechanism.

Demonstrate one improvement cycle with synthetic process evidence: identify a routing delay → propose a duty-role routing change → preview diff → regression tests → human approval → versioned pilot → compare → retain/rollback. Label results as simulated.

## 22. Synthetic demo data and complete role demonstrations

Keep `Tertianum Kronenhof · Demo`, with an explicit non-affiliation and synthetic-data notice. Do not use real patient/employee identifiers, actual private photos or official brand assets without permission. Maintain the existing approximately fifteen longitudinal fictional profiles rather than rewriting them gratuitously. Standard nursing assignment may contain six patients; also test zero, two and twelve.

Use a controlled scenario clock and disclose it. Include plausible and source-tagged historical diagnoses, encounters, read-only medication context, care needs/preferences, tasks, appointments, 1–2 weeks of related events, intentional discrepancies and a readmission with a new encounter. Do not invent codes from memory or reproduce licensed interRAI/BESA/LEP materials without authorization.

Add fictional staff for every enabled role, with professionally plausible short bios, explicit qualifications and multi-role examples. Staff availability and shift assignments are real fixture data; simulated messages are marked. No AI-generated profile claim is treated as verified professional qualification.

Two independent institution fixtures must differ in departments, shift timing, terminology, staff-role mapping, workflow order, instruction wording and provider routing. Same built application, different reviewed pack. Do not modify TypeScript to onboard the second center. Also test two concurrent tenants in the same deployment if that is the supported target; separate deployments do not prove shared-runtime isolation.

Required end-to-end demonstrations:

1. **Nursing:** exact handover/readout → plan → care episode → report → edit/approve → interruption → resume → team response → deferral → outgoing transfer → receiving shift and addendum.
2. **Physician:** addressed questions → source-linked rounds → human response → task ownership → closure, no prescribing.
3. **FaGe/HF/SRK differences:** relevant authorized work, distinct guidance and denied actions; no cosmetic-only role differences.
4. **Staff profile:** team lead opens Nora → asks permitted work question → tries private transcript access (denied) → sends DM deliberately → Nora replies → separate audit/audience.
5. **Heimleitung:** operating brief → appropriate unresolved work → contacts lead → proposed process change, no implicit clinical access.
6. **HR:** onboarding/training/expiry task → restricted staff case → allowed supervisor notification without confidential reason → closure; no patient information.
7. **Pharmacy and therapy:** distinct queues and outcomes, not the same generic support-day script.
8. **Transport/service/cleaning:** minimum required context, completion and exception without broad chart access.
9. **Administration/finance:** imported intake gaps, approved service evidence and review/export status without invented billing.
10. **Provider round trip:** independent source data, review, delivery/read-back, conflict and restart.
11. **Configuration:** Markdown edit + reviewed workflow change → second site/profile/session uses it; old session pinned and revocation immediate.
12. **Connected AI/audio:** unfamiliar phrasing and multiple corrections from real audio with actual configured services, or an explicit unpassed credential/runtime gate.

## 23. Operations, installation and real recovery

Support a documented clean development/demo stack and the selected on-prem/private-cloud deployment. Do not mandate Kubernetes for a small center if a simpler supported environment suffices. Preserve an air-gap/import path with pinned artifacts, local fonts/icons, hashes/signatures, license inventory, SBOM and no unexpected external telemetry.

No hidden state from the developer's existing database in the clean-setup test. No demo super-admin credentials on real-data devices. Public hosted-key demos require authentication, upload/model/response limits, rate limiting, cost cap and safe resets. A successful ngrok HTTP status is reachability evidence only.

Use current configuration loading consistently in CLI and services; no CLI test should accidentally ignore `.env.demo` and report the wrong runtime. Extend actual commands before documenting them as working. Minimum target functions:

```text
pfhctl preflight
pfhctl site validate <path>
pfhctl site inspect <path>
pfhctl site preview <path> --role <id> --workflow <id>
pfhctl site publish <path>
pfhctl site activate <version>
pfhctl identity test
pfhctl provider capabilities <instance>
pfhctl provider test <instance>
pfhctl model test
pfhctl asr test <synthetic-audio>
pfhctl tts test
pfhctl migrations status
pfhctl demo scenario <name>
pfhctl backup create
pfhctl backup restore-test
pfhctl status
```

These are target commands, not claims that they currently exist. Reuse existing group names and avoid adding decorative wrappers. Every command should perform and report the relevant real operation.

Restore actual operational PostgreSQL, Medplum data, file storage and necessary configuration/keys into a clean isolated environment. Verify clinical references, accepted commands, handover snapshots, pending jobs and receipts. Old delivered jobs must not be resent blindly after backup recovery. Reconcile with the external fake provider. A JSON checksum is not this test.

Test rollback/forward recovery with previous-release fixtures and declare measured RPO/RTO assumptions. Do not promise destructive down-migrations are safe. Add versioned retention classes, deletion/withdrawal, legal hold, expiry sweepers and privacy-aware exports. Deleting private chat must not delete already approved clinical records.

Verify two API replicas and two workers after checkpoint retirement, DB restart, limited credentials, pool isolation, event replay, expired leases and blocked internet. Recheck authorization on delivery and retrieval. For revoked authority after local acceptance, preserve accepted work and apply an explicit hold/review policy rather than blindly sending or deleting it. PWA offline caches are minimal, scoped and revocable as technically supported; do not promise complete remote wipe/device attestation from a browser alone. BYOD remains institution-approved.

### 23.1 Swiss deployment, privacy and intended-use evidence

Implement privacy-by-design and a deployment evidence pack, not a claim that this prompt certifies the product. Keep intended use in documentation, UI language, marketing examples and implemented behavior aligned. Read Swissmedic's current software qualification guidance. HITL, local hosting, “coworker” branding or read-only medication UI alone do not establish medical-device exemption. Record a formal intended-use/qualification review requirement for deployment.

Assess federal/cantonal health and data-protection rules, professional secrecy, institutional/controller/processor duties, lawful purposes, access/retention, incident response and cross-border transfers with the responsible institution. Prepare a data inventory/flow, processing record and DPIA working material for appropriate review. Distinguish Swiss operation from actual EU market/use applicability; assess GDPR/EU AI Act only where applicable and recheck current official rules. Do not treat every EU provision as automatically applying to a Swiss-only installation, or treat Swiss hosting as automatic compliance.

Prohibit diagnostic/prognostic/treatment/clinical-triage functionality from appearing indirectly in “optimization,” tags or profile summaries. Existing human/provider diagnoses and orders may be displayed faithfully within scope. Do not implement universal physiological thresholds as if a coding agent can certify them; institution-approved data-quality/verification behavior must keep reported extreme readings visible and must not delay established urgent-care communication.

Track staff work for defined care/coordination/evidence purposes. No covert surveillance, voice-emotion analysis, individual speed leaderboard, private-chat mining, automated discipline or autonomous hiring/dismissal. HR cases and employee health/absence reasons stay specially restricted. Employee consent alone is not a blanket justification for disproportionate processing. Useful supervision can query legitimate shared responsibilities without becoming access to a colleague's private assistant.

Before real data: named responsible owners must approve identity/device policy, source/provider contracts, clinical workflow fit, privacy/security posture, backup/restore and release. A synthetic code review, external sandbox connection or checksum cannot substitute for that approval. Test-IdP integration and generic security engineering are internal tasks, even though institutional credentials and sign-off are external.

## 24. Completion gates and required order

Update the existing G0–G7 matrix; do not rename partial work into a new roadmap to evade completion. Evidence means implementation path + acceptance test + actual runtime result at a SHA.

| Gate                            | Required closure in this run                                                                                                                                                                                          |
| ------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| G0 — baseline                   | Reproduce current results, consolidate this contract, verify sources and identify actual remaining code gaps.                                                                                                         |
| G1 — reliable core              | Verify-before-migrate; atomic local command acceptance; resource-native clinical reconstruction; relational inbox/outbox; stateful provider round trip and crash recovery.                                            |
| G2 — complete workday           | Role-appropriate real plan, exact handover/addenda/readout, interruptions, partial work, two consecutive shifts and truthful service evidence.                                                                        |
| G3 — communication/organization | Shared ACL threads; staff profiles and explicit assistant-vs-DM; work/plan queries; real @/#/notifications; secure library/media and revocation.                                                                      |
| G4 — connected intelligence     | Actual approved Markdown/skills in the outbound request; bounded model-selected tool/result loop; context and durable revisions; model swap; real ASR/TTS/model scenarios or a precise unpassed external access test. |
| G5 — institution/operations     | Multi-department runtime packs; data-driven approved role profiles; test-IdP OIDC; non-bypass RLS; admin publishing; second site; two replicas; retention/restore/egress.                                             |
| G6 — evidence/value             | One work-event trail, completeness/export review, bounded analytics, baseline and governed improvement publish/pilot/rollback.                                                                                        |
| G7 — whole-product/UI           | All requested routes genuinely function; accessible modern themes/icons/glass; visual inspection; measured performance; clean checkout and final CI.                                                                  |

Do G1 before building more final-write features on unreliable paths. In parallel, build the approved Markdown loader, test identity and one bounded read-only agent/tool proof early—do not postpone the actual agent until after another giant dashboard implementation. Then complete one nursing + staff-collaboration vertical slice, and reuse its services for every remaining role. Finish all role/admin/library/value requirements within this delivery contract; staging order is not permission to silently cut them from scope. UI inspection accompanies every slice; G7 is final regression, not the first visual check.

Before enlarging a module, record which measured gap the change closes, whether an existing SDK/service already solves it, what old code it removes and its acceptance ID. No point-based feature scoring or line-count target. Reduce duplicate policies/registries and repeated authoring values. Preserve a thin deterministic core rather than distributing hundreds of ad hoc checks across the UI/model/worker.

Any internal gap keeps its gate partial. Missing vendor documentation cannot excuse unfinished generic workers; missing institution IdP settings cannot excuse unfinished generic OIDC; missing model credentials cannot excuse missing adapter/schema/test code.

## 25. Regression tests that prove this specific product

Keep valuable existing tests. Do not sum overlapping suites to inflate counts. Add behavioral tests against the same implementation used in production and use real PostgreSQL/Medplum where persistence is the property under test.

### Runtime instructions and configuration

- MD-01: approved institution/role/workflow Markdown reaches the model request with correct hash/version; unrelated role instructions do not.
- MD-02: prose-only change affects guidance, not permissions or mandatory step completion.
- MD-03: structural workflow change has visible metadata diff, tests and human publication; prior session remains pinned.
- MD-04: new named approved role/profile, second institution and multiple departments require configuration only; unknown/forbidden capabilities fail.
- MD-05: traversal, symlink, unapproved file, revoked pack, malicious “ignore policy” text and remote include cannot expose data/tools.
- MD-06: real staff/assignments are loaded from operational fixtures/directory, not hard-coded TypeScript or patient files in Git.
- MD-07: institution, department and station guidance resolve correctly for cross-coverage and multiple roles; published pack contents cannot mix revisions during activation.
- MD-08: a new role name bound to existing approved capabilities and a new provider instance of an implemented adapter require no business-source edit. Unknown operations require implementation, not Markdown invention.
- MD-09: each documented reads/uses/proposes/reviews/records arrow resolves to an actual tool/reference/owner; no live patient Markdown compilation is present.

### True runtime agent and tool contracts

- AG-01: approved skill is loaded on demand and its actual body/hash reaches the model; unrelated roles/SOPs do not.
- AG-02: the model requests a read tool, observes its real response and conditionally selects a different next read or safe terminal outcome; no fixed intent/card path is the tested agent.
- AG-03: read-only question produces zero final mutations; preparing a draft produces no provider/final clinical write; an invented commit/publish/SQL tool is rejected server-side.
- AG-04: model-facing actor/tenant/purpose cannot override server context; tool reference substitution across patient/encounter/staff/audience fails before disclosure.
- AG-05: provider/SOP/profile/attachment prompt injection cannot obtain additional tools or exfiltrate data. Approved guidance cannot override executable policy.
- AG-06: tool budget, repeated-call detection, timeout, model refusal, cancellation and no-progress recovery terminate safely; one slow employee does not block another's work.
- AG-07: two model backends use identical tools/proposals/services; genuine runs are reported separately from fixture-model CI.
- AG-08: no model round trip is needed for direct roster, context selection, timestamps or ordinary deterministic approval controls; no artificial typing/streaming delays.
- AG-09: backend-generated IDs, versions, hashes and recipients survive proposal revision; the model is not required to fabricate them.
- AG-10: after a pending revision is restored, the employee can correct one field and approve once without repeating the entire statement.

### Conversation, staff profiles and privacy

- CT-01: general → Anna → Luca → Nora → general restores correct private drafts and work continuity.
- CT-02: same patient with new encounter never receives the old encounter's draft automatically.
- CT-03: slow model/audio result and two browser tabs remain bound to their origin; stale tokens fail safely.
- CT-04: team lead asks about permitted Nora work and gets only that; request for Nora's private assistant history is denied before retrieval/model exposure.
- CT-05: Heimleitung without patient access cannot obtain diagnoses through staff-task/profile/search paths.
- CT-06: Assistenz zu Nora never sends a message; Direktnachricht requires deliberate send and correct audience, with real author identity.
- CT-07: staff off-duty and stale heartbeat do not become absence/health/performance claims; hidden absence reason stays hidden.
- CT-08: HR personnel case, patient thread, department chat, private assistant and unrelated DM cannot be cross-read via mentions/search/counts/media/events.
- CT-09: role/membership revocation invalidates retrieval, pending write authority and notification delivery without erasing accepted records.

### Meaning, handover and workflow

- WF-01: “Nur Morgenpflege erledigt; Mobilisation später” preserves the open activity.
- WF-02: “Arzt nicht informieren, keine weitere Kontrolle” creates neither message nor task.
- WF-03: “Gestern 200 ml, heute ungefähr 150 ml” preserves time/approximation; later correction revises rather than duplicates.
- WF-04: “Nora statt Arzt; nur Nachricht, nichts abschliessen” edits the same reviewed proposal.
- WF-05: medication/treatment instructions cannot enter through generic note/task APIs; authorized past-event reporting is not silently deleted.
- WF-06: extreme pending value remains visible and is not confirmed evidence or a reason to block emergency communication.
- WF-07: exact handover and post-cutoff addendum; TTS content matches; reading does not auto-acknowledge.
- WF-08: zero/two/twelve assignments, overnight/DST shifts, no receiving owner and two-person tasks have truthful outcomes.
- WF-09: interruption/resume, partial care, duty-role transfer and second complete shift do not duplicate responsibility or service events.
- WF-10: topic negation/history does not create an active clinical Flag; @queue stays a queue until claimed.

### Execution and recovery

- TX-01: double approval and lost response return one accepted receipt for the same payload; changed payload fails.
- TX-02: kill process before/after local commit and before/after remote send; no lost accepted work or blind duplicate side effect.
- TX-03: historical migration checksum mismatch plus pending migration fails BEFORE any new schema/data mutation.
- TX-04: previous-release migration/encounter/note fixtures produce traceable output or explicit quarantine.
- TX-05: empty Medplum → provider import → staff update → read-back → independent provider change → app.
- TX-06: two workers, lease expiry, duplicate/correction/poison input, replay and conflict.
- TX-07: two replicas/tenants using limited DB credentials; no global mutable site or patient leak.
- TX-08: isolated full restore then delivery reconciliation; no already-delivered action resent blindly.
- TX-09: patient/team/library bytes, thumbnails, export metadata and signed URLs enforce current audience and expiry.

### Real AI, audio, value and UI

- AI-01: supported strict schema, refusal/incomplete/429/timeout, long text and cancel; no false model success on fallback.
- AI-02: same held-out synthetic scenarios with two model adapters; actual service evidence separate from fixtures.
- AI-03: actual recorded audio → reviewed transcript → model proposal → approved action, plus exact TTS readout.
- AI-04: token/key/PHI-free logs and bounded cost; no unrestricted network/tool use from profile/MD injection.
- VA-01: one activity, multiple tags/docs/two staff and interruptions cannot inflate billable evidence.
- VA-02: admin improvement proposal → diff/tests → human activation → comparison → rollback; no autonomous permission change or staff scoring.
- UI-01: all general/patient/staff/direct/admin modes at required viewports/themes, keyboard/zoom/transparency settings; correct sender/subject/audience visible.
- UI-02: timestamped irregular vital values, missing/negative/allergy states and source staleness display truthfully.
- UI-03: no duplicate navigation/cards, hidden composer, unreachable review, false presence, decorative-only charts or dead feature buttons.

## 26. Evidence, progress discipline and finish line

At every gate record: current SHA, files touched, acceptance IDs, exact commands, real-store/runtime versions, model/audio configuration without secrets, expected skips, results, logs/traces/screenshots and remaining dependencies. Assertions from earlier audits are not inherited passing evidence.

Run meaningful CI on the working branch/PR. Test secrets should be supplied only through approved mechanisms. A missing required service must fail that test job or be explicitly declared unpassed, never silently green. If GitHub Actions is disabled externally, deliver executable configuration and record the actual limitation rather than inventing a run.

Final clean-checkout acceptance must install with the pinned lockfile, provision clean test databases/Medplum/fake provider, migrate, import fixtures and exercise the complete app. Do not call an old already-running developer database a clean installation. Verify source SHA of the UI and API and distinguish a later docs-only commit.

Report these outputs separately:

1. **Synthetic product completion:** all internal modules and stated role/site scenarios work with real own stores and explicitly simulated providers.
2. **Connected AI/voice demo:** actual authorized model, microphone ASR and TTS scenarios passed; absent credentials/runtime keep this unpassed.
3. **Institutional read-only pilot:** generic identity/isolation/runtime internally complete AND real provider/data/device/privacy approvals supplied.
4. **Controlled write pilot:** verified real operation contracts, mapping/read-back/conflict/recovery and institutional approval.

No single “100% ready” label, no percentage without defined denominator and no claim of legal/clinical approval from synthetic tests. A safety review by another coding agent is not a clinician or regulator signing off.

Provide a concise proof index keyed by acceptance ID, not only unit-test totals. Include the actual SHA/runtime versions, test fixture versus real dependency classification, command, output status and evidence path. Use no real patient or confidential employee data in development evidence; demonstration data is explicitly synthetic. A source-level assertion requires a test or is labelled unverified.

Final report must include the actual runtime Markdown paths, how to edit/preview/publish them, one demonstrated prose-only change, one structural workflow change, one model-chosen tool-result feedback trace (without hidden reasoning), a second-site setup without code changes, staff-profile privacy test, complete interrupted shift, real-store/provider evidence, AI/audio results, UI screenshot index, removed duplicated code, measured latency/cost, restore evidence and remaining external artifacts.

Do not finish merely with more documentation. The core final question is:

> Can an employee and their team carry out a realistic day through natural conversation, scoped profiles, useful taps and a small number of meaningful approvals—while the institution can configure its procedures without source-code forks and every accepted record remains recoverable, attributed, permission-correct and visibly delivered?

If not, close the specific missing workflow. Do not create another architecture direction.

## 27. Source register and how to use it

**Rechecked 13 September 2026.** The supplied 908-line Runtime Markdown/Workspaces contract is the requirement basis. The following repository reads are implementation evidence; public sources support only their stated engineering/regulatory principles. The book photographs and workflow diagram are inspiration for human-centered evaluation and explicit inputs/outputs, not a prescription for no-code clinical software. Verify all version-sensitive APIs during implementation. Do not use a model to fabricate a missing vendor contract or legal decision.

### Repository evidence

Repository base for paths below: `https://github.com/mariospeterman/Pflegehelfer/blob/b6d76d9ec8b649e5d9884faf94a098dd9b99e247/`

| ID  | Rechecked source                                                                                                    | Supported finding                                                                                                                       |
| --- | ------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| R01 | Branch endpoint `https://api.github.com/repos/mariospeterman/Pflegehelfer/branches/codex/genui-production-showcase` | Head remains `b6d76d9ec8b649e5d9884faf94a098dd9b99e247`.                                                                                |
| R02 | `docs/execution/COMPLETION_MATRIX.md`                                                                               | G0 PASS; G1–G7 PARTIAL; all four readiness outputs not ready.                                                                           |
| R03 | `src/core/site-config.ts`                                                                                           | JSON startup loader, fixed roles/capabilities, single department and configured provider enum. No runtime Markdown loader in this path. |
| R04 | `src/ai/model-gateway.ts`                                                                                           | Classification/extraction requests and deterministic-verifier fallback, not the required runtime tool-result loop.                      |
| R05 | `src/infrastructure/migrations.ts`                                                                                  | Historical checksum verification follows pending SQL; reproduce and fix before mutation.                                                |
| R06 | Actions API filtered by the exact head SHA                                                                          | No returned GitHub Actions runs at recheck. This is not a rerun of local tests.                                                         |
| R07 | Attached `Pflegehelfer_Codex_Runtime_MD_and_Workspaces.md`                                                          | Previous full role/privacy/workflow/UI/persistence/operations contract retained and revised here.                                       |

The task author did not execute this repository, inspect the live tunnel visually or independently reproduce Codex's test results in this recheck. Do not infer passing evidence beyond the source observations.

### Official technical references consulted

- **S01** Agent Skills specification: https://agentskills.io/specification — Markdown packaging, metadata and progressive loading; experimental tool hints do not replace authorization.
- **S02** Anthropic, Building effective agents: https://www.anthropic.com/engineering/building-effective-agents — simple patterns, agents versus workflows; historical foundational article, not an up-to-date SDK contract.
- **S03** Anthropic, Scaling Managed Agents: https://www.anthropic.com/engineering/managed-agents — separation of model orchestration, tools and durable sessions. Reuse the principle; do not require its managed cloud product for an air-gapped app.
- **S04** Anthropic, Harness design for long-running application development: https://www.anthropic.com/engineering/harness-design-long-running-apps — observable progress and verification for long development tasks, not a guarantee of infinite autonomous execution.
- **S05** Anthropic, Writing effective tools for agents: https://www.anthropic.com/engineering/writing-tools-for-agents — tool ergonomics and outcome-driven evaluations.
- **S06** OpenAI, Safety in building agents: https://developers.openai.com/api/docs/guides/agent-builder-safety — structured boundaries and layered mitigations; current SDK guidance takes precedence over legacy product wiring.
- **S07** Medplum AccessPolicy: https://www.medplum.com/docs/access/access-policies — maintained resource/field/compartment controls; verify installed-version behavior.
- **S08** Medplum project settings: https://www.medplum.com/docs/self-hosting/project-settings — test actual transaction-bundle behavior on the deployed project.
- **S09** OpenUI headless: https://www.openui.com/docs/api-reference/react-headless — existing thread/stream primitives; no mandatory parallel chat framework.
- **S10** ChatGPT release/UI references: https://help.openai.com/en/articles/6825453-chatgpt-release-notes — dated design reference only; not a requirement to clone every consumer feature.
- **S11** WCAG contrast: https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html
- **S12** WCAG target size: https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html

### Swiss and vendor references consulted

- **S13** EDÖB, KI und Datenschutz: https://www.edoeb.admin.ch/de/ki-und-datenschutz — DSG applies to AI; transparency/privacy and high-risk impact assessment.
- **S14** EDÖB, Arbeitgeber: https://www.edoeb.admin.ch/de/datenbearbeitung-durch-den-arbeitgeber — purpose/necessity and protection of employee data.
- **S15** BAG GesBG FAQ: https://www.bag.admin.ch/de/haeufige-fragen-faq-zum-gesundheitsberufegesetz-gesbg — no universal activity entitlement table from job titles.
- **S16** Swissmedic medical-device FAQ: https://www.swissmedic.ch/swissmedic/en/home/medical-devices/regulation-of-medical-devices/faq.html — intended medical purpose and links to software qualification guidance. Consult the current software information sheet for formal review.
- **S17** WigaSoft WiCare product/interface information: https://www.wigasoft.ch/dokumentationsloesungen/wicare-doc-l/index_rai/ — product capabilities and Gate/SOAP/export entry points, not a private API contract.
- **S18** careCoach official product: https://www.topcare.ch/carecoach — existing documentation/mobile/voice/integration capabilities; product descriptions are not write-API specifications.

### Further primary sources to verify for affected implementation

- Codex repo instructions: https://developers.openai.com/codex/guides/agents-md
- OpenAI function calling and structured outputs: https://developers.openai.com/api/docs/guides/function-calling and https://developers.openai.com/api/docs/guides/structured-outputs
- OpenAI data controls: https://developers.openai.com/api/docs/guides/your-data
- OpenAI audio: https://developers.openai.com/api/docs/guides/speech-to-text and https://developers.openai.com/api/docs/guides/text-to-speech
- Swiss nursing reimbursement: https://www.bag.admin.ch/de/krankenversicherung-pflegeleistungen
- Patient-data disclosure: https://www.edoeb.admin.ch/de/bekanntgabe-von-patientendaten
- Employee monitoring: https://www.edoeb.admin.ch/de/technische-mittel-zur-uberwachung-am-arbeitsplatz
- Swiss FHIR guides, HL7 R4, PostgreSQL row-security/transactions, OIDC and current SDK documentation; pin exact chosen versions.
- Applicable SRK, OdASanté/SBFI, professional association, cantonal and institution-approved role/procedure sources; actual vendor contracts and sandbox behavior.
- Swiss Red Cross emblem guidance and appropriate independent trademark/brand review before public production branding.

Record actual access date, version, implication and unresolved question for each material source in `docs/research/VERIFIED_SOURCES.md`. If a source is missing or changes, identify that explicitly; never substitute a tutorial or model assertion for a private technical contract, professional approval or law.

## Final instruction

Finish the working product in this one bounded programme of complete slices. Keep the code, runtime Markdown, workflow metadata, tests, UI and operator evidence aligned. Do not end with another unexecuted roadmap or promise of background work.

> **Configurable procedures. Adaptable intelligence. Enforced boundaries. Reliable accepted work.**

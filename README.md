# Pflegehelfer

Pflegehelfer is a self-hostable Swiss clinical workflow and interoperability layer. Its mobile-first PWA is a GenUI/chat/voice-first workspace: shift events, patient summaries, tasks, documentation, vitals, team communication, handover, rounds and synchronization appear as contextual interactive components in one conversation stream. Every clinical action passes through deterministic permissions, workflow rules, human review and audit before Medplum or a provider adapter is touched.

The repository runs with fictional Swiss healthcare data. WiCare, careCoach, SAP/vitals, device and nurse-call integrations use the real provider-neutral contract and failure/reconciliation workflow, but no undocumented vendor API is claimed.

## What “deterministic” means here

The model may understand a sentence and prepare a proposal. It does not decide
permissions, invent state transitions or write records. Ordinary versioned and
tested code checks the signed-in role, patient/encounter, purpose, identifiers,
values, current resource version, required approval and provider capability.
Only the exact typed changes shown to and approved by the employee can then be
committed, audited and queued. The same input state and approved command follows
the same rules even when the LLM is unavailable.

The daily surface is the **Pflegehelfer GenUI stream**. It reads authorised FHIR
context from the Medplum operational workspace and materializes tasks, patient
summaries, vitals, documentation, team threads, handover, rounds and sync state
as interactive conversation components. Medplum's own UI remains the detailed
FHIR workspace; staff do not need to navigate it for routine work. Provider
adapters sit behind Medplum/workflow commands and acknowledge or reject
synchronization explicitly.

## Run the complete local showcase

Requirements: Node.js 24, pnpm 11, Docker and a modern Chromium browser. Ollama is optional for the local LLM path.

```bash
pnpm install --frozen-lockfile
pnpm demo:env
pnpm dev:infra
pnpm dev
```

On a completely empty database, Medplum builds its R4 definitions, value sets
and search indexes before becoming ready. The first start can take roughly
5–12 minutes on a laptop; later starts are much faster. Wait for `/ready`
rather than treating the initial container state as an application failure.

Open:

- Pflegehelfer PWA: <http://127.0.0.1:5173>
- Medplum detailed FHIR UI: <http://127.0.0.1:3001>
- API readiness: <http://127.0.0.1:3000/ready>

`pnpm dev` and `pnpm demo` both use Medplum. Generated demo credentials stay in ignored `.env.demo`; do not commit or paste them. The role switcher is a synthetic-only identity harness. The normal non-demo server fails readiness and rejects demo identity until an institutional identity adapter is configured.

For optional local text models, install Ollama, pull an approved development model and configure the OpenAI-compatible URL/model in `.env.demo`. The gateway tries that configured private/local endpoint first and falls back only to the deterministic interpreter when it is unavailable. A hosted OpenAI-compatible endpoint is permitted only in explicit demo mode with synthetic-only classification; it is not the production default. Daily workflows remain available when AI is down. Browser speech is explicitly synthetic-only; production uses the local transcription adapter after model validation.

## What to test

Use the role switcher to experience the whole workflow:

1. Pflegeassistenz accepts and completes shift tasks.
2. Pflegefachperson selects a patient in the conversation, asks for source-bound facts, dictates a documentation/vital/team/task bundle and approves its visible structured changes.
3. Physician/pharmacy answers a closed-loop clinical question and creates a safe follow-up.
4. Outgoing and incoming staff sign/acknowledge the delta handover.
5. IT changes a provider simulator to delay/down/reject/conflict, then an authorised clinician reconciles it.
6. Use Pflegehelfer for daily work; open Medplum only for authorized detailed FHIR inspection of matching resources, Provenance and AuditEvent records.
7. Toggle browser offline mode and confirm that cached context is marked stale and clinical writes are disabled.

Reset fictional state with `PFH_BASE_URL=http://127.0.0.1:3000 pnpm pfhctl demo reset`.

## Verification

```bash
pnpm verify
pnpm verify:e2e
pnpm verify:security
pnpm verify:ops
pnpm verify:full
```

See [the demo guide](docs/DEMO.md), [implementation status](docs/IMPLEMENTATION_STATUS.md), [architecture](docs/ARCHITECTURE.md), and [verified sources](docs/research/VERIFIED_SOURCES.md).

## Safety boundary

Pflegehelfer does not diagnose, predict, prescribe, change medication orders, suppress alarms or replace the primary nurse-call system. LLM output is assistive and source-bound. It can read authorised context and prepare drafts; it cannot write directly to Medplum or a provider, and it never supplies final clinical approval.

# ADR-0016: Evidence-first agent presentation and one typed draft tool

- Status: Accepted
- Date: 2026-09-14
- Extends: ADR-0014 and ADR-0015

## Context

The first bounded-agent increment still chose the final application intent from
the last tool called, coupled generated prose to whichever cards the server had
rendered, and wrapped the old compiler behind an empty-input draft tool that
made a second model request. This preserved safety but did not provide a general
conversation-to-proposal boundary. It also made a UI choice accidentally serve
as evidence authority.

## Decision

Use one bounded model loop with permission-scoped read tools and one general
`prepare_clinical_draft` tool. The tool accepts typed `AssistantProposal`
meaning, never identity or execution authority. Deterministic server code
captures current input, actor, patient, encounter and time; resolves exact
source spans; derives recipient/deadline/priority fields; validates every typed
action; and creates the server-owned proposal/reference/hash.

Successful tool results form an immutable request-local evidence registry.
Evidence exists whether the response uses plain text, a table, a chart or no
card. The model receives only opaque run-local handles, bounded facts and
freshness; durable resource IDs, versions, hashes and row provenance never
cross that boundary. Plain conversational text is the default. The model
selects exact scalar claims; deterministic code renders displayed record facts
as indivisible same-row atoms and owns harmless source-free dialogue. Optional
presentation is a non-executable specification selected only from the
registered catalog and hydrated from one cited authorized result. A final
answer cannot cite an invented result, and arbitrary model content never
creates displayed clinical prose, a component or an intent token.

There is no last-tool intent router and no nested extraction-model request. A
draft becomes reviewable only when the model returns the exact reference
created by the draft tool. Restored, reissued and executed durable proposals
repeat source-hash and dedicated-clinical-workflow checks.

## Consequences

- Swapping models can improve language understanding and presentation without
  changing write authority, provider adapters or FHIR persistence.
- Text-only answers need no compulsory card; tables/charts remain optional and
  evidence-derived.
- Conservative grounding can withhold fluent but unsupported prose. The PWA
  states that honestly and retains the authorized data path.
- Fixture tests prove orchestration and validation only. Real model, ASR and
  TTS acceptance remain separate gates.

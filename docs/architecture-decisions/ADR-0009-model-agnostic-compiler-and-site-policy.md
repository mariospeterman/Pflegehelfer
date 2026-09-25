# ADR-0009: Model-agnostic semantic compiler and typed site policy

Status: accepted
Date: 2026-09-08

## Context

Pflegehelfer must feel like a knowledgeable coworker, but no model may become the clinical authorization boundary. A regex-only extractor is too narrow, while accepting arbitrary model JSON makes safety depend on model behavior. Houses also need different roles, shifts and workflows without forking the application.

## Decision

Pflegehelfer uses one conversational agent and one modular backend. The LLM may propose a typed `AssistantProposal`: grounded facts, work, observations, task changes, communications, workflow actions, ambiguity and evidence. Deterministic code then independently verifies exact source spans, polarity, time, value/unit adjacency, semantic action content, uniqueness, patient/encounter, current session/context, workflow state and permission. Only server-created, one-use, human-approved commands can write. A model upgrade may improve understanding and composition but cannot add authority.

Medication, treatment and diagnostic instructions are not executable care events. Known prospective language fails closed into the dedicated governed workflow. Ambiguous clinical directives must be clarified; they are never made safe merely by prefixing them with “Notiz”. This grammar requires formal held-out clinical validation before production.

Roles, allowlisted actions, role-to-workflow selection, workflow definitions, site/department/timezone, shifts, staff assignment and provider-route intent live in a strict versioned JSON configuration. Markdown documents explain policy for humans but are not executable. Configuration cannot introduce code, URLs, provider credentials or actions outside the compiled policy vocabulary.

## Consequences

- “Conversational outside, structured inside” remains the product invariant.
- Better local or hosted-test models make extraction and GenUI composition better without replacing Medplum, policy, audit, approvals, provider adapters or deterministic validation.
- Model failure degrades to a deterministic/no-action path; it does not remove core patient access or clinical records.
- A single selected demo site is supported now. Runtime multi-site publication, two-house isolation tests, durable multi-replica intent authority and cross-store atomic acceptance remain explicit production work.

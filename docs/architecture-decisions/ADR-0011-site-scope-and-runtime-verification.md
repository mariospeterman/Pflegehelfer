# ADR-0011: Site-scoped FHIR projection and truthful AI runtime verification

Status: accepted

Date: 2026-09-09

## Context

FHIR resource IDs and cleanup previously used only domain identifiers and the data-classification tag. Two institutions sharing one Medplum project could therefore collide or delete each other's managed demo projection. Site packs could also name any known action, which made configuration a possible permission-expansion path. AI readiness checked only `/models`, while staff and operators need to distinguish configured connectivity from a successful structured inference or transcription.

## Decision

All Pflegehelfer-generated FHIR identifiers include institution and site. Every projected resource, workflow checkpoint and command receipt carries a separate institution/site tag; stale cleanup requires both that tag and the data-classification tag. The original unscoped checkpoint is never read by default. Its one-way migration requires an explicit flag, exact active institution/site and an operator-approved SHA-256 of the legacy Binary before HMAC/schema validation; legacy command receipts are not implicitly imported.

Site packs may narrow a centrally reviewed per-role action ceiling but cannot expand it. Independent high-assurance review additionally requires an explicit actor qualification from the active pack.

Local OpenAI-compatible models retain `/chat/completions`. Synthetic hosted tests use `/responses` with structured output and `store:false`; the hosted boundary still rejects non-synthetic context. `pfhctl model test` performs a real, non-writing synthetic structuring call and reports the actual model/fallback result. `pfhctl asr test` requires an operator-supplied, explicitly synthetic audio file and exercises the real configured transcription endpoint. Connectivity alone is never clinical validation.

## Consequences

- New FHIR projections and cleanup are site isolated even in a shared Medplum project.
- Unsafe implicit legacy import is impossible; migration is deliberate, hash-bound and auditable by deployment procedure.
- A verified legacy import forces full scoped resource reconciliation and replaces the old checkpoint Binary in the scoped-checkpoint transaction; loading legacy state alone is never treated as completed migration.
- A configuration author cannot turn a support role into a clinical reader or bypass independent-review qualification.
- Runtime probes state what was truly called. No key, local runtime or synthetic audio means the corresponding validation remains incomplete.
- Resource-scoped Medplum reconstruction, PostgreSQL RLS, production OIDC and atomic cross-store acceptance remain separate documented blockers.

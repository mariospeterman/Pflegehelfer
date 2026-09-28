# GenUI operational completion review — 2026-09-06

## Result

The repository now runs as the intended conversation-first synthetic showcase on the integrated Medplum and operational PostgreSQL stack. It must not be represented as ready for real patient data. Specialist review still identifies internally achievable production work in durable command authority, provider workers, event replay, tenant enforcement and checkpoint removal.

## Verified in this loop

- Old dashboard/focus/module frontend and the obsolete Medplum conversation Binary path are removed.
- One responsive conversation, explicit patient context, role opening, quick prompts, source-linked GenUI, granular review, team inbox and sync summary were inspected in the running PWA.
- Assistant transport is NDJSON; partial OpenUI contains no executable authority and the final actionable response follows durable thread persistence.
- Patient context is checked server-side for typed query, voice transcription, voice query and intent execution. Context change revokes existing actor intents; the old-patient replay regression returns 403.
- PostgreSQL owns resumable workflow session, thread, patient context and conversation records and participates in readiness.
- Five target viewport smoke tests pass after demo reset was corrected to clear the whole working session.
- WiCare, careCoach, SAP/device and nurse-call real contracts remain honestly gated; only provider-neutral contracts and synthetic simulators are executable.

## Evidence

- TypeScript client/server compilation, ESLint and security checks: pass.
- Unit/integration: 95/95 tests passed after the final context, stream and approval safety changes.
- Browser journeys: 31/31 applicable journeys passed across 360, 390, 768, 1024 and 1440 pixel viewports; four role-specific duplicate runs were intentionally skipped and the physician journey ran on desktop.
- Live integrated readiness: Medplum 5.1.37 and operational PostgreSQL ready.
- Live browser: team and provider-sync GenUI cards rendered, no horizontal overflow, no console warnings/errors.

## Evidence-backed remaining limitations

1. `safety_authority`, command receipt, provider inbox/outbox and audit tables are not yet the single transactional authority; intent and voice receipts remain process-local.
2. Provider outbound/inbound leased workers, retry/dead-letter processing and durable cursor replay are not implemented.
3. SSE replay is process-local rather than audience-scoped PostgreSQL event replay.
4. Medplum resource reconstruction still depends on the legacy whole-state checkpoint.
5. Tenant identity propagation, PostgreSQL RLS/least-privilege roles, workflow activation/progression/Studio, retention sweepers and production PITR evidence remain incomplete.
6. Institution identity, private provider contracts/sandboxes, terminology approval, signed model/ASR packs and production clinical/security/regulatory sign-off are external gates.

No simulator, scaffold, schema-only table or undocumented integration is counted as production-complete.

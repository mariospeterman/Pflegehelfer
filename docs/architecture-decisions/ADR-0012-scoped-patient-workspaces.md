# ADR-0012: One work session with scoped conversations

Status: accepted
Date: 2026-09-12

## Context

ADR-0006 correctly made conversation the primary workspace, but its “one persistent thread” wording caused general, patient-private and shared-team material to compete for one transcript. That is cumbersome and creates avoidable wrong-patient and audience-leak risks. The product still needs one coherent workday and one GenUI implementation, not separate applications.

## Decision

A `WorkingSession` preserves shift/workflow continuity and points to the currently active conversation. It can link multiple durable, explicitly scoped `AssistantThread`s:

- a private general assistant owned by the authenticated employee;
- a private patient assistant bound to an exact patient and encounter;
- a patient-team discussion with server-enforced treatment-team membership;
- governed department and direct threads where enabled.

Every message, draft, attachment, model call, proposal revision and executable authority retains its origin organization/site, thread, patient/encounter where applicable and context revision. A scope switch revokes executable authority from the old revision but does not reinterpret or copy its content. Private content enters a shared audience only through an explicit reviewed publish action.

The PWA keeps one conversation engine, composer, component catalog, policy gateway and command pipeline. Contact-style patient tabs are read/query lenses over the same records; they do not own workflow state and do not create a second clinical application.

## Consequences

- General → patient A → patient B → general restores separate transcripts without changing shift progress.
- An encounter change cannot silently reuse the prior encounter's thread or draft.
- Patient-team messages require separate ACL, author and audience checks; a mention never grants access.
- In-flight audio/model responses remain bound to their captured origin scope.
- Per-thread drafts and pending proposals may be retained, but executable authority must be revalidated before approval.
- Retention, export, search and unread counts operate per authorized thread and cannot leak restricted existence.

## Supersession

This ADR supersedes only the single-transcript portion of ADR-0006. ADR-0006 remains authoritative that GenUI/chat/voice is the primary staff workspace, fixed UI is supporting structure, and deterministic server code owns writes.

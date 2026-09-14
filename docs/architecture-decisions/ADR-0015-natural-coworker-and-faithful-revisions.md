# ADR-0015 — Natural coworker and faithful revisions

Status: accepted — 2026-09-13

## Context

The existing bounded agent and proposal pipeline protected writes, but the application discarded useful model-authored answers, relied too heavily on phrase-specific revision code and could attribute a merged multi-turn note to the newest sentence alone. The no-model path also appeared more capable than it was, and refresh deliberately hid an otherwise durable pending review.

## Decision

Pflegehelfer is a natural agentic coworker on top of a controlled execution system. A bounded model may choose authorized read or draft tools, answer and clarify naturally, and select useful coded GenUI. Tool-backed prose must cite exact result references emitted during that run. The model never receives or creates write authority.

Every writable revision retains immutable hashed input records and references the records from which its meaning was derived. A merged note may differ from one quoted span only when an explicit correction and all contributing source records are retained and revalidated. The reviewed revision—not a later model response—is the content executed.

The model may identify exact source spans but cannot mint provenance. For one
planning call, the server replaces every proposed source identifier with its
independently captured immutable current-input record. Multi-turn correction
logic then adds earlier authorized records explicitly rather than trusting a
model-provided identifier.

No-model operation is explicitly degraded. Direct data/work controls and verbatim draft capture remain available with human review, but fallback success is not connected-model acceptance. Pending reviews survive refresh by reissuing a short-lived authority for the same stored proposal; parallel tokens consume the same proposal only once.

Voice correction does not overwrite its source. The immutable ASR transcript,
hash, capture time, model/mode/language/confidence and the explicit reviewed
revision remain distinguishable through proposal, acceptance, conversation and
FHIR projection. Critical offsets are recalculated against reviewed text and
audio is not retained.

“Deterministic” applies to permission, validation, versioning, acceptance and delivery. It does not require canned dialogue or exact stock sentences. Approval proves what an authorized employee reviewed; it does not prove an event occurred, eliminate hallucination risk or establish compliance.

## Consequences

- Grounded natural prose can improve when models improve without replacing the policy/command/provider layers.
- Unsupported or uncited generated prose is withheld while server-grounded components remain usable.
- Original input, source evidence, model interpretation, reviewed revision, accepted record and delivery evidence remain distinguishable.
- Phrase-specific fallbacks remain temporary degraded-mode aids and cannot be reported as model acceptance.
- Post-approval amendments and a real-model held-out evaluation remain required by the completion matrix.

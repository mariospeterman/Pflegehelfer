# ADR-0008: Conversational AssistantProposal and interruptible work episodes

Status: accepted
Date: 2026-09-06

## Context

Free-form nursing speech often contains several observations, negation, corrections, historical statements and interruptions. Treating one utterance as one generic note loses meaning; letting a model infer implied actions or completion is clinically unsafe. A shift also cannot be represented as a linear checklist because alarms and spontaneous visits interrupt patient work.

## Decision

The product follows **conversational outside, structured inside**. Staff speaks or types normally; schema and proposal terminology is never exposed in the staff experience. Internally, the server owns a generic, versioned `AssistantProposal` with understood facts, work performed, observations, task changes, communications, workflow actions, ambiguities and evidence. Specific typed sub-schemas remain the only executable layer.

The deterministic compiler preserves source spans, polarity, certainty, reporting/completion state, occurrence wording and every stated observation. It never creates an unstated doctor message, follow-up, completion or billing claim. A model may improve understanding or presentation, but deterministic code independently validates source grounding, permissions, patient/encounter, units, workflow state and executable fingerprints.

The operational store represents performed work as patient-bound work episodes with append-only time segments. Only one episode may be active per actor. Interruption closes the current segment; resume creates a new segment. Completion requires explicit evidence and creates reviewable, non-billable service evidence. Shift transfer is rejected while active or paused responsibility remains.

## Consequences

- The same normalized input and version produce the same internal proposal.
- The assistant responds naturally first and renders only the minimum editable GenUI required for review.
- Explicit negation, historical reporting, partial work, deferral, interruption/resume, delegation and communication remain distinct meanings.
- Medication, treatment and diagnostic commands fail closed into their dedicated governed workflows.
- Historical measurements use resolved occurrence time, not approval time; ambiguous time blocks execution.
- Alarm work can interrupt one patient and later return to the exact prior episode.
- Financial eligibility remains a separate deterministic, versioned decision. The LLM and work-episode completion never declare billability.
- Provider delivery occurs after local acceptance and is reported separately from external acknowledgement.

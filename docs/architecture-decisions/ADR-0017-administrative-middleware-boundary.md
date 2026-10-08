# ADR-0017: Enforce the administrative middleware boundary

- Status: Accepted
- Date: 2026-10-07
- Supersedes clinical-purpose wording in ADR-0016 where it implies that the
  middleware may select or recommend patient care

## Context

The existing product correctly separated model output from executable
authority, but some language and deterministic demo behavior still implied
patient-specific interpretation, urgency or follow-up chosen by the
middleware. Human review is not a sufficient boundary when software has first
generated a diagnosis, treatment recommendation, clinical priority or
employment decision.

## Decision

Pflegehelfer is an administrative documentation and coordination middleware.
It may retrieve and display exact authorized records, preserve attributed
staff/source statements, improve spelling and structure without changing
meaning, prepare reviewable documentation, coordinate already authorized work
and report aggregate operational process evidence.

It does not diagnose, prognose, interpret physiological values or symptoms,
rank patients by clinical risk, recommend treatment/medication/dose or urgent
intervention, create a new care plan, control a device, replace a primary
alarm, or make/recommend employment decisions. Model prompts, site packs and
human approval cannot widen that boundary. The server rejects these requests
before model routing and validates generated output again. Missing source data
is unavailable or unknown, never silently normal.

Source-authored clinical nouns and already authorized plans remain visible with
subject, source, time and provenance. A mirrored nurse-call or elapsed
administrative deadline may change coordination state but may not invent a
clinical priority. Scenario fixtures exercise the same rule.

## Consequences

- Exact-record retrieval and faithful documentation remain useful without
  turning model-selected “importance” into clinical advice.
- Existing clinical follow-up and rounds wording must be treated as
  source/human-authored work or removed; catalogs do not originate care.
- Negative API/model/voice/tap tests are release gates for the excluded uses.
- This technical scope is evidence for, not a guarantee of, legal
  classification. Intended purpose, actual behavior, claims and institutional
  use still require competent regulatory assessment before release.

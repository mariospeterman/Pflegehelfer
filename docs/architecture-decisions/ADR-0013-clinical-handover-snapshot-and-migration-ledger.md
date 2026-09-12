# ADR-0013: Clinical handover snapshot and immutable migration ledger

Status: Accepted  
Date: 2026-09-12

## Decision

One actor/shift has exactly one PostgreSQL handover snapshot. Before any
patient acknowledgement, the server binds every assigned patient to the exact
authorized encounter and freezes four staff-facing sections: recent changes,
currently important facts, today's configured plan and open questions. The
assignment and clinical sections share one cutoff, monotonically increasing
version and SHA-256 digest. Acknowledgements bind handover ID, version, patient
and actor. Altered, contentless, encounterless or duplicate snapshots fail
closed.

Schema changes are forward-only numbered SQL files recorded with filename,
checksum and provenance. Production refuses a changed applied migration and
unattested legacy history. The synthetic demo may explicitly attest its legacy
v1 row but reports that state rather than calling it verified.

## Consequences

- Provider documents and model summaries can supply evidence but cannot become
  a second responsibility authority.
- The readout and visible handover use the same frozen content.
- Clinical snapshot binding is allowed only before acknowledgement; later
  changes require an append-only addendum/version in a future migration.
- Migration 006 enforces one authoritative snapshot per organization,
  department, shift and owner. Existing duplicates must be investigated rather
  than silently deleted by a migration.
